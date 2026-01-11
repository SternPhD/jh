import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, SelectList, KeyHints, Spinner, ErrorMessage, SuccessMessage, type SelectItem } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraIssue } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { GitManager } from '../services/git.js';
import { generateBranchName, extractBranchDescription } from '../utils/slug.js';

interface LinkBranchProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type ViewStep = 'loading' | 'select-ticket' | 'confirm-rename' | 'linking' | 'done' | 'error';

export function LinkBranch({ context, navigate, refreshContext }: LinkBranchProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [tickets, setTickets] = useState<JiraIssue[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<JiraIssue | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [error, setError] = useState('');
  const [confirmIndex, setConfirmIndex] = useState(0);

  // Load tickets
  useEffect(() => {
    async function loadTickets() {
      if (!context.workspace || !context.workspaceName) {
        setError('No Jira workspace configured.');
        setStep('error');
        return;
      }

      try {
        const configManager = new ConfigManager();
        const token = await configManager.getJiraToken(context.workspaceName);
        if (!token) {
          setError('Jira token not found.');
          setStep('error');
          return;
        }

        const client = new JiraClient(
          context.workspace.domain,
          context.workspace.email,
          token
        );

        const myTickets = await client.getMyIssues(context.workspace.defaultProject);
        setTickets(myTickets);
        setStep('select-ticket');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
        setStep('error');
      }
    }

    loadTickets();
  }, [context.workspace, context.workspaceName]);

  const handleTicketSelect = (item: SelectItem<JiraIssue>) => {
    setSelectedTicket(item.value);

    // Generate new branch name using ticket ID + existing branch description
    const description = extractBranchDescription(context.currentBranch || '');
    const newName = description
      ? `${item.value.key}/${description}`
      : generateBranchName(item.value.key, item.value.summary, 50);

    setNewBranchName(newName);
    setStep('confirm-rename');
  };

  const handleLink = async (rename: boolean) => {
    if (!selectedTicket || !context.currentBranch) return;

    setStep('linking');

    try {
      if (rename && newBranchName !== context.currentBranch) {
        const git = new GitManager();
        await git.renameBranch(context.currentBranch, newBranchName);
      }

      await refreshContext();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename branch');
      setStep('error');
    }
  };

  useInput((input, key) => {
    if (step === 'confirm-rename') {
      if (key.escape) {
        setStep('select-ticket');
        return;
      }
      if (key.upArrow || key.downArrow) {
        setConfirmIndex((prev) => (prev === 0 ? 1 : 0));
      }
      if (key.return) {
        handleLink(confirmIndex === 0);
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
        <BorderedBox title="Link Branch">
          <Spinner label="Loading tickets..." />
        </BorderedBox>
      );

    case 'select-ticket':
      return (
        <BorderedBox title="Link Branch">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>
                Current branch: <Text color="yellow">{context.currentBranch}</Text>
                <Text dimColor> (no linked ticket)</Text>
              </Text>
            </Box>

            <Box marginBottom={1}>
              <Text>Search for a ticket to link:</Text>
            </Box>

            <SelectList
              items={tickets.map((ticket) => ({
                label: `${ticket.key}  ${ticket.summary}`,
                value: ticket,
              }))}
              onSelect={handleTicketSelect}
              onBack={() => navigate('main')}
              searchable={true}
              searchPlaceholder="Type to search..."
              renderItem={(item, isSelected) => (
                <Box>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '→ ' : '  '}
                  </Text>
                  <Text color={isSelected ? 'cyan' : 'yellow'}>
                    {item.value.key}
                  </Text>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {'  '}{item.value.summary.substring(0, 60)}
                    {item.value.summary.length > 60 ? '...' : ''}
                  </Text>
                  <Text dimColor> [{item.value.status}]</Text>
                </Box>
              )}
            />
          </Box>
          <KeyHints
            hints={[
              { key: '↑↓', action: 'Navigate' },
              { key: 'Enter', action: 'Select' },
              { key: 'Esc', action: 'Back' },
              { key: 'type', action: 'Search' },
            ]}
          />
        </BorderedBox>
      );

    case 'confirm-rename':
      return (
        <BorderedBox title="Link Branch">
          <Box flexDirection="column">
            <Text>
              Linking to: <Text color="yellow">{selectedTicket?.key}</Text> "{selectedTicket?.summary}"
            </Text>

            <Box marginTop={1}>
              <Text dimColor>Rename branch to include ticket?</Text>
            </Box>
            <Box>
              <Text dimColor>Current: </Text>
              <Text>{context.currentBranch}</Text>
            </Box>
            <Box>
              <Text dimColor>New:     </Text>
              <Text color="green">{newBranchName}</Text>
            </Box>

            <Box flexDirection="column" marginTop={1}>
              {['Yes, rename branch', 'No, keep current name'].map(
                (label, index) => (
                  <Box key={label}>
                    <Text color={index === confirmIndex ? 'cyan' : undefined}>
                      {index === confirmIndex ? '→ ' : '  '}
                      {label}
                    </Text>
                  </Box>
                )
              )}
            </Box>
          </Box>
          <KeyHints
            hints={[
              { key: '↑↓', action: 'Navigate' },
              { key: 'Enter', action: 'Select' },
              { key: 'Esc', action: 'Back' },
            ]}
          />
        </BorderedBox>
      );

    case 'linking':
      return (
        <BorderedBox title="Link Branch">
          <Spinner label="Linking branch..." />
        </BorderedBox>
      );

    case 'done':
      return (
        <BorderedBox title="Success">
          <SuccessMessage
            messages={[
              `Linked to ticket: ${selectedTicket?.key}`,
              ...(newBranchName !== context.currentBranch
                ? [`Renamed branch to: ${newBranchName}`]
                : []),
            ]}
          />
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
