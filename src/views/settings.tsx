import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, SelectList, KeyHints, Spinner, type SelectItem } from '../components/index.js';
import type { AppContext } from '../services/context.js';
import type { ViewName } from '../app.js';
import { ConfigManager, type JhCliConfig } from '../services/config.js';

interface SettingsProps {
  context: AppContext;
  navigate: (view: ViewName) => void;
  refreshContext: () => Promise<void>;
  onSetupComplete: () => void;
}

type ViewStep = 'menu' | 'view-config' | 'loading';

interface MenuItem {
  label: string;
  action: string;
}

export function Settings({ context, navigate, refreshContext, onSetupComplete }: SettingsProps) {
  const [step, setStep] = useState<ViewStep>('menu');
  const [config, setConfig] = useState<JhCliConfig | null>(null);

  const menuItems: MenuItem[] = [
    { label: 'Jira workspaces', action: 'workspaces' },
    { label: 'Repository mappings', action: 'mappings' },
    { label: 'Branch format', action: 'branch-format' },
    { label: 'View configuration', action: 'view-config' },
    { label: 'Re-run setup', action: 'setup' },
  ];

  const handleMenuSelect = async (item: SelectItem<MenuItem>) => {
    switch (item.value.action) {
      case 'view-config':
        setStep('loading');
        try {
          const configManager = new ConfigManager();
          const loadedConfig = await configManager.load();
          setConfig(loadedConfig);
          setStep('view-config');
        } catch {
          setConfig(null);
          setStep('view-config');
        }
        break;
      case 'setup':
        navigate('setup' as ViewName);
        break;
      default:
        // Other settings not implemented yet
        break;
    }
  };

  useInput((input, key) => {
    if (step === 'view-config') {
      if (key.escape || key.return) {
        setStep('menu');
      }
    }
  });

  switch (step) {
    case 'menu':
      return (
        <BorderedBox title="Settings">
          <SelectList
            items={menuItems.map((item) => ({
              label: item.label,
              value: item,
            }))}
            onSelect={handleMenuSelect}
            onBack={() => navigate('main')}
          />
          <KeyHints
            hints={[
              { key: '↑↓', action: 'Navigate' },
              { key: 'Enter', action: 'Select' },
              { key: 'Esc', action: 'Back' },
            ]}
          />
        </BorderedBox>
      );

    case 'loading':
      return (
        <BorderedBox title="Settings">
          <Spinner label="Loading configuration..." />
        </BorderedBox>
      );

    case 'view-config':
      return (
        <BorderedBox title="Configuration">
          {config ? (
            <Box flexDirection="column">
              <Text bold color="cyan">Defaults:</Text>
              <Box marginLeft={2} flexDirection="column">
                <Text>Branch format: {config.defaults.branchFormat}</Text>
                <Text>Slug max length: {config.defaults.slugMaxLength}</Text>
                <Text>Default issue type: {config.defaults.defaultIssueType}</Text>
                <Text>Base branch: {config.defaults.baseBranch}</Text>
              </Box>

              <Box marginTop={1}>
                <Text bold color="cyan">Jira Workspaces:</Text>
              </Box>
              {Object.entries(config.jira.workspaces).map(([name, ws]) => (
                <Box key={name} marginLeft={2} flexDirection="column">
                  <Text color="yellow">{name}:</Text>
                  <Box marginLeft={2} flexDirection="column">
                    <Text>Domain: {ws.domain}</Text>
                    <Text>Email: {ws.email}</Text>
                    <Text>Default project: {ws.defaultProject}</Text>
                  </Box>
                </Box>
              ))}

              <Box marginTop={1}>
                <Text bold color="cyan">Mappings:</Text>
              </Box>
              {Object.entries(config.mappings).length > 0 ? (
                Object.entries(config.mappings).map(([repo, workspace]) => (
                  <Box key={repo} marginLeft={2}>
                    <Text>{repo}</Text>
                    <Text dimColor> → </Text>
                    <Text color="yellow">{workspace}</Text>
                  </Box>
                ))
              ) : (
                <Box marginLeft={2}>
                  <Text dimColor>No mappings configured</Text>
                </Box>
              )}
            </Box>
          ) : (
            <Text dimColor>No configuration found</Text>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Esc to go back...</Text>
          </Box>
        </BorderedBox>
      );

    default:
      return null;
  }
}
