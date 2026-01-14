import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BorderedBox, KeyHints, Spinner, ErrorMessage, SuccessMessage } from '../components/index.js';
import { TextInput } from '../components/text-input.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraIssue } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { getJiraIssueUrl } from '../utils/browser.js';

const execAsync = promisify(exec);

interface CreatePRProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type ViewStep =
  | 'loading'
  | 'push-needed'
  | 'pushing'
  | 'edit-title'
  | 'edit-body'
  | 'confirm'
  | 'creating'
  | 'done'
  | 'error';

export function CreatePR({ context, navigate, refreshContext }: CreatePRProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [error, setError] = useState('');

  // Data
  const [ticket, setTicket] = useState<JiraIssue | null>(null);
  const [jiraUrl, setJiraUrl] = useState('');
  const [needsPush, setNeedsPush] = useState(false);
  const [baseBranch, setBaseBranch] = useState('main');

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pushIndex, setPushIndex] = useState(0);
  const [confirmIndex, setConfirmIndex] = useState(0);

  // Created PR
  const [prUrl, setPrUrl] = useState('');
  const [doneIndex, setDoneIndex] = useState(0);

  // Load data on mount
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

        const client = new JiraClient(
          context.workspace.domain,
          context.workspace.email,
          token
        );

        // Fetch ticket details
        const ticketData = await client.getIssue(context.linkedTicketId);
        if (!ticketData) {
          setError('Ticket not found.');
          setStep('error');
          return;
        }
        setTicket(ticketData);

        // Get Jira URL
        const url = getJiraIssueUrl(context.workspace.domain, context.linkedTicketId);
        setJiraUrl(url);

        // Get config for base branch
        const config = await configManager.load();
        setBaseBranch(config.defaults.baseBranch);

        // Check if branch needs to be pushed
        let branchNeedsPush = false;
        try {
          const { stdout } = await execAsync('git status -sb');
          // Check if branch has no upstream or is ahead
          if (stdout.includes('...') === false || stdout.includes('ahead')) {
            branchNeedsPush = true;
            setNeedsPush(true);
          }
        } catch {
          // Assume we need to push
          branchNeedsPush = true;
          setNeedsPush(true);
        }

        // Pre-fill PR title with ticket key and summary
        setTitle(`${ticketData.key}: ${ticketData.summary}`);

        // Pre-fill PR body with Jira link and description
        const bodyParts = [
          `## Jira Ticket`,
          `[${ticketData.key}](${url})`,
          '',
          `## Summary`,
          ticketData.summary,
          '',
        ];

        if (ticketData.description) {
          bodyParts.push('## Description');
          bodyParts.push(ticketData.description);
          bodyParts.push('');
        }

        bodyParts.push('## Test Plan');
        bodyParts.push('- [ ] TODO: Add test plan');

        setBody(bodyParts.join('\n'));

        // If branch needs to be pushed, show that step first
        if (branchNeedsPush) {
          setStep('push-needed');
        } else {
          setStep('edit-title');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setStep('error');
      }
    }

    loadData();
  }, [context.workspace, context.workspaceName, context.linkedTicketId]);

  const handlePush = async () => {
    setStep('pushing');

    try {
      try {
        await execAsync(`git push -u origin ${context.currentBranch}`);
      } catch (pushError: any) {
        // If push fails because remote exists, try without -u
        if (pushError.message?.includes('already exists')) {
          await execAsync(`git push origin ${context.currentBranch}`);
        } else {
          throw pushError;
        }
      }
      setNeedsPush(false);
      setStep('edit-title');
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to push branch');
      setStep('error');
    }
  };

  const handleCreate = async () => {
    if (!ticket) return;

    setStep('creating');

    try {
      // Always push the branch before creating PR to ensure it's on the remote
      try {
        await execAsync(`git push -u origin ${context.currentBranch}`, { timeout: 60000 });
      } catch (pushError: any) {
        // If push fails because upstream already set, try without -u
        if (pushError.message?.includes('already exists') || pushError.message?.includes('set up to track')) {
          await execAsync(`git push origin ${context.currentBranch}`, { timeout: 60000 });
        } else if (!pushError.message?.includes('Everything up-to-date')) {
          // Re-throw if it's not just "already up to date"
          throw new Error(`Failed to push branch: ${pushError.message}`);
        }
      }

      // Create PR using gh CLI
      // Escape special characters in title and body for shell
      const escapedTitle = title.replace(/"/g, '\\"');
      const escapedBody = body.replace(/"/g, '\\"').replace(/`/g, '\\`');

      const { stdout } = await execAsync(
        `gh pr create --base "${baseBranch}" --title "${escapedTitle}" --body "${escapedBody}"`,
        { timeout: 30000 }
      );

      // Extract PR URL from output
      const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
      if (urlMatch) {
        setPrUrl(urlMatch[0]);
      } else {
        setPrUrl(stdout.trim());
      }

      setStep('done');
    } catch (err: any) {
      // Check if PR already exists
      if (err.message?.includes('already exists')) {
        setError('A pull request already exists for this branch.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create PR');
      }
      setStep('error');
    }
  };

  useInput((input, key) => {
    if (step === 'push-needed') {
      if (key.escape) {
        navigate('main');
        return;
      }
      if (key.upArrow || key.downArrow) {
        setPushIndex((prev) => (prev === 0 ? 1 : 0));
      }
      if (key.return) {
        if (pushIndex === 0) {
          handlePush();
        } else {
          navigate('main');
        }
      }
    }

    if (step === 'confirm') {
      if (key.escape) {
        setStep('edit-body');
        return;
      }
      if (key.upArrow || key.downArrow) {
        setConfirmIndex((prev) => (prev === 0 ? 1 : 0));
      }
      if (key.return) {
        if (confirmIndex === 0) {
          handleCreate();
        } else {
          navigate('main');
        }
      }
    }

    if (step === 'done') {
      if (key.escape) {
        navigate('main');
        return;
      }
      if (key.upArrow || key.downArrow) {
        setDoneIndex((prev) => (prev === 0 ? 1 : 0));
      }
      if (key.return) {
        if (doneIndex === 0) {
          navigate('update-ticket-status');
        } else {
          navigate('main');
        }
      }
    }

    if (step === 'error') {
      if (key.return || key.escape) {
        navigate('main');
      }
    }
  });

  switch (step) {
    case 'loading':
      return (
        <BorderedBox title="Create Pull Request">
          <Spinner label="Loading ticket details..." />
        </BorderedBox>
      );

    case 'push-needed':
      return (
        <BorderedBox title="Create Pull Request">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Branch needs to be pushed</Text>
            </Box>

            <Box>
              <Text dimColor>Branch: </Text>
              <Text color="cyan">{context.currentBranch}</Text>
            </Box>
            <Box>
              <Text dimColor>Ticket: </Text>
              <Text color="yellow">{ticket?.key}</Text>
              <Text dimColor> - {ticket?.summary}</Text>
            </Box>

            <Box marginTop={1}>
              <Text>Your branch has not been pushed to the remote repository yet.</Text>
            </Box>
            <Box>
              <Text>Would you like to push it now?</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              {['Push branch to origin', 'Cancel'].map((label, index) => (
                <Box key={label}>
                  <Text color={index === pushIndex ? 'cyan' : undefined}>
                    {index === pushIndex ? '→ ' : '  '}
                    {label}
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

    case 'pushing':
      return (
        <BorderedBox title="Create Pull Request">
          <Spinner label="Pushing branch to origin..." />
        </BorderedBox>
      );

    case 'edit-title':
      return (
        <BorderedBox title="Create Pull Request">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Ticket: </Text>
              <Text color="yellow">{ticket?.key}</Text>
              <Text dimColor> - {ticket?.summary}</Text>
            </Box>
            <TextInput
              label="PR Title:"
              value={title}
              onChange={setTitle}
              onSubmit={() => setStep('edit-body')}
              onBack={() => navigate('main')}
              placeholder="Enter PR title..."
            />
          </Box>
        </BorderedBox>
      );

    case 'edit-body':
      return (
        <BorderedBox title="Create Pull Request">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Jira Link: </Text>
              <Text color="cyan">{jiraUrl}</Text>
            </Box>
            <TextInput
              label="PR Description (includes Jira link):"
              value={body}
              onChange={setBody}
              onSubmit={() => setStep('confirm')}
              onBack={() => setStep('edit-title')}
              placeholder="Enter PR description..."
              multiline
            />
          </Box>
        </BorderedBox>
      );

    case 'confirm':
      return (
        <BorderedBox title="Create Pull Request">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Review PR details:</Text>
            </Box>

            <Box>
              <Text dimColor>Branch: </Text>
              <Text>{context.currentBranch}</Text>
              <Text dimColor> → </Text>
              <Text>{baseBranch}</Text>
            </Box>
            <Box>
              <Text dimColor>Title: </Text>
              <Text>{title}</Text>
            </Box>
            <Box>
              <Text dimColor>Jira: </Text>
              <Text color="cyan">{ticket?.key}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Description preview:</Text>
              <Text>{body.substring(0, 150)}{body.length > 150 ? '...' : ''}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              {['Create Pull Request', 'Cancel'].map((label, index) => (
                <Box key={label}>
                  <Text color={index === confirmIndex ? 'cyan' : undefined}>
                    {index === confirmIndex ? '→ ' : '  '}
                    {label}
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

    case 'creating':
      return (
        <BorderedBox title="Create Pull Request">
          <Spinner label="Creating PR..." />
        </BorderedBox>
      );

    case 'done':
      return (
        <BorderedBox title="Success">
          <SuccessMessage
            messages={[
              'Pull request created successfully!',
              `PR: ${prUrl}`,
              `Linked to: ${ticket?.key}`,
            ]}
          />
          <Box marginTop={1} flexDirection="column">
            <Box marginBottom={1}>
              <Text>What would you like to do next?</Text>
            </Box>
            {['Update ticket status', 'Back to menu'].map((label, index) => (
              <Box key={label}>
                <Text color={index === doneIndex ? 'cyan' : undefined}>
                  {index === doneIndex ? '→ ' : '  '}
                  {label}
                </Text>
              </Box>
            ))}
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
