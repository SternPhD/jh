import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, KeyHints, Spinner, ErrorMessage, SuccessMessage } from '../components/index.js';
import { TextInput } from '../components/text-input.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraSprint, type JiraUser, type IssueType } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { GitManager } from '../services/git.js';
import { generateBranchName } from '../utils/slug.js';

interface CreateTicketFromBranchProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type ViewStep =
  | 'loading'
  | 'select-type'
  | 'edit-title'
  | 'edit-description'
  | 'select-sprint'
  | 'edit-start-date'
  | 'edit-due-date'
  | 'confirm'
  | 'creating'
  | 'done'
  | 'error';

function branchNameToTitle(branchName: string): string {
  // Remove common prefixes like feature/, bugfix/, etc.
  let name = branchName
    .replace(/^(feature|bugfix|fix|hotfix|release|chore)\//, '')
    .replace(/^[A-Z]+-\d+[/-]?/, ''); // Remove ticket ID prefix if present

  // Convert hyphens and underscores to spaces
  name = name.replace(/[-_]/g, ' ');

  // Capitalize first letter of each word
  name = name
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return name || branchName;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function CreateTicketFromBranch({ context, navigate, refreshContext }: CreateTicketFromBranchProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [error, setError] = useState('');

  // Data
  const [issueTypes, setIssueTypes] = useState<IssueType[]>([]);
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [currentUser, setCurrentUser] = useState<JiraUser | null>(null);
  const [commitMessages, setCommitMessages] = useState<string[]>([]);
  const [jiraClient, setJiraClient] = useState<JiraClient | null>(null);

  // Form state
  const [selectedTypeIndex, setSelectedTypeIndex] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSprintIndex, setSelectedSprintIndex] = useState(0);
  const [startDate, setStartDate] = useState(formatDate(new Date()));
  const [dueDate, setDueDate] = useState('');
  const [confirmIndex, setConfirmIndex] = useState(0);

  // Created ticket
  const [createdTicketKey, setCreatedTicketKey] = useState('');
  const [createdBranchName, setCreatedBranchName] = useState('');

  // Load data on mount
  useEffect(() => {
    async function loadData() {
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
        setJiraClient(client);

        // Fetch data in parallel
        const [types, user, sprintList] = await Promise.all([
          client.getIssueTypes(context.workspace.defaultProject),
          client.getCurrentUser(),
          client.getActiveSprints(context.workspace.defaultProject),
        ]);

        setIssueTypes(types);
        setCurrentUser(user);
        setSprints(sprintList);

        // Set default sprint to first active one
        const activeSprintIndex = sprintList.findIndex((s) => s.state === 'active');
        if (activeSprintIndex >= 0) {
          setSelectedSprintIndex(activeSprintIndex);
        }

        // Get commit messages from branch
        const git = new GitManager();
        const config = await configManager.load();
        const commits = await git.getCommitsSince(config.defaults.baseBranch);
        setCommitMessages(commits.map((c) => c.message));

        // Generate suggested title from branch name
        const suggestedTitle = branchNameToTitle(context.currentBranch || '');
        setTitle(suggestedTitle);

        // Generate description from commits
        if (commits.length > 0) {
          const commitList = commits
            .slice(0, 10)
            .map((c) => `- ${c.message}`)
            .join('\n');
          setDescription(`Changes:\n${commitList}`);
        }

        // Set default due date to 1 week from now
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        setDueDate(formatDate(nextWeek));

        setStep('select-type');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setStep('error');
      }
    }

    loadData();
  }, [context.workspace, context.workspaceName, context.currentBranch]);

  const handleCreate = async () => {
    if (!jiraClient || !context.workspace || !currentUser) return;

    setStep('creating');

    try {
      const selectedType = issueTypes[selectedTypeIndex];
      const selectedSprint = sprints[selectedSprintIndex];

      const ticket = await jiraClient.createIssue({
        projectKey: context.workspace.defaultProject,
        summary: title,
        issueType: selectedType?.name || 'Task',
        description: description || undefined,
        assigneeId: currentUser.accountId,
        reporterId: currentUser.accountId,
        sprintId: selectedSprint?.id,
        startDate: startDate || undefined,
        dueDate: dueDate || undefined,
      });

      setCreatedTicketKey(ticket.key);

      // Rename branch to include ticket ID
      const git = new GitManager();
      const configManager = new ConfigManager();
      const config = await configManager.load();
      const newBranchName = generateBranchName(ticket.key, title, config.defaults.slugMaxLength);

      try {
        await git.renameBranch(context.currentBranch!, newBranchName);
        setCreatedBranchName(newBranchName);
      } catch {
        // Branch rename failed, but ticket was created
        setCreatedBranchName(context.currentBranch || '');
      }

      await refreshContext();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
      setStep('error');
    }
  };

  useInput((input, key) => {
    if (step === 'select-type') {
      if (key.escape) {
        navigate('main');
        return;
      }
      if (key.upArrow) {
        setSelectedTypeIndex((prev) => (prev > 0 ? prev - 1 : issueTypes.length - 1));
      }
      if (key.downArrow) {
        setSelectedTypeIndex((prev) => (prev < issueTypes.length - 1 ? prev + 1 : 0));
      }
      if (key.return) {
        setStep('edit-title');
      }
    }

    if (step === 'select-sprint') {
      if (key.escape) {
        setStep('edit-description');
        return;
      }
      if (key.upArrow) {
        setSelectedSprintIndex((prev) => (prev > 0 ? prev - 1 : sprints.length - 1));
      }
      if (key.downArrow) {
        setSelectedSprintIndex((prev) => (prev < sprints.length - 1 ? prev + 1 : 0));
      }
      if (key.return) {
        setStep('edit-start-date');
      }
    }

    if (step === 'confirm') {
      if (key.escape) {
        setStep('edit-due-date');
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

    if (step === 'done' || step === 'error') {
      if (key.return || key.escape) {
        navigate('main');
      }
    }
  });

  switch (step) {
    case 'loading':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <Spinner label="Loading..." />
        </BorderedBox>
      );

    case 'select-type':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Branch: </Text>
              <Text color="cyan">{context.currentBranch}</Text>
            </Box>
            <Box marginBottom={1}>
              <Text>What type of work is this?</Text>
            </Box>
            {issueTypes.map((type, index) => (
              <Box key={type.id}>
                <Text color={index === selectedTypeIndex ? 'cyan' : undefined}>
                  {index === selectedTypeIndex ? '→ ' : '  '}
                  {type.name}
                </Text>
                {type.description && (
                  <Text dimColor> - {type.description.substring(0, 40)}</Text>
                )}
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

    case 'edit-title':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <TextInput
            label="Title (suggested from branch name):"
            value={title}
            onChange={setTitle}
            onSubmit={() => setStep('edit-description')}
            onBack={() => setStep('select-type')}
            placeholder="Enter ticket title..."
          />
        </BorderedBox>
      );

    case 'edit-description':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <TextInput
            label="Description (generated from commits):"
            value={description}
            onChange={setDescription}
            onSubmit={() => sprints.length > 0 ? setStep('select-sprint') : setStep('edit-start-date')}
            onBack={() => setStep('edit-title')}
            placeholder="Enter description..."
            multiline
          />
        </BorderedBox>
      );

    case 'select-sprint':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>Select sprint:</Text>
            </Box>
            {sprints.map((sprint, index) => (
              <Box key={sprint.id}>
                <Text color={index === selectedSprintIndex ? 'cyan' : undefined}>
                  {index === selectedSprintIndex ? '→ ' : '  '}
                  {sprint.name}
                </Text>
                <Text dimColor> ({sprint.state})</Text>
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

    case 'edit-start-date':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <TextInput
            label="Start date (YYYY-MM-DD):"
            value={startDate}
            onChange={setStartDate}
            onSubmit={() => setStep('edit-due-date')}
            onBack={() => sprints.length > 0 ? setStep('select-sprint') : setStep('edit-description')}
            placeholder="YYYY-MM-DD"
          />
        </BorderedBox>
      );

    case 'edit-due-date':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <TextInput
            label="Due date (YYYY-MM-DD):"
            value={dueDate}
            onChange={setDueDate}
            onSubmit={() => setStep('confirm')}
            onBack={() => setStep('edit-start-date')}
            placeholder="YYYY-MM-DD"
          />
        </BorderedBox>
      );

    case 'confirm':
      return (
        <BorderedBox title="Create Ticket from Branch">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Review ticket details:</Text>
            </Box>

            <Box>
              <Text dimColor>Type: </Text>
              <Text>{issueTypes[selectedTypeIndex]?.name}</Text>
            </Box>
            <Box>
              <Text dimColor>Title: </Text>
              <Text>{title}</Text>
            </Box>
            <Box>
              <Text dimColor>Assignee: </Text>
              <Text>{currentUser?.displayName}</Text>
            </Box>
            <Box>
              <Text dimColor>Reporter: </Text>
              <Text>{currentUser?.displayName}</Text>
            </Box>
            {sprints.length > 0 && (
              <Box>
                <Text dimColor>Sprint: </Text>
                <Text>{sprints[selectedSprintIndex]?.name}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>Start: </Text>
              <Text>{startDate || '(not set)'}</Text>
            </Box>
            <Box>
              <Text dimColor>Due: </Text>
              <Text>{dueDate || '(not set)'}</Text>
            </Box>

            {description && (
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>Description:</Text>
                <Text>{description.substring(0, 100)}{description.length > 100 ? '...' : ''}</Text>
              </Box>
            )}

            <Box marginTop={1} flexDirection="column">
              {['Create ticket and rename branch', 'Cancel'].map((label, index) => (
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
        <BorderedBox title="Create Ticket from Branch">
          <Spinner label="Creating ticket..." />
        </BorderedBox>
      );

    case 'done':
      return (
        <BorderedBox title="Success">
          <SuccessMessage
            messages={[
              `Created ticket: ${createdTicketKey}`,
              `Branch renamed to: ${createdBranchName}`,
              `Assigned to: ${currentUser?.displayName}`,
              sprints.length > 0 ? `Added to sprint: ${sprints[selectedSprintIndex]?.name}` : '',
            ].filter(Boolean)}
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
