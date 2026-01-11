import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { BorderedBox, TextInput, SelectList, Spinner, SuccessMessage, ErrorMessage } from '../components/index.js';
import { ConfigManager, type JhCliConfig } from '../services/config.js';
import { JiraClient, type JiraProject } from '../clients/jira.js';
import { GitManager } from '../services/git.js';

interface SetupProps {
  onComplete: () => void;
}

type SetupStep = 'welcome' | 'domain' | 'email' | 'token' | 'testing' | 'projects' | 'saving' | 'done' | 'error';

export function Setup({ onComplete }: SetupProps) {
  const [step, setStep] = useState<SetupStep>('welcome');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [repoIdentifier, setRepoIdentifier] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  // Handle welcome screen
  useInput((input, key) => {
    if (step === 'welcome' && key.return) {
      setStep('domain');
    }
    if (step === 'done' && key.return) {
      onComplete();
    }
    if (step === 'error' && key.escape) {
      setStep('domain');
      setError('');
    }
  });

  const handleDomainSubmit = () => {
    if (domain.trim()) {
      setStep('email');
    }
  };

  const handleEmailSubmit = () => {
    if (email.trim()) {
      setStep('token');
    }
  };

  const handleTokenSubmit = async () => {
    if (!token.trim()) return;

    setStep('testing');

    try {
      // Test the connection
      const client = new JiraClient(domain, email, token);
      const connected = await client.testConnection();

      if (!connected) {
        setError('Could not connect to Jira. Please check your credentials.');
        setStep('error');
        return;
      }

      // Get projects
      const projectList = await client.getProjects();
      setProjects(projectList);

      // Get repo identifier for mapping
      const git = new GitManager();
      const repoId = await git.getRepoIdentifier();
      setRepoIdentifier(repoId);

      setStep('projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStep('error');
    }
  };

  const handleProjectSelect = async (project: JiraProject) => {
    setSelectedProject(project.key);
    setStep('saving');

    try {
      const configManager = new ConfigManager();
      const workspaceName = domain.split('.')[0]; // e.g., "acme" from "acme.atlassian.net"

      const config: JhCliConfig = ConfigManager.createConfig(
        workspaceName,
        {
          domain,
          email,
          defaultProject: project.key,
        },
        repoIdentifier || undefined
      );

      await configManager.initialize(config);
      await configManager.setJiraToken(workspaceName, token);

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
      setStep('error');
    }
  };

  // Render based on current step
  switch (step) {
    case 'welcome':
      return (
        <BorderedBox title="Welcome to jh-cli!">
          <Text>Let's get you set up with Jira integration.</Text>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue...</Text>
          </Box>
        </BorderedBox>
      );

    case 'domain':
      return (
        <BorderedBox title="Setup - Jira Domain">
          <TextInput
            label="Enter your Jira domain (e.g., acme.atlassian.net):"
            value={domain}
            onChange={setDomain}
            onSubmit={handleDomainSubmit}
            placeholder="company.atlassian.net"
          />
        </BorderedBox>
      );

    case 'email':
      return (
        <BorderedBox title="Setup - Jira Email">
          <TextInput
            label="Enter your Jira email:"
            value={email}
            onChange={setEmail}
            onSubmit={handleEmailSubmit}
            onBack={() => setStep('domain')}
            placeholder="you@company.com"
          />
        </BorderedBox>
      );

    case 'token':
      return (
        <BorderedBox title="Setup - Jira API Token">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>
                Get a token at: https://id.atlassian.com/manage/api-tokens
              </Text>
            </Box>
            <TextInput
              label="Enter your Jira API token:"
              value={token}
              onChange={setToken}
              onSubmit={handleTokenSubmit}
              onBack={() => setStep('email')}
              mask={true}
              placeholder="Your API token"
            />
          </Box>
        </BorderedBox>
      );

    case 'testing':
      return (
        <BorderedBox title="Setup">
          <Spinner label="Connecting to Jira..." />
        </BorderedBox>
      );

    case 'projects':
      return (
        <BorderedBox title="Setup - Select Default Project">
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>
                {repoIdentifier
                  ? `Select the default project for ${repoIdentifier}:`
                  : 'Select your default project:'}
              </Text>
            </Box>
            <SelectList
              items={projects.map((p) => ({
                label: `${p.key} - ${p.name}`,
                value: p,
              }))}
              onSelect={(item) => handleProjectSelect(item.value)}
              onBack={() => setStep('token')}
            />
          </Box>
        </BorderedBox>
      );

    case 'saving':
      return (
        <BorderedBox title="Setup">
          <Spinner label="Saving configuration..." />
        </BorderedBox>
      );

    case 'done':
      return (
        <BorderedBox title="Setup Complete!">
          <SuccessMessage
            messages={[
              'Connected to Jira successfully!',
              `Default project: ${selectedProject}`,
              `Configuration saved to ~/.jh-cli/config.yaml`,
            ]}
          />
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue...</Text>
          </Box>
        </BorderedBox>
      );

    case 'error':
      return (
        <BorderedBox title="Setup - Error">
          <ErrorMessage error={error} onBack={() => setStep('domain')} />
        </BorderedBox>
      );

    default:
      return null;
  }
}
