import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BorderedBox, KeyHints, Spinner, ErrorMessage, SuccessMessage } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraIssue } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { GitManager, type BranchInfo } from '../services/git.js';
import { extractTicketId } from '../utils/slug.js';

const execAsync = promisify(exec);

const PAGE_SIZE = 20;

function formatRelativeDate(date: Date | null): string {
  if (!date) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

function PRStatusBadge({ prInfo }: { prInfo: PRInfo | null }) {
  if (!prInfo || !prInfo.status) return null;

  const config: Record<NonNullable<PRStatus>, { label: string; color: string }> = {
    merged: { label: '✓merged', color: 'magenta' },
    open: { label: 'PR open', color: 'green' },
    draft: { label: 'draft', color: 'gray' },
    closed: { label: 'closed', color: 'red' },
  };

  const { label, color } = config[prInfo.status];
  const authorStr = prInfo.author ? ` @${prInfo.author}` : '';

  return (
    <>
      <Text color={color}> [{label}]</Text>
      {prInfo.author && <Text dimColor>{authorStr}</Text>}
    </>
  );
}

interface SwitchBranchProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type PRStatus = 'merged' | 'open' | 'closed' | 'draft' | null;

interface PRInfo {
  status: PRStatus;
  author: string | null;
}

interface BranchWithTicket {
  branch: BranchInfo;
  ticketId: string | null;
  ticket: JiraIssue | null;
  prInfo: PRInfo | null;
}

async function getPRInfoForBranches(branchNames: string[]): Promise<Map<string, PRInfo>> {
  const infoMap = new Map<string, PRInfo>();

  try {
    // Get all PRs in one call using gh CLI
    const { stdout } = await execAsync(
      'gh pr list --state all --limit 100 --json headRefName,state,isDraft,author',
      { timeout: 10000 }
    );

    const prs = JSON.parse(stdout) as Array<{
      headRefName: string;
      state: string;
      isDraft: boolean;
      author: { login: string } | null;
    }>;

    for (const pr of prs) {
      if (branchNames.includes(pr.headRefName)) {
        let status: PRStatus = null;
        if (pr.state === 'MERGED') {
          status = 'merged';
        } else if (pr.state === 'CLOSED') {
          status = 'closed';
        } else if (pr.isDraft) {
          status = 'draft';
        } else if (pr.state === 'OPEN') {
          status = 'open';
        }

        infoMap.set(pr.headRefName, {
          status,
          author: pr.author?.login || null,
        });
      }
    }
  } catch {
    // gh CLI not available or error - ignore
  }

  return infoMap;
}

type ViewStep = 'loading' | 'list' | 'switching' | 'done' | 'error';

export function SwitchBranch({ context, navigate, refreshContext }: SwitchBranchProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [branches, setBranches] = useState<BranchWithTicket[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);

  // Load branches and their ticket info
  useEffect(() => {
    async function loadBranches() {
      try {
        const git = new GitManager();
        const branchList = await git.listBranches();

        // Get PR info for all branches
        const branchNames = branchList.map((b) => b.name);
        const prInfoMap = await getPRInfoForBranches(branchNames);

        // Extract ticket IDs and fetch ticket info
        const branchesWithTickets: BranchWithTicket[] = branchList.map((branch) => ({
          branch,
          ticketId: extractTicketId(branch.name),
          ticket: null,
          prInfo: prInfoMap.get(branch.name) || null,
        }));

        // Fetch ticket info for branches with ticket IDs
        if (context.workspace && context.workspaceName) {
          const configManager = new ConfigManager();
          const token = await configManager.getJiraToken(context.workspaceName);

          if (token) {
            const client = new JiraClient(
              context.workspace.domain,
              context.workspace.email,
              token
            );

            // Fetch tickets in parallel (with limit)
            const ticketIds = branchesWithTickets
              .filter((b) => b.ticketId)
              .map((b) => b.ticketId!)
              .slice(0, 10); // Limit to avoid too many requests

            const ticketPromises = ticketIds.map(async (id) => {
              try {
                return await client.getIssue(id);
              } catch {
                return null;
              }
            });

            const tickets = await Promise.all(ticketPromises);
            const ticketMap = new Map(
              tickets.filter(Boolean).map((t) => [t!.key, t!])
            );

            branchesWithTickets.forEach((b) => {
              if (b.ticketId && ticketMap.has(b.ticketId)) {
                b.ticket = ticketMap.get(b.ticketId)!;
              }
            });
          }
        }

        // Sort: current branch first, then by most recent commit date
        branchesWithTickets.sort((a, b) => {
          if (a.branch.current) return -1;
          if (b.branch.current) return 1;
          // Sort by date (most recent first)
          const dateA = a.branch.lastCommitDate?.getTime() || 0;
          const dateB = b.branch.lastCommitDate?.getTime() || 0;
          return dateB - dateA;
        });

        setBranches(branchesWithTickets);
        setStep('list');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load branches');
        setStep('error');
      }
    }

    loadBranches();
  }, [context.workspace, context.workspaceName]);

  const totalPages = Math.ceil(branches.length / PAGE_SIZE);
  const startIndex = currentPage * PAGE_SIZE;
  const visibleBranches = branches.slice(startIndex, startIndex + PAGE_SIZE);

  const handleBranchSelect = async (branch: BranchWithTicket) => {
    const branchName = branch.branch.name;

    if (branch.branch.current) {
      // Already on this branch
      return;
    }

    setSelectedBranch(branchName);
    setStep('switching');

    try {
      const git = new GitManager();
      await git.checkoutBranch(branchName);
      await refreshContext();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch branch');
      setStep('error');
    }
  };

  useInput((input, key) => {
    if (step === 'list') {
      if (key.escape) {
        navigate('main');
        return;
      }

      // Up/down to navigate within page
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : visibleBranches.length - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < visibleBranches.length - 1 ? prev + 1 : 0));
      }

      // Left/right to change pages
      if (key.leftArrow && totalPages > 1) {
        setCurrentPage((prev) => (prev > 0 ? prev - 1 : totalPages - 1));
        setSelectedIndex(0);
      }
      if (key.rightArrow && totalPages > 1) {
        setCurrentPage((prev) => (prev < totalPages - 1 ? prev + 1 : 0));
        setSelectedIndex(0);
      }

      // Enter to select
      if (key.return && visibleBranches[selectedIndex]) {
        handleBranchSelect(visibleBranches[selectedIndex]);
      }
    }

    if (step === 'done' || step === 'error') {
      if (key.return || key.escape) {
        navigate('main');
      }
    }
  });

  switch (step) {
    case 'loading':
      return (
        <BorderedBox title="Switch Branch">
          <Spinner label="Loading branches..." />
        </BorderedBox>
      );

    case 'list':
      return (
        <BorderedBox title="Switch Branch">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>
                Local branches ({branches.length})
                {totalPages > 1 && (
                  <Text>  Page {currentPage + 1}/{totalPages}</Text>
                )}
              </Text>
            </Box>

            {visibleBranches.map((b, index) => {
              const isSelected = index === selectedIndex;
              const isCurrent = b.branch.current;
              const dateStr = formatRelativeDate(b.branch.lastCommitDate);

              return (
                <Box key={b.branch.name}>
                  <Text color={isSelected ? 'cyan' : isCurrent ? 'green' : undefined}>
                    {isSelected ? '→ ' : isCurrent ? '* ' : '  '}
                  </Text>
                  <Box width={10}>
                    <Text dimColor>{dateStr.padEnd(8)}</Text>
                  </Box>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {b.branch.name.substring(0, 35)}
                    {b.branch.name.length > 35 ? '...' : ''}
                  </Text>
                  <PRStatusBadge prInfo={b.prInfo} />
                  {b.ticket && (
                    <>
                      <Text dimColor>  "{b.ticket.summary.substring(0, 25)}</Text>
                      <Text dimColor>{b.ticket.summary.length > 25 ? '...' : ''}"</Text>
                    </>
                  )}
                  {!b.ticket && !b.ticketId && b.branch.name !== 'main' && b.branch.name !== 'master' && !b.prInfo && (
                    <Text dimColor>  (no ticket)</Text>
                  )}
                </Box>
              );
            })}
          </Box>
          <KeyHints
            hints={
              totalPages > 1
                ? [
                    { key: '↑↓', action: 'Navigate' },
                    { key: '←→', action: 'Page' },
                    { key: 'Enter', action: 'Checkout' },
                    { key: 'Esc', action: 'Back' },
                  ]
                : [
                    { key: '↑↓', action: 'Navigate' },
                    { key: 'Enter', action: 'Checkout' },
                    { key: 'Esc', action: 'Back' },
                  ]
            }
          />
        </BorderedBox>
      );

    case 'switching':
      return (
        <BorderedBox title="Switch Branch">
          <Spinner label={`Switching to ${selectedBranch}...`} />
        </BorderedBox>
      );

    case 'done':
      return (
        <BorderedBox title="Success">
          <SuccessMessage messages={[`Switched to branch: ${selectedBranch}`]} />
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue...</Text>
          </Box>
        </BorderedBox>
      );

    case 'error':
      return (
        <BorderedBox title="Error">
          <ErrorMessage error={error} />
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Esc to go back...</Text>
          </Box>
        </BorderedBox>
      );

    default:
      return null;
  }
}
