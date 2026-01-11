import { GitManager } from './git.js';
import { ConfigManager, type JiraWorkspace } from './config.js';

export interface AppContext {
  // Git context
  isGitRepo: boolean;
  currentBranch: string | null;
  repoIdentifier: string | null; // e.g., "owner/repo"

  // Jira context
  workspaceName: string | null;
  workspace: JiraWorkspace | null;

  // Linked ticket (from branch name)
  linkedTicketId: string | null;

  // Commits ahead of base
  commitsAhead: number;
}

export class ContextService {
  private configManager: ConfigManager;
  private gitManager: GitManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.gitManager = new GitManager();
  }

  async getContext(): Promise<AppContext> {
    const context: AppContext = {
      isGitRepo: false,
      currentBranch: null,
      repoIdentifier: null,
      workspaceName: null,
      workspace: null,
      linkedTicketId: null,
      commitsAhead: 0,
    };

    // Check if we're in a git repo
    context.isGitRepo = await this.gitManager.isGitRepo();
    if (!context.isGitRepo) {
      return context;
    }

    // Get current branch
    context.currentBranch = await this.gitManager.getCurrentBranch();

    // Parse repo identifier from remote
    context.repoIdentifier = await this.gitManager.getRepoIdentifier();

    // Try to resolve workspace from config
    if (context.repoIdentifier) {
      context.workspaceName = await this.configManager.resolveWorkspace(
        context.repoIdentifier
      );

      if (context.workspaceName) {
        context.workspace = await this.configManager.getWorkspaceConfig(
          context.workspaceName
        );
      }
    }

    // Extract ticket ID from branch name if present
    if (context.currentBranch) {
      context.linkedTicketId = this.extractTicketId(context.currentBranch);
    }

    // Get commits ahead of base branch
    try {
      const config = await this.configManager.load();
      const baseBranch = config.defaults.baseBranch;
      context.commitsAhead = await this.gitManager.getCommitsAhead(baseBranch);
    } catch {
      // Config might not exist yet
    }

    return context;
  }

  private extractTicketId(branchName: string): string | null {
    // Match patterns like "PROJ-123/description" or "PROJ-123-description"
    const match = branchName.match(/^([A-Z][A-Z0-9]*-\d+)/);
    return match ? match[1] : null;
  }
}
