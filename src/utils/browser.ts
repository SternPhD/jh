import { exec } from 'child_process';

/**
 * Open a URL in the default browser
 */
export function openInBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // macOS uses 'open', Linux uses 'xdg-open', Windows uses 'start'
    const command = process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
      ? `start "${url}"`
      : `xdg-open "${url}"`;

    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Build a Jira issue URL
 */
export function getJiraIssueUrl(domain: string, issueKey: string): string {
  return `https://${domain}/browse/${issueKey}`;
}
