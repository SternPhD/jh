import { simpleGit, SimpleGit } from 'simple-git';

export interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  lastCommitDate: Date | null;
}

export class GitManager {
  private git: SimpleGit;

  constructor(workingDir?: string) {
    this.git = simpleGit(workingDir);
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(): Promise<string | null> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch {
      return null;
    }
  }

  async getRepoIdentifier(): Promise<string | null> {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      if (!origin?.refs?.fetch) return null;

      return this.parseRemoteUrl(origin.refs.fetch);
    } catch {
      return null;
    }
  }

  private parseRemoteUrl(url: string): string | null {
    // Handle SSH URLs: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^.]+)/);
    if (sshMatch) {
      return `${sshMatch[1]}/${sshMatch[2]}`;
    }

    // Handle HTTPS URLs: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/([^.]+)/);
    if (httpsMatch) {
      return `${httpsMatch[1]}/${httpsMatch[2]}`;
    }

    return null;
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch {
      return false;
    }
  }

  async createBranch(name: string, base?: string): Promise<void> {
    if (base) {
      await this.git.checkoutBranch(name, base);
    } else {
      await this.git.checkoutLocalBranch(name);
    }
  }

  async checkoutBranch(name: string): Promise<void> {
    await this.git.checkout(name);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.git.branch(['-m', oldName, newName]);
  }

  async listBranches(): Promise<BranchInfo[]> {
    const branches = await this.git.branchLocal();

    // Get last commit date for each branch
    const branchInfos: BranchInfo[] = await Promise.all(
      branches.all.map(async (name) => {
        let lastCommitDate: Date | null = null;
        try {
          const result = await this.git.raw([
            'log',
            '-1',
            '--format=%ci',
            name,
          ]);
          if (result.trim()) {
            lastCommitDate = new Date(result.trim());
          }
        } catch {
          // Ignore errors for individual branches
        }
        return {
          name,
          current: name === branches.current,
          lastCommitDate,
        };
      })
    );

    return branchInfos;
  }

  async getCommitsAhead(baseBranch: string): Promise<number> {
    try {
      const log = await this.git.log([`${baseBranch}..HEAD`]);
      return log.total;
    } catch {
      return 0;
    }
  }

  async getCommitsSince(ref: string): Promise<Commit[]> {
    try {
      const log = await this.git.log([`${ref}..HEAD`]);
      return log.all.map((commit) => ({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      }));
    } catch {
      return [];
    }
  }

  async findMergeBase(branch1: string, branch2: string): Promise<string | null> {
    try {
      const result = await this.git.raw(['merge-base', branch1, branch2]);
      return result.trim();
    } catch {
      return null;
    }
  }
}
