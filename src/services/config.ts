import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { z } from 'zod';

// Schema definitions
const JiraWorkspaceSchema = z.object({
  domain: z.string().min(1),
  email: z.string().email(),
  defaultProject: z.string().regex(/^[A-Z][A-Z0-9]*$/),
});

const DefaultsSchema = z.object({
  branchFormat: z.string().default('{ticketId}/{slug}'),
  slugMaxLength: z.number().default(50),
  defaultIssueType: z.string().default('Task'),
  baseBranch: z.string().default('main'),
});

const ConfigSchema = z.object({
  version: z.number().default(1),
  defaults: DefaultsSchema.default({}),
  jira: z.object({
    workspaces: z.record(JiraWorkspaceSchema),
  }),
  mappings: z.record(z.string()),
});

const CredentialsSchema = z.object({
  jira: z.record(
    z.object({
      token: z.string(),
    })
  ),
});

export type JhCliConfig = z.infer<typeof ConfigSchema>;
export type JiraWorkspace = z.infer<typeof JiraWorkspaceSchema>;
export type Credentials = z.infer<typeof CredentialsSchema>;

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private credentialsPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), '.jh-cli');
    this.configPath = path.join(this.configDir, 'config.yaml');
    this.credentialsPath = path.join(this.configDir, 'credentials.yaml');
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<JhCliConfig> {
    const content = await fs.readFile(this.configPath, 'utf-8');
    const parsed = yaml.load(content);
    return ConfigSchema.parse(parsed);
  }

  async save(config: JhCliConfig): Promise<void> {
    await this.ensureConfigDir();
    const content = yaml.dump(config, { indent: 2 });
    await fs.writeFile(this.configPath, content, 'utf-8');
  }

  async loadCredentials(): Promise<Credentials> {
    try {
      const content = await fs.readFile(this.credentialsPath, 'utf-8');
      const parsed = yaml.load(content);
      return CredentialsSchema.parse(parsed);
    } catch {
      return { jira: {} };
    }
  }

  async saveCredentials(credentials: Credentials): Promise<void> {
    await this.ensureConfigDir();
    const content = yaml.dump(credentials, { indent: 2 });
    await fs.writeFile(this.credentialsPath, content, { mode: 0o600 });
  }

  async setJiraToken(workspace: string, token: string): Promise<void> {
    const credentials = await this.loadCredentials();
    credentials.jira[workspace] = { token };
    await this.saveCredentials(credentials);
  }

  async getJiraToken(workspace: string): Promise<string | null> {
    const credentials = await this.loadCredentials();
    return credentials.jira[workspace]?.token ?? null;
  }

  async resolveWorkspace(repoIdentifier: string): Promise<string | null> {
    const config = await this.load();

    // Try exact match first
    if (config.mappings[repoIdentifier]) {
      return config.mappings[repoIdentifier];
    }

    // Try wildcard match (e.g., "org/*")
    const [owner] = repoIdentifier.split('/');
    const wildcardKey = `${owner}/*`;
    if (config.mappings[wildcardKey]) {
      return config.mappings[wildcardKey];
    }

    return null;
  }

  async getWorkspaceConfig(name: string): Promise<JiraWorkspace | null> {
    const config = await this.load();
    return config.jira.workspaces[name] ?? null;
  }

  async initialize(config: JhCliConfig): Promise<void> {
    await this.ensureConfigDir();
    await this.save(config);
  }

  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch {
      // Directory already exists
    }
  }

  // Helper to create a new config with workspace
  static createConfig(
    workspaceName: string,
    workspace: JiraWorkspace,
    repoMapping?: string
  ): JhCliConfig {
    const config: JhCliConfig = {
      version: 1,
      defaults: {
        branchFormat: '{ticketId}/{slug}',
        slugMaxLength: 50,
        defaultIssueType: 'Task',
        baseBranch: 'main',
      },
      jira: {
        workspaces: {
          [workspaceName]: workspace,
        },
      },
      mappings: {},
    };

    if (repoMapping) {
      config.mappings[repoMapping] = workspaceName;
    }

    return config;
  }
}
