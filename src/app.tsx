import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ConfigManager } from './services/config.js';
import { ContextService, type AppContext } from './services/context.js';
import { MainMenu } from './views/main-menu.js';
import { Setup } from './views/setup.js';
import { StartWork } from './views/start-work.js';
import { NewTicket } from './views/new-ticket.js';
import { MyTickets } from './views/my-tickets.js';
import { SwitchBranch } from './views/switch-branch.js';
import { LinkBranch } from './views/link-branch.js';
import { Settings } from './views/settings.js';
import { CreateTicketFromBranch } from './views/create-ticket-from-branch.js';
import { CreatePR } from './views/create-pr.js';
import { UpdateTicketStatus } from './views/update-ticket-status.js';

export type ViewName =
  | 'loading'
  | 'setup'
  | 'main'
  | 'start-work'
  | 'new-ticket'
  | 'my-tickets'
  | 'switch-branch'
  | 'link-branch'
  | 'settings'
  | 'create-ticket-from-branch'
  | 'create-pr'
  | 'update-ticket-status';

interface AppState {
  currentView: ViewName;
  context: AppContext | null;
  isConfigured: boolean;
}

export function App() {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    currentView: 'loading',
    context: null,
    isConfigured: false,
  });

  // Initialize on mount
  useEffect(() => {
    async function initialize() {
      const configManager = new ConfigManager();
      const isConfigured = await configManager.exists();

      if (!isConfigured) {
        setState((prev) => ({ ...prev, currentView: 'setup', isConfigured: false }));
        return;
      }

      // Load context
      const contextService = new ContextService(configManager);
      const context = await contextService.getContext();

      setState({
        currentView: 'main',
        context,
        isConfigured: true,
      });
    }

    initialize();
  }, []);

  // Handle global quit
  useInput((input, key) => {
    if (input === 'q' && state.currentView === 'main') {
      exit();
    }
  });

  const navigate = (view: ViewName) => {
    setState((prev) => ({ ...prev, currentView: view }));
  };

  const refreshContext = async () => {
    const configManager = new ConfigManager();
    const contextService = new ContextService(configManager);
    const context = await contextService.getContext();
    setState((prev) => ({ ...prev, context }));
  };

  const onSetupComplete = async () => {
    const configManager = new ConfigManager();
    const contextService = new ContextService(configManager);
    const context = await contextService.getContext();
    setState({
      currentView: 'main',
      context,
      isConfigured: true,
    });
  };

  // Render loading state
  if (state.currentView === 'loading') {
    return (
      <Box>
        <Text>Loading...</Text>
      </Box>
    );
  }

  // Render setup wizard
  if (state.currentView === 'setup') {
    return <Setup onComplete={onSetupComplete} />;
  }

  // Render main views
  const viewProps = {
    context: state.context!,
    navigate,
    refreshContext,
  };

  switch (state.currentView) {
    case 'main':
      return <MainMenu {...viewProps} />;
    case 'start-work':
      return <StartWork {...viewProps} />;
    case 'new-ticket':
      return <NewTicket {...viewProps} />;
    case 'my-tickets':
      return <MyTickets {...viewProps} />;
    case 'switch-branch':
      return <SwitchBranch {...viewProps} />;
    case 'link-branch':
      return <LinkBranch {...viewProps} />;
    case 'settings':
      return <Settings {...viewProps} onSetupComplete={onSetupComplete} />;
    case 'create-ticket-from-branch':
      return <CreateTicketFromBranch {...viewProps} />;
    case 'create-pr':
      return <CreatePR {...viewProps} />;
    case 'update-ticket-status':
      return <UpdateTicketStatus {...viewProps} />;
    default:
      return <MainMenu {...viewProps} />;
  }
}
