import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, SelectList, KeyHints, Spinner, SuccessMessage, ErrorMessage, type SelectItem } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraIssue } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { GitManager } from '../services/git.js';
import { generateBranchName, sortTicketsByKey } from '../utils/slug.js';

interface StartWorkProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type ViewStep = 'loading' | 'select-ticket' | 'confirm-branch' | 'creating' | 'done' | 'error';

export function StartWork({ context, navigate, refreshContext }: StartWorkProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [tickets, setTickets] = useState<JiraIssue[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<JiraIssue | null>(null);
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState('');
  const [confirmIndex, setConfirmIndex] = useState(0);

  // Load tickets on mount
  useEffect(() => {
    async function loadTickets() {
      if (!context.workspace || !context.workspaceName) {
        setError('No Jira workspace configured for this repository.');
        setStep('error');
        return;
      }

      try {
        const configManager = new ConfigManager();
        const token = await configManager.getJiraToken(context.workspaceName);
        if (!token) {
          setError('Jira token not found. Please run setup again.');
          setStep('error');
          return;
        }

        const client = new JiraClient(
          context.workspace.domain,
          context.workspace.email,
          token
        );

        const myTickets = await client.getMyIssues(context.workspace.defaultProject);
        setTickets(sortTicketsByKey(myTickets));
        setStep('select-ticket');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
        setStep('error');
      }
    }

    loadTickets();
  }, [context.workspace, context.workspaceName]);

  // Handle ticket selection
  const handleTicketSelect = (item: SelectItem<JiraIssue>) => {
    setSelectedTicket(item.value);
    const config = { slugMaxLength: 50 }; // TODO: Get from config
    setBranchName(generateBranchName(item.value.key, item.value.summary, config.slugMaxLength));
    setStep('confirm-branch');
  };

  // Handle branch creation
  const handleCreateBranch = async (checkout: boolean) => {
    if (!selectedTicket) return;

    setStep('creating');

    try {
      const git = new GitManager();

      // Check if branch already exists
      const exists = await git.branchExists(branchName);
      if (exists) {
        setError(`Branch "${branchName}" already exists.`);
        setStep('error');
        return;
      }

      // Create branch
      const configManager = new ConfigManager();
      const config = await configManager.load();
      await git.createBranch(branchName, config.defaults.baseBranch);

      // If checkout requested and branch was created without checkout
      if (checkout) {
        await git.checkoutBranch(branchName);
      }

      // Try to transition ticket to "In Progress"
      if (context.workspace && context.workspaceName) {
        try {
          const token = await configManager.getJiraToken(context.workspaceName);
          if (token) {
            const client = new JiraClient(
              context.workspace.domain,
              context.workspace.email,
              token
            );
            await client.transitionIssue(selectedTicket.key, 'In Progress');
          }
        } catch {
          // Ignore transition errors
        }
      }

      await refreshContext();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
      setStep('error');
    }
  };

  // Handle keyboard input for confirm step
  useInput((input, key) => {
    if (step === 'confirm-branch') {
      if (key.escape) {
        setStep('select-ticket');
        return;
      }
      if (key.upArrow || key.downArrow) {
        setConfirmIndex((prev) => (prev === 0 ? 1 : prev === 1 ? 2 : 0));
      }
      if (key.return) {
        if (confirmIndex === 0) {
          handleCreateBranch(true);
        } else if (confirmIndex === 1) {
          handleCreateBranch(false);
        } else {
          setStep('select-ticket');
        }
      }
    }

    if (step === 'done' || step === 'error') {
      if (key.return || key.escape) {
        navigate('main');
      }
    }
  });

  // Render based on step
  switch (step) {
    case 'loading':
      return (
        <BorderedBox title="Start Work">
          <Spinner label="Loading tickets..." />
        </BorderedBox>
      );

    case 'select-ticket':
      return (
        <BorderedBox title="Start Work">
          <Box flexDirection="column">
            <SelectList
              items={tickets.map((ticket) => ({
                label: `${ticket.key}  ${ticket.summary}`,
                value: ticket,
                description: `[${ticket.status}]`,
              }))}
              onSelect={handleTicketSelect}
              onBack={() => navigate('main')}
              searchable={true}
              searchPlaceholder="Type to search tickets..."
              searchKeys={['label']}
              groupBy={(item) =>
                item.value.assignee ? 'Assigned to Me' : 'Other'
              }
              renderItem={(item, isSelected) => (
                <Box>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '→ ' : '  '}
                  </Text>
                  <Text color={isSelected ? 'cyan' : 'yellow'}>
                    {item.value.key}
                  </Text>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {'  '}
                    {item.value.summary.substring(0, 60)}
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

    case 'confirm-branch':
      return (
        <BorderedBox title="Create Branch">
          <Box flexDirection="column">
            <Text>
              <Text color="yellow">{selectedTicket?.key}</Text>: "{selectedTicket?.summary}"
            </Text>
            <Text dimColor>
              Status: {selectedTicket?.status} | Type: {selectedTicket?.issueType}
              {selectedTicket?.sprint && ` | Sprint: ${selectedTicket.sprint}`}
            </Text>

            <Box marginY={1}>
              <Text dimColor>Branch name: </Text>
              <Text>{branchName}</Text>
            </Box>
            <Box>
              <Text dimColor>Base branch: </Text>
              <Text>main</Text>
            </Box>

            <Box flexDirection="column" marginTop={1}>
              {['Create and checkout', 'Create only (don\'t checkout)', 'Back'].map(
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

    case 'creating':
      return (
        <BorderedBox title="Create Branch">
          <Spinner label="Creating branch..." />
        </BorderedBox>
      );

    case 'done':
      return (
        <BorderedBox title="Success">
          <SuccessMessage
            messages={[
              `Created branch: ${branchName}`,
              'Checked out branch',
              'Ticket marked as "In Progress"',
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
