import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, KeyHints, Spinner, ErrorMessage, SuccessMessage } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraIssue, type JiraTransition } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';

interface UpdateTicketStatusProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type ViewStep = 'loading' | 'select' | 'updating' | 'done' | 'error';

export function UpdateTicketStatus({ context, navigate }: UpdateTicketStatusProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [error, setError] = useState('');

  const [ticket, setTicket] = useState<JiraIssue | null>(null);
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [newStatus, setNewStatus] = useState('');

  // Store client for later use
  const [client, setClient] = useState<JiraClient | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!context.workspace || !context.workspaceName || !context.linkedTicketId) {
        setError('No linked ticket found.');
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

        const jiraClient = new JiraClient(
          context.workspace.domain,
          context.workspace.email,
          token
        );
        setClient(jiraClient);

        // Fetch ticket details
        const ticketData = await jiraClient.getIssue(context.linkedTicketId);
        if (!ticketData) {
          setError('Ticket not found.');
          setStep('error');
          return;
        }
        setTicket(ticketData);

        // Fetch available transitions
        const availableTransitions = await jiraClient.getAvailableTransitions(context.linkedTicketId);
        if (availableTransitions.length === 0) {
          setError('No status transitions available for this ticket.');
          setStep('error');
          return;
        }
        setTransitions(availableTransitions);
        setStep('select');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setStep('error');
      }
    }

    loadData();
  }, [context.workspace, context.workspaceName, context.linkedTicketId]);

  const handleTransition = async () => {
    if (!client || !context.linkedTicketId) return;

    const selectedTransition = transitions[selectedIndex];
    setNewStatus(selectedTransition.toStatus);
    setStep('updating');

    try {
      await client.transitionIssueById(context.linkedTicketId, selectedTransition.id);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
      setStep('error');
    }
  };

  useInput((input, key) => {
    if (step === 'select') {
      if (key.escape) {
        navigate('main');
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : transitions.length - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < transitions.length - 1 ? prev + 1 : 0));
      }
      if (key.return) {
        handleTransition();
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
        <BorderedBox title="Update Ticket Status">
          <Spinner label="Loading ticket and transitions..." />
        </BorderedBox>
      );

    case 'select':
      return (
        <BorderedBox title="Update Ticket Status">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Ticket: </Text>
              <Text color="yellow">{ticket?.key}</Text>
              <Text dimColor> - {ticket?.summary}</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Current Status: </Text>
              <Text color="cyan">{ticket?.status}</Text>
            </Box>

            <Box marginTop={1} marginBottom={1}>
              <Text bold>Select new status:</Text>
            </Box>

            <Box flexDirection="column">
              {transitions.map((transition, index) => (
                <Box key={transition.id}>
                  <Text color={index === selectedIndex ? 'cyan' : undefined}>
                    {index === selectedIndex ? '→ ' : '  '}
                    {transition.name}
                    {transition.toStatus !== transition.name && (
                      <Text dimColor> → {transition.toStatus}</Text>
                    )}
                  </Text>
                </Box>
              ))}
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

    case 'updating':
      return (
        <BorderedBox title="Update Ticket Status">
          <Spinner label={`Updating status to "${newStatus}"...`} />
        </BorderedBox>
      );

    case 'done':
      return (
        <BorderedBox title="Success">
          <SuccessMessage
            messages={[
              'Ticket status updated!',
              `${ticket?.key}: ${ticket?.status} → ${newStatus}`,
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
