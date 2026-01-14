# jh - Jira x GitHub CLI

A terminal UI (TUI) tool that integrates Jira and GitHub workflows, making it easy to manage tickets and pull requests from the command line.

## Features

- Link Git branches to Jira tickets
- Create PRs with auto-populated Jira ticket info
- Browse and manage your Jira tickets
- Create new Jira tickets
- Switch between branches with ticket context

## Prerequisites

- **Node.js** >= 18.0.0
- **Bun** (recommended) or npm
- **GitHub CLI** (`gh`) - authenticated with your GitHub account
- **Jira API Token** - generated from your Atlassian account

### Install Prerequisites

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install GitHub CLI
brew install gh

# Authenticate GitHub CLI
gh auth login
```

### Generate Jira API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a name (e.g., "jh-cli")
4. Copy the token - you'll need it during setup

## Installation

### 1. Clone and build

```bash
cd /path/to/internal-tools/jh-cli
bun install
bun run build
```

### 2. Link globally

This makes the `jh` command available anywhere on your machine:

```bash
bun link
```

Or with npm:

```bash
npm link
```

### 3. First-time setup

Run `jh` from any directory to start the setup wizard:

```bash
jh
```

The wizard will prompt you for:
- Jira workspace name (e.g., "mycompany")
- Jira domain (e.g., "mycompany.atlassian.net")
- Your Jira email
- Your Jira API token

## Usage

Simply run `jh` from any Git repository:

```bash
jh
```

### Main Menu Options

- **View linked ticket** - View details of the Jira ticket linked to your current branch
- **Link branch to ticket** - Associate your current Git branch with a Jira ticket
- **Create a new ticket** - Create a new Jira ticket
- **My tickets** - Browse tickets assigned to you
- **Switch branch** - Switch to a different Git branch
- **Create PR for current branch** - Create a GitHub PR with Jira ticket info pre-filled
- **Create ticket from current branch** - Create a Jira ticket based on your branch name

### Keyboard Navigation

- `↑/↓` - Navigate menu items
- `Enter` - Select option
- `Esc` - Go back / Cancel
- `q` - Quit

## Development

```bash
# Run in development mode (with hot reload)
bun run dev

# Build
bun run build

# Run tests
bun test

# Lint
bun run lint
```

## Troubleshooting

### "jh: command not found"

Make sure you ran `bun link` or `npm link` after building. You may need to restart your terminal or run:

```bash
source ~/.bashrc  # or ~/.zshrc
```

### GitHub CLI not authenticated

Run `gh auth login` and follow the prompts.

### Jira authentication errors

Regenerate your API token at https://id.atlassian.com/manage-profile/security/api-tokens and update it in jh settings.
