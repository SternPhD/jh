import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { exec } from 'child_process';
import { promisify } from 'util';
import { StatusBox, KeyHints } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraIssue } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { openInBrowser, getJiraIssueUrl } from '../utils/browser.js';

const execAsync = promisify(exec);

interface MainMenuProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

interface MenuItem {
  label: string;
  view?: ViewName;
  action?: () => void;
  show: boolean;
}

export function MainMenu({ context, navigate, refreshContext }: MainMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [linkedTicket, setLinkedTicket] = useState<JiraIssue | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  // Fetch linked ticket details if we have a ticket ID
  useEffect(() => {
    async function fetchTicket() {
      if (!context.linkedTicketId || !context.workspace) return;

      try {
        const configManager = new ConfigManager();
        const token = await configManager.getJiraToken(context.workspaceName!);
        if (!token) return;

        const client = new JiraClient(
          context.workspace.domain,
          context.workspace.email,
          token
        );
        const ticket = await client.getIssue(context.linkedTicketId);
        setLinkedTicket(ticket);
      } catch {
        // Ignore errors
      }
    }

    fetchTicket();
  }, [context.linkedTicketId, context.workspace, context.workspaceName]);

  // Fetch PR URL for current branch
  useEffect(() => {
    async function fetchPrUrl() {
      if (!context.currentBranch || context.currentBranch === 'main' || context.currentBranch === 'master') {
        setPrUrl(null);
        return;
      }

      try {
        const { stdout } = await execAsync(`gh pr view --json url -q .url 2>/dev/null`);
        const url = stdout.trim();
        if (url && url.startsWith('http')) {
          setPrUrl(url);
        } else {
          setPrUrl(null);
        }
      } catch {
        setPrUrl(null);
      }
    }

    fetchPrUrl();
  }, [context.currentBranch]);

  const handleOpenJira = async () => {
    if (!context.linkedTicketId || !context.workspace) return;
    const url = getJiraIssueUrl(context.workspace.domain, context.linkedTicketId);
    try {
      await openInBrowser(url);
    } catch {
      // Silently fail
    }
  };

  const handleOpenPr = async () => {
    if (!prUrl) return;
    try {
      await openInBrowser(prUrl);
    } catch {
      // Silently fail
    }
  };

  const menuItems: MenuItem[] = [
    // Show update ticket status first when on a branch with a linked ticket
    {
      label: 'Update ticket status',
      view: 'update-ticket-status',
      show: !!context.linkedTicketId,
    },
    {
      label: 'Open Jira ticket in browser',
      action: handleOpenJira,
      show: !!context.linkedTicketId,
    },
    {
      label: 'Open PR in browser',
      action: handleOpenPr,
      show: !!prUrl,
    },
    {
      label: 'Create PR for current branch',
      view: 'create-pr',
      show: context.isGitRepo && !!context.linkedTicketId && !prUrl,
    },
    { label: 'Create a new ticket', view: 'new-ticket', show: true },
    { label: 'My tickets', view: 'my-tickets', show: true },
    { label: 'Switch branch', view: 'switch-branch', show: context.isGitRepo },
    {
      label: 'Create ticket from current branch',
      view: 'create-ticket-from-branch',
      show: context.isGitRepo && !context.linkedTicketId && context.currentBranch !== 'main' && context.currentBranch !== 'master',
    },
    {
      label: 'Link branch to ticket',
      view: 'link-branch',
      show: context.isGitRepo && !context.linkedTicketId,
    },
    { label: 'Settings', view: 'settings', show: true },
  ];

  const visibleItems = menuItems.filter((item) => item.show);

  const handleSelect = (item: MenuItem) => {
    if (item.action) {
      item.action();
    } else if (item.view) {
      navigate(item.view);
    }
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : visibleItems.length - 1
      );
    }

    if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev < visibleItems.length - 1 ? prev + 1 : 0
      );
    }

    if (key.return) {
      handleSelect(visibleItems[selectedIndex]);
    }

    // Number shortcuts
    const num = parseInt(input, 10);
    if (num >= 1 && num <= visibleItems.length) {
      handleSelect(visibleItems[num - 1]);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Status Box */}
      <StatusBox
        repo={context.repoIdentifier}
        workspace={context.workspace?.defaultProject}
        branch={context.currentBranch}
        ticket={
          linkedTicket
            ? {
                key: linkedTicket.key,
                summary: linkedTicket.summary,
                status: linkedTicket.status,
              }
            : null
        }
        commitsAhead={context.commitsAhead}
      />

      {/* Menu Items */}
      <Box flexDirection="column" marginTop={1}>
        {visibleItems.map((item, index) => (
          <Box key={item.label}>
            <Text color={index === selectedIndex ? 'cyan' : undefined}>
              {index === selectedIndex ? '→ ' : '  '}
              {item.label}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Key Hints */}
      <KeyHints
        hints={[
          { key: '↑↓', action: 'Navigate' },
          { key: 'Enter', action: 'Select' },
          { key: 'q', action: 'Quit' },
        ]}
      />
    </Box>
  );
}
