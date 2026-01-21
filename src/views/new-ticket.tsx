import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, SelectList, TextInput, KeyHints, Spinner, SuccessMessage, ErrorMessage, type SelectItem } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type IssueType, type JiraIssue, type JiraSprint } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { GitManager } from '../services/git.js';
import { generateBranchName } from '../utils/slug.js';

interface NewTicketProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type ViewStep = 'loading' | 'select-type' | 'enter-title' | 'enter-description' | 'select-sprint' | 'confirm' | 'creating' | 'done' | 'error';

export function NewTicket({ context, navigate, refreshContext }: NewTicketProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [issueTypes, setIssueTypes] = useState<IssueType[]>([]);
  const [selectedType, setSelectedType] = useState<IssueType | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null);
  const [sprintIndex, setSprintIndex] = useState(0);
  const [createdTicket, setCreatedTicket] = useState<JiraIssue | null>(null);
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState('');
  const [confirmIndex, setConfirmIndex] = useState(0);

  // Load issue types on mount
  useEffect(() => {
    async function loadIssueTypes() {
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

        // Load issue types and sprints in parallel
        const [types, activeSprints] = await Promise.all([
          client.getIssueTypes(context.workspace.defaultProject),
          client.getActiveSprints(context.workspace.defaultProject).catch(() => [] as JiraSprint[]),
        ]);

        setIssueTypes(types);
        setSprints(activeSprints);

        setStep('select-type');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load issue types');
        setStep('error');
      }
    }

    loadIssueTypes();
  }, [context.workspace, context.workspaceName]);

  const handleTypeSelect = (item: SelectItem<IssueType>) => {
    setSelectedType(item.value);
    setStep('enter-title');
  };

  const handleTitleSubmit = () => {
    if (title.trim()) {
      setStep('enter-description');
    }
  };

  const handleDescriptionSubmit = () => {
    // If there are active sprints, ask about adding to sprint
    if (sprints.length > 0) {
      // Default to first active sprint
      const activeSprint = sprints.find((s) => s.state === 'active');
      if (activeSprint) {
        setSelectedSprintId(activeSprint.id);
        setSprintIndex(0); // "Add to sprint" is the first option
      }
      setStep('select-sprint');
    } else {
      setStep('confirm');
    }
  };

  const handleCreate = async (createBranch: boolean) => {
    if (!selectedType || !context.workspace || !context.workspaceName) return;

    setStep('creating');

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

      // Create the ticket
      const ticket = await client.createIssue({
        projectKey: context.workspace.defaultProject,
        summary: title,
        issueType: selectedType.name,
        description: description || undefined,
        sprintId: selectedSprintId || undefined,
      });

      setCreatedTicket(ticket);

      // Create branch if requested
      if (createBranch) {
        const config = await configManager.load();
        const branch = generateBranchName(ticket.key, title, config.defaults.slugMaxLength);
        setBranchName(branch);

        const git = new GitManager();
        await git.createBranch(branch, config.defaults.baseBranch);
        await git.checkoutBranch(branch);
      }

      await refreshContext();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
      setStep('error');
    }
  };

  // Handle keyboard input for sprint selection and confirm steps
  useInput((input, key) => {
    if (step === 'select-sprint') {
      if (key.escape) {
        setStep('enter-description');
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSprintIndex((prev) => (prev === 0 ? 1 : 0));
      }
      if (key.return) {
        if (sprintIndex === 0) {
          // Add to current sprint - selectedSprintId already set
          setStep('confirm');
        } else {
          // Skip sprint
          setSelectedSprintId(null);
          setStep('confirm');
        }
      }
    }

    if (step === 'confirm') {
      if (key.escape) {
        if (sprints.length > 0) {
          setStep('select-sprint');
        } else {
          setStep('enter-description');
        }
        return;
      }
      if (key.upArrow || key.downArrow) {
        setConfirmIndex((prev) => (prev === 0 ? 1 : prev === 1 ? 2 : 0));
      }
      if (key.return) {
        if (confirmIndex === 0) {
          handleCreate(true);
        } else if (confirmIndex === 1) {
          handleCreate(false);
        } else {
          if (sprints.length > 0) {
            setStep('select-sprint');
          } else {
            setStep('enter-description');
          }
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
        <BorderedBox title="New Ticket">
          <Spinner label="Loading..." />
        </BorderedBox>
      );

    case 'select-type':
      return (
        <BorderedBox title="New Ticket">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>
                Project: <Text color="yellow">{context.workspace?.defaultProject}</Text>
              </Text>
            </Box>
            <Box marginBottom={1}>
              <Text>What type of work?</Text>
            </Box>
            <SelectList
              items={issueTypes.map((type) => ({
                label: type.name,
                value: type,
                description: type.description,
              }))}
              onSelect={handleTypeSelect}
              onBack={() => navigate('main')}
            />
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

    case 'enter-title':
      return (
        <BorderedBox title="New Ticket">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>
                Project: {context.workspace?.defaultProject} | Type: {selectedType?.name}
              </Text>
            </Box>
            <TextInput
              label="Title:"
              value={title}
              onChange={setTitle}
              onSubmit={handleTitleSubmit}
              onBack={() => setStep('select-type')}
              placeholder="Enter ticket title"
            />
          </Box>
        </BorderedBox>
      );

    case 'enter-description':
      return (
        <BorderedBox title="New Ticket">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>
                Project: {context.workspace?.defaultProject} | Type: {selectedType?.name}
              </Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>
                Title: {title}
              </Text>
            </Box>
            <TextInput
              label="Description (optional):"
              value={description}
              onChange={setDescription}
              onSubmit={handleDescriptionSubmit}
              onBack={() => setStep('enter-title')}
              placeholder="Enter description or press Enter to skip"
              multiline={true}
            />
          </Box>
        </BorderedBox>
      );

    case 'select-sprint': {
      const activeSprint = sprints.find((s) => s.state === 'active');
      return (
        <BorderedBox title="Add to Sprint?">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>
                Project: {context.workspace?.defaultProject} | Type: {selectedType?.name}
              </Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>
                Title: {title}
              </Text>
            </Box>

            {activeSprint && (
              <Box marginBottom={1}>
                <Text>Current sprint: </Text>
                <Text color="yellow">{activeSprint.name}</Text>
              </Box>
            )}

            <Box flexDirection="column" marginTop={1}>
              {[
                `Add to ${activeSprint?.name || 'current sprint'}`,
                'Skip (no sprint)',
              ].map((label, index) => (
                <Box key={label}>
                  <Text color={index === sprintIndex ? 'cyan' : undefined}>
                    {index === sprintIndex ? '→ ' : '  '}
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
    }

    case 'confirm': {
      const sprintName = selectedSprintId
        ? sprints.find((s) => s.id === selectedSprintId)?.name
        : null;
      return (
        <BorderedBox title="Create Ticket?">
          <Box flexDirection="column">
            <Box>
              <Text dimColor>Project: </Text>
              <Text>{context.workspace?.defaultProject}</Text>
            </Box>
            <Box>
              <Text dimColor>Type: </Text>
              <Text>{selectedType?.name}</Text>
            </Box>
            <Box>
              <Text dimColor>Title: </Text>
              <Text>{title}</Text>
            </Box>
            {description && (
              <Box>
                <Text dimColor>Description: </Text>
                <Text>{description.substring(0, 50)}...</Text>
              </Box>
            )}
            {sprintName && (
              <Box>
                <Text dimColor>Sprint: </Text>
                <Text color="yellow">{sprintName}</Text>
              </Box>
            )}

            <Box flexDirection="column" marginTop={1}>
              {['Create ticket and branch', 'Create ticket only', 'Back'].map(
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
    }

    case 'creating':
      return (
        <BorderedBox title="New Ticket">
          <Spinner label="Creating ticket..." />
        </BorderedBox>
      );

    case 'done': {
      const addedToSprint = selectedSprintId
        ? sprints.find((s) => s.id === selectedSprintId)?.name
        : null;
      return (
        <BorderedBox title="Success">
          <SuccessMessage
            messages={[
              `Created ticket: ${createdTicket?.key}`,
              ...(addedToSprint ? [`Added to sprint: ${addedToSprint}`] : []),
              ...(branchName
                ? [`Created branch: ${branchName}`, 'Checked out branch']
                : []),
            ]}
          />
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue...</Text>
          </Box>
        </BorderedBox>
      );
    }

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
