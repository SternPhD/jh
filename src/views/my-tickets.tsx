import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, SelectList, KeyHints, Spinner, ErrorMessage, type SelectItem } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { JiraClient, type JiraIssue, type JiraTransition } from '../clients/jira.js';
import { ConfigManager } from '../services/config.js';
import { GitManager } from '../services/git.js';
import { generateBranchName, sortTicketsByKey } from '../utils/slug.js';
import { openInBrowser, getJiraIssueUrl } from '../utils/browser.js';

interface MyTicketsProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
}

type ViewStep = 'loading' | 'list' | 'detail' | 'loading-children' | 'children' | 'child-detail' | 'creating-branch' | 'error';
type Filter = 'active' | 'todo' | 'in-progress' | 'done' | 'all';

export function MyTickets({ context, navigate, refreshContext }: MyTicketsProps) {
  const [step, setStep] = useState<ViewStep>('loading');
  const [tickets, setTickets] = useState<JiraIssue[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<JiraIssue[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<JiraIssue | null>(null);
  const [childIssues, setChildIssues] = useState<JiraIssue[]>([]);
  const [selectedChildTicket, setSelectedChildTicket] = useState<JiraIssue | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [error, setError] = useState('');
  const [detailIndex, setDetailIndex] = useState(0);
  const [childDetailIndex, setChildDetailIndex] = useState(0);
  const jiraClientRef = useRef<JiraClient | null>(null);

  // Status change state
  const [availableTransitions, setAvailableTransitions] = useState<JiraTransition[]>([]);
  const [selectedTransitionIndex, setSelectedTransitionIndex] = useState(-1);
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [childAvailableTransitions, setChildAvailableTransitions] = useState<JiraTransition[]>([]);
  const [childSelectedTransitionIndex, setChildSelectedTransitionIndex] = useState(-1);
  const [isEditingChildStatus, setIsEditingChildStatus] = useState(false);

  // Load tickets on mount
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
        jiraClientRef.current = client;

        // Get all my tickets
        const myTickets = await client.searchIssues({
          assignee: 'currentUser',
          project: context.workspace.defaultProject,
        });

        const sortedTickets = sortTicketsByKey(myTickets);
        setTickets(sortedTickets);
        setFilteredTickets(sortedTickets);
        setStep('list');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
        setStep('error');
      }
    }

    loadTickets();
  }, [context.workspace, context.workspaceName]);

  // Filter tickets when filter changes
  useEffect(() => {
    const doneStatuses = ['done', 'closed', 'resolved'];
    let filtered: JiraIssue[];

    if (filter === 'all') {
      // Show everything including done
      filtered = tickets;
    } else if (filter === 'active') {
      // Show everything except done/closed/resolved
      filtered = tickets.filter((t) =>
        !doneStatuses.some((s) => t.status.toLowerCase().includes(s))
      );
    } else {
      const statusMap: Record<Exclude<Filter, 'all' | 'active'>, string[]> = {
        todo: ['To Do', 'Open', 'Reopened'],
        'in-progress': ['In Progress'],
        done: ['Done', 'Closed', 'Resolved'],
      };
      const statuses = statusMap[filter];
      filtered = tickets.filter((t) =>
        statuses.some((s) => t.status.toLowerCase().includes(s.toLowerCase()))
      );
    }

    // Sort filtered results
    setFilteredTickets(sortTicketsByKey(filtered));
  }, [filter, tickets]);

  const handleTicketSelect = async (item: SelectItem<JiraIssue>) => {
    setSelectedTicket(item.value);
    setDetailIndex(0);
    setIsEditingStatus(false);
    setSelectedTransitionIndex(-1);
    setStep('detail');

    // Load available transitions
    if (jiraClientRef.current) {
      const transitions = await jiraClientRef.current.getAvailableTransitions(item.value.key);
      setAvailableTransitions(transitions);
    }
  };

  const handleStartWork = async () => {
    if (!selectedTicket || !context.workspace || !context.workspaceName) return;

    setStep('creating-branch');

    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();
      const branchName = generateBranchName(
        selectedTicket.key,
        selectedTicket.summary,
        config.defaults.slugMaxLength
      );

      const git = new GitManager();
      const exists = await git.branchExists(branchName);
      if (exists) {
        // Just checkout existing branch
        await git.checkoutBranch(branchName);
      } else {
        await git.createBranch(branchName, config.defaults.baseBranch);
      }

      await refreshContext();
      navigate('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
      setStep('error');
    }
  };

  const handleViewInBrowser = async (ticket: JiraIssue | null) => {
    if (!ticket || !context.workspace) return;
    const url = getJiraIssueUrl(context.workspace.domain, ticket.key);
    try {
      await openInBrowser(url);
    } catch {
      // Silently fail - user might not have a browser
    }
  };

  const handleSaveStatus = async (ticket: JiraIssue, transition: JiraTransition) => {
    if (!jiraClientRef.current) return;

    setIsSavingStatus(true);
    try {
      await jiraClientRef.current.transitionIssueById(ticket.key, transition.id);
      // Update the ticket's status in local state with the destination status
      const updatedTicket = { ...ticket, status: transition.toStatus };

      // Update in tickets list
      setTickets((prev) =>
        prev.map((t) => (t.key === ticket.key ? updatedTicket : t))
      );

      // Update selected ticket
      if (selectedTicket?.key === ticket.key) {
        setSelectedTicket(updatedTicket);
      }

      // Update child ticket if applicable
      if (selectedChildTicket?.key === ticket.key) {
        setSelectedChildTicket(updatedTicket);
        setChildIssues((prev) =>
          prev.map((t) => (t.key === ticket.key ? updatedTicket : t))
        );
      }

      // Reload transitions for the new status
      const newTransitions = await jiraClientRef.current.getAvailableTransitions(ticket.key);
      if (selectedTicket?.key === ticket.key) {
        setAvailableTransitions(newTransitions);
      }
      if (selectedChildTicket?.key === ticket.key) {
        setChildAvailableTransitions(newTransitions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setIsSavingStatus(false);
      setIsEditingStatus(false);
      setIsEditingChildStatus(false);
      setSelectedTransitionIndex(-1);
      setChildSelectedTransitionIndex(-1);
    }
  };

  const handleViewChildIssues = async () => {
    if (!selectedTicket || !jiraClientRef.current) return;

    setStep('loading-children');
    try {
      const children = await jiraClientRef.current.getChildIssues(selectedTicket.key);
      setChildIssues(sortTicketsByKey(children));
      setStep('children');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load child issues');
      setStep('error');
    }
  };

  const handleChildSelect = async (item: SelectItem<JiraIssue>) => {
    setSelectedChildTicket(item.value);
    setChildDetailIndex(0);
    setIsEditingChildStatus(false);
    setChildSelectedTransitionIndex(-1);
    setStep('child-detail');

    // Load available transitions for child
    if (jiraClientRef.current) {
      const transitions = await jiraClientRef.current.getAvailableTransitions(item.value.key);
      setChildAvailableTransitions(transitions);
    }
  };

  const handleStartWorkOnChild = async () => {
    if (!selectedChildTicket || !context.workspace || !context.workspaceName) return;

    setStep('creating-branch');

    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();
      const branchName = generateBranchName(
        selectedChildTicket.key,
        selectedChildTicket.summary,
        config.defaults.slugMaxLength
      );

      const git = new GitManager();
      const exists = await git.branchExists(branchName);
      if (exists) {
        await git.checkoutBranch(branchName);
      } else {
        await git.createBranch(branchName, config.defaults.baseBranch);
      }

      await refreshContext();
      navigate('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
      setStep('error');
    }
  };

  const isSelectedTicketEpic = selectedTicket && jiraClientRef.current?.isEpic(selectedTicket);

  // Handle keyboard input
  useInput((input, key) => {
    if (step === 'list') {
      if (key.tab) {
        const filters: Filter[] = ['active', 'todo', 'in-progress', 'done', 'all'];
        const currentIndex = filters.indexOf(filter);
        setFilter(filters[(currentIndex + 1) % filters.length]);
      }
    }

    if (step === 'detail') {
      if (isSavingStatus) return; // Don't allow input while saving

      if (key.escape) {
        if (isEditingStatus) {
          setIsEditingStatus(false);
          setSelectedTransitionIndex(-1);
        } else {
          setStep('list');
        }
        return;
      }

      // Handle status editing with left/right arrows
      if (key.leftArrow && availableTransitions.length > 0) {
        setIsEditingStatus(true);
        setSelectedTransitionIndex((prev) => {
          if (prev <= 0) return availableTransitions.length - 1;
          return prev - 1;
        });
        return;
      }
      if (key.rightArrow && availableTransitions.length > 0) {
        setIsEditingStatus(true);
        setSelectedTransitionIndex((prev) => {
          if (prev >= availableTransitions.length - 1 || prev < 0) return 0;
          return prev + 1;
        });
        return;
      }

      // Save status change with Return when editing
      if (key.return && isEditingStatus && selectedTransitionIndex >= 0) {
        const transition = availableTransitions[selectedTransitionIndex];
        if (selectedTicket && transition) {
          handleSaveStatus(selectedTicket, transition);
        }
        return;
      }

      // Menu options depend on whether ticket is an epic
      const menuItemCount = isSelectedTicketEpic ? 4 : 3;
      if (key.upArrow) {
        setDetailIndex((prev) => (prev === 0 ? menuItemCount - 1 : prev - 1));
      }
      if (key.downArrow) {
        setDetailIndex((prev) => (prev === menuItemCount - 1 ? 0 : prev + 1));
      }
      if (key.return && !isEditingStatus) {
        if (isSelectedTicketEpic) {
          // Epic menu: Start work, View children, View in browser, Back
          if (detailIndex === 0) {
            handleStartWork();
          } else if (detailIndex === 1) {
            handleViewChildIssues();
          } else if (detailIndex === 2) {
            handleViewInBrowser(selectedTicket);
          } else {
            setStep('list');
          }
        } else {
          // Non-epic menu: Start work, View in browser, Back
          if (detailIndex === 0) {
            handleStartWork();
          } else if (detailIndex === 1) {
            handleViewInBrowser(selectedTicket);
          } else {
            setStep('list');
          }
        }
      }
    }

    if (step === 'children') {
      if (key.escape) {
        setStep('detail');
      }
    }

    if (step === 'child-detail') {
      if (isSavingStatus) return; // Don't allow input while saving

      if (key.escape) {
        if (isEditingChildStatus) {
          setIsEditingChildStatus(false);
          setChildSelectedTransitionIndex(-1);
        } else {
          setStep('children');
        }
        return;
      }

      // Handle status editing with left/right arrows
      if (key.leftArrow && childAvailableTransitions.length > 0) {
        setIsEditingChildStatus(true);
        setChildSelectedTransitionIndex((prev) => {
          if (prev <= 0) return childAvailableTransitions.length - 1;
          return prev - 1;
        });
        return;
      }
      if (key.rightArrow && childAvailableTransitions.length > 0) {
        setIsEditingChildStatus(true);
        setChildSelectedTransitionIndex((prev) => {
          if (prev >= childAvailableTransitions.length - 1 || prev < 0) return 0;
          return prev + 1;
        });
        return;
      }

      // Save status change with Return when editing
      if (key.return && isEditingChildStatus && childSelectedTransitionIndex >= 0) {
        const transition = childAvailableTransitions[childSelectedTransitionIndex];
        if (selectedChildTicket && transition) {
          handleSaveStatus(selectedChildTicket, transition);
        }
        return;
      }

      if (key.upArrow) {
        setChildDetailIndex((prev) => (prev === 0 ? 2 : prev - 1));
      }
      if (key.downArrow) {
        setChildDetailIndex((prev) => (prev === 2 ? 0 : prev + 1));
      }
      if (key.return && !isEditingChildStatus) {
        if (childDetailIndex === 0) {
          handleStartWorkOnChild();
        } else if (childDetailIndex === 1) {
          handleViewInBrowser(selectedChildTicket);
        } else {
          setStep('children');
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
        <BorderedBox title="My Tickets">
          <Spinner label="Loading tickets..." />
        </BorderedBox>
      );

    case 'list':
      return (
        <BorderedBox title="My Tickets">
          <Box flexDirection="column">
            {/* Filter tabs */}
            <Box marginBottom={1}>
              <Text dimColor>Filter: </Text>
              {(['active', 'todo', 'in-progress', 'done', 'all'] as Filter[]).map((f) => {
                const labels: Record<Filter, string> = {
                  active: 'Active',
                  todo: 'To Do',
                  'in-progress': 'In Progress',
                  done: 'Done',
                  all: 'All',
                };
                return (
                  <React.Fragment key={f}>
                    <Text
                      color={filter === f ? 'cyan' : undefined}
                      bold={filter === f}
                    >
                      [{labels[f]}]
                    </Text>
                    <Text> </Text>
                  </React.Fragment>
                );
              })}
            </Box>

            <Box marginBottom={1}>
              <Text dimColor>
                {filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}
              </Text>
            </Box>

            <SelectList
              items={filteredTickets.map((ticket) => ({
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
              { key: 'Enter', action: 'View' },
              { key: 'Tab', action: 'Filter' },
              { key: 'Esc', action: 'Back' },
            ]}
          />
        </BorderedBox>
      );

    case 'detail': {
      const menuOptions = isSelectedTicketEpic
        ? ['Start working (create branch)', 'View child issues', 'View in browser', 'Back to list']
        : ['Start working (create branch)', 'View in browser', 'Back to list'];

      return (
        <BorderedBox title={selectedTicket?.key || ''}>
          <Box flexDirection="column">
            <Text bold>"{selectedTicket?.summary}"</Text>
            <Box>
              <Text dimColor>Type: {selectedTicket?.issueType}</Text>
              {selectedTicket?.sprint && <Text dimColor> | Sprint: {selectedTicket.sprint}</Text>}
            </Box>

            {/* Status display with transition options */}
            <Box marginTop={1}>
              <Text dimColor>Status: </Text>
              {isSavingStatus ? (
                <Text color="yellow">Saving...</Text>
              ) : (
                <>
                  <Text>{selectedTicket?.status}</Text>
                  {isEditingStatus && selectedTransitionIndex >= 0 && (
                    <Text color="yellow"> → </Text>
                  )}
                </>
              )}
            </Box>
            {availableTransitions.length > 0 && !isSavingStatus && (
              <Box marginTop={1}>
                <Text dimColor>Move to: </Text>
                {availableTransitions.map((transition, index) => (
                  <React.Fragment key={transition.id}>
                    {index > 0 && <Text> </Text>}
                    <Text
                      color={isEditingStatus && index === selectedTransitionIndex ? 'green' : undefined}
                      bold={isEditingStatus && index === selectedTransitionIndex}
                      dimColor={!isEditingStatus}
                    >
                      [{transition.toStatus}]
                    </Text>
                  </React.Fragment>
                ))}
                {isEditingStatus ? (
                  <Text dimColor>  ←→ select, Enter save, Esc cancel</Text>
                ) : (
                  <Text dimColor>  ←→ to change</Text>
                )}
              </Box>
            )}

            {selectedTicket?.description && (
              <Box marginTop={1}>
                <Text dimColor>Description:</Text>
              </Box>
            )}
            {selectedTicket?.description && (
              <Text>{selectedTicket.description.substring(0, 200)}...</Text>
            )}

            <Box marginTop={1} borderStyle="single" borderColor="gray" />

            <Box flexDirection="column" marginTop={1}>
              {menuOptions.map((label, index) => (
                <Box key={label}>
                  <Text color={index === detailIndex ? 'cyan' : undefined}>
                    {index === detailIndex ? '→ ' : '  '}
                    {label}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
          <KeyHints
            hints={
              isEditingStatus
                ? [
                    { key: '←→', action: 'Change status' },
                    { key: 'Enter', action: 'Save' },
                    { key: 'Esc', action: 'Cancel' },
                  ]
                : [
                    { key: '↑↓', action: 'Navigate' },
                    { key: '←→', action: 'Change status' },
                    { key: 'Enter', action: 'Select' },
                    { key: 'Esc', action: 'Back' },
                  ]
            }
          />
        </BorderedBox>
      );
    }

    case 'creating-branch':
      return (
        <BorderedBox title="My Tickets">
          <Spinner label="Creating branch..." />
        </BorderedBox>
      );

    case 'loading-children':
      return (
        <BorderedBox title={`${selectedTicket?.key} - Child Issues`}>
          <Spinner label="Loading child issues..." />
        </BorderedBox>
      );

    case 'children':
      return (
        <BorderedBox title={`${selectedTicket?.key} - Child Issues`}>
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Parent: </Text>
              <Text color="yellow">{selectedTicket?.key}</Text>
              <Text dimColor> - {selectedTicket?.summary}</Text>
            </Box>

            <Box marginBottom={1}>
              <Text dimColor>
                {childIssues.length} child issue{childIssues.length !== 1 ? 's' : ''}
              </Text>
            </Box>

            {childIssues.length === 0 ? (
              <Box>
                <Text dimColor>No child issues found for this epic.</Text>
              </Box>
            ) : (
              <SelectList
                items={childIssues.map((ticket) => ({
                  label: `${ticket.key}  ${ticket.summary}`,
                  value: ticket,
                }))}
                onSelect={handleChildSelect}
                onBack={() => setStep('detail')}
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
                      {'  '}{item.value.summary.substring(0, 35)}
                      {item.value.summary.length > 35 ? '...' : ''}
                    </Text>
                    <Text dimColor> [{item.value.status}]</Text>
                  </Box>
                )}
              />
            )}
          </Box>
          <KeyHints
            hints={[
              { key: '↑↓', action: 'Navigate' },
              { key: 'Enter', action: 'View' },
              { key: 'Esc', action: 'Back' },
            ]}
          />
        </BorderedBox>
      );

    case 'child-detail':
      return (
        <BorderedBox title={selectedChildTicket?.key || ''}>
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Parent: </Text>
              <Text color="yellow">{selectedTicket?.key}</Text>
            </Box>

            <Text bold>"{selectedChildTicket?.summary}"</Text>
            <Box>
              <Text dimColor>Type: {selectedChildTicket?.issueType}</Text>
              {selectedChildTicket?.sprint && <Text dimColor> | Sprint: {selectedChildTicket.sprint}</Text>}
            </Box>

            {/* Status display with transition options */}
            <Box marginTop={1}>
              <Text dimColor>Status: </Text>
              {isSavingStatus ? (
                <Text color="yellow">Saving...</Text>
              ) : (
                <>
                  <Text>{selectedChildTicket?.status}</Text>
                  {isEditingChildStatus && childSelectedTransitionIndex >= 0 && (
                    <Text color="yellow"> → </Text>
                  )}
                </>
              )}
            </Box>
            {childAvailableTransitions.length > 0 && !isSavingStatus && (
              <Box marginTop={1}>
                <Text dimColor>Move to: </Text>
                {childAvailableTransitions.map((transition, index) => (
                  <React.Fragment key={transition.id}>
                    {index > 0 && <Text> </Text>}
                    <Text
                      color={isEditingChildStatus && index === childSelectedTransitionIndex ? 'green' : undefined}
                      bold={isEditingChildStatus && index === childSelectedTransitionIndex}
                      dimColor={!isEditingChildStatus}
                    >
                      [{transition.toStatus}]
                    </Text>
                  </React.Fragment>
                ))}
                {isEditingChildStatus ? (
                  <Text dimColor>  ←→ select, Enter save, Esc cancel</Text>
                ) : (
                  <Text dimColor>  ←→ to change</Text>
                )}
              </Box>
            )}

            {selectedChildTicket?.description && (
              <Box marginTop={1}>
                <Text dimColor>Description:</Text>
              </Box>
            )}
            {selectedChildTicket?.description && (
              <Text>{selectedChildTicket.description.substring(0, 200)}...</Text>
            )}

            <Box marginTop={1} borderStyle="single" borderColor="gray" />

            <Box flexDirection="column" marginTop={1}>
              {['Start working (create branch)', 'View in browser', 'Back to children'].map(
                (label, index) => (
                  <Box key={label}>
                    <Text color={index === childDetailIndex ? 'cyan' : undefined}>
                      {index === childDetailIndex ? '→ ' : '  '}
                      {label}
                    </Text>
                  </Box>
                )
              )}
            </Box>
          </Box>
          <KeyHints
            hints={
              isEditingChildStatus
                ? [
                    { key: '←→', action: 'Change status' },
                    { key: 'Enter', action: 'Save' },
                    { key: 'Esc', action: 'Cancel' },
                  ]
                : [
                    { key: '↑↓', action: 'Navigate' },
                    { key: '←→', action: 'Change status' },
                    { key: 'Enter', action: 'Select' },
                    { key: 'Esc', action: 'Back' },
                  ]
            }
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
