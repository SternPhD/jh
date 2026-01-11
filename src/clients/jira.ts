import axios, { AxiosInstance, AxiosError } from 'axios';

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  description?: string;
  assignee?: string;
  sprint?: string;
}

export interface JiraProject {
  key: string;
  name: string;
}

export interface IssueType {
  id: string;
  name: string;
  description?: string;
}

export interface CreateIssueParams {
  projectKey: string;
  summary: string;
  issueType: string;
  description?: string;
  assigneeId?: string;
  reporterId?: string;
  sprintId?: number;
  startDate?: string;
  dueDate?: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
}

export interface SearchParams {
  assignee?: 'currentUser' | string;
  status?: string[];
  project?: string;
  maxResults?: number;
}

export interface JiraTransition {
  id: string;
  name: string;
  toStatus: string;
}

export class JiraClient {
  private client: AxiosInstance;
  private email: string;

  constructor(domain: string, email: string, token: string) {
    this.email = email;
    this.client = axios.create({
      baseURL: `https://${domain}/rest/api/3`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/myself');
      return true;
    } catch {
      return false;
    }
  }

  async getIssue(ticketId: string): Promise<JiraIssue | null> {
    try {
      const response = await this.client.get(`/issue/${ticketId}`, {
        params: {
          fields: 'summary,status,issuetype,description,assignee,customfield_10020',
        },
      });

      const { fields } = response.data;
      return {
        key: response.data.key,
        summary: fields.summary,
        status: fields.status?.name || 'Unknown',
        issueType: fields.issuetype?.name || 'Unknown',
        description: this.extractTextFromAdf(fields.description),
        assignee: fields.assignee?.displayName,
        sprint: fields.customfield_10020?.[0]?.name,
      };
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async searchIssues(params: SearchParams): Promise<JiraIssue[]> {
    const jqlParts: string[] = [];

    if (params.project) {
      jqlParts.push(`project = "${params.project}"`);
    }

    if (params.assignee === 'currentUser') {
      jqlParts.push('assignee = currentUser()');
    } else if (params.assignee) {
      jqlParts.push(`assignee = "${params.assignee}"`);
    }

    if (params.status && params.status.length > 0) {
      const statusList = params.status.map((s) => `"${s}"`).join(', ');
      jqlParts.push(`status IN (${statusList})`);
    }

    const jql = jqlParts.length > 0 ? jqlParts.join(' AND ') : '';

    try {
      // Use the new /search/jql endpoint (POST) instead of deprecated /search (GET)
      const response = await this.client.post('/search/jql', {
        jql: jql + ' ORDER BY updated DESC',
        maxResults: params.maxResults || 50,
        fields: ['summary', 'status', 'issuetype', 'assignee', 'customfield_10020'],
      });

      return response.data.issues.map((issue: any) => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name || 'Unknown',
        issueType: issue.fields.issuetype?.name || 'Unknown',
        assignee: issue.fields.assignee?.displayName,
        sprint: issue.fields.customfield_10020?.[0]?.name,
      }));
    } catch (error) {
      throw this.handleApiError(error as AxiosError);
    }
  }

  async getMyIssues(project?: string): Promise<JiraIssue[]> {
    return this.searchIssues({
      assignee: 'currentUser',
      project,
      status: ['To Do', 'In Progress', 'Open', 'Reopened'],
    });
  }

  async getChildIssues(parentKey: string): Promise<JiraIssue[]> {
    try {
      // Search for issues that have this issue as their parent (epic link or parent)
      const response = await this.client.post('/search/jql', {
        jql: `"Parent" = ${parentKey} OR "Epic Link" = ${parentKey} ORDER BY status ASC, updated DESC`,
        maxResults: 100,
        fields: ['summary', 'status', 'issuetype', 'assignee', 'customfield_10020'],
      });

      return response.data.issues.map((issue: any) => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name || 'Unknown',
        issueType: issue.fields.issuetype?.name || 'Unknown',
        assignee: issue.fields.assignee?.displayName,
        sprint: issue.fields.customfield_10020?.[0]?.name,
      }));
    } catch (error) {
      // If the query fails (e.g., no Epic Link field), return empty array
      return [];
    }
  }

  isEpic(issue: JiraIssue): boolean {
    return issue.issueType.toLowerCase() === 'epic';
  }

  async getCurrentUser(): Promise<JiraUser> {
    try {
      const response = await this.client.get('/myself');
      return {
        accountId: response.data.accountId,
        displayName: response.data.displayName,
        emailAddress: response.data.emailAddress,
      };
    } catch (error) {
      throw this.handleApiError(error as AxiosError);
    }
  }

  async getActiveSprints(projectKey: string): Promise<JiraSprint[]> {
    try {
      // First get boards for the project
      const boardsResponse = await this.client.get('/rest/agile/1.0/board', {
        baseURL: this.client.defaults.baseURL?.replace('/rest/api/3', ''),
        params: { projectKeyOrId: projectKey },
      });

      const boards = boardsResponse.data.values || [];
      if (boards.length === 0) return [];

      // Get sprints from the first board
      const boardId = boards[0].id;
      const sprintsResponse = await this.client.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
        baseURL: this.client.defaults.baseURL?.replace('/rest/api/3', ''),
        params: { state: 'active,future' },
      });

      return (sprintsResponse.data.values || []).map((sprint: any) => ({
        id: sprint.id,
        name: sprint.name,
        state: sprint.state,
      }));
    } catch {
      // Agile API might not be available
      return [];
    }
  }

  async createIssue(params: CreateIssueParams): Promise<JiraIssue> {
    const body: any = {
      fields: {
        project: { key: params.projectKey },
        summary: params.summary,
        issuetype: { name: params.issueType },
      },
    };

    if (params.description) {
      body.fields.description = this.textToAdf(params.description);
    }

    if (params.assigneeId) {
      body.fields.assignee = { accountId: params.assigneeId };
    }

    if (params.reporterId) {
      body.fields.reporter = { accountId: params.reporterId };
    }

    if (params.startDate) {
      body.fields.customfield_10015 = params.startDate; // Start date field
    }

    if (params.dueDate) {
      body.fields.duedate = params.dueDate;
    }

    try {
      const response = await this.client.post('/issue', body);
      const issueKey = response.data.key;

      // Add to sprint if specified (needs separate API call)
      if (params.sprintId) {
        try {
          await this.client.post(
            `/rest/agile/1.0/sprint/${params.sprintId}/issue`,
            { issues: [issueKey] },
            { baseURL: this.client.defaults.baseURL?.replace('/rest/api/3', '') }
          );
        } catch {
          // Sprint assignment might fail, but issue was created
        }
      }

      const createdIssue = await this.getIssue(issueKey);
      return createdIssue!;
    } catch (error) {
      throw this.handleApiError(error as AxiosError);
    }
  }

  async getProjects(): Promise<JiraProject[]> {
    try {
      const response = await this.client.get('/project');
      return response.data.map((project: any) => ({
        key: project.key,
        name: project.name,
      }));
    } catch (error) {
      throw this.handleApiError(error as AxiosError);
    }
  }

  async getIssueTypes(projectKey: string): Promise<IssueType[]> {
    try {
      const response = await this.client.get(`/project/${projectKey}`);
      return response.data.issueTypes
        .filter((type: any) => !type.subtask)
        .map((type: any) => ({
          id: type.id,
          name: type.name,
          description: type.description,
        }));
    } catch (error) {
      throw this.handleApiError(error as AxiosError);
    }
  }

  async getAvailableTransitions(ticketId: string): Promise<JiraTransition[]> {
    try {
      const response = await this.client.get(`/issue/${ticketId}/transitions`);
      return response.data.transitions.map((t: any) => ({
        id: t.id,
        name: t.name,
        toStatus: t.to?.name || t.name,
      }));
    } catch {
      return [];
    }
  }

  async transitionIssue(ticketId: string, transitionName: string): Promise<void> {
    try {
      // Get available transitions
      const transitionsResponse = await this.client.get(
        `/issue/${ticketId}/transitions`
      );
      const transition = transitionsResponse.data.transitions.find(
        (t: any) => t.name.toLowerCase() === transitionName.toLowerCase()
      );

      if (!transition) {
        return; // Transition not available
      }

      await this.client.post(`/issue/${ticketId}/transitions`, {
        transition: { id: transition.id },
      });
    } catch {
      // Silently fail - transition might not be available
    }
  }

  async transitionIssueById(ticketId: string, transitionId: string): Promise<void> {
    try {
      await this.client.post(`/issue/${ticketId}/transitions`, {
        transition: { id: transitionId },
      });
    } catch (error) {
      throw this.handleApiError(error as AxiosError);
    }
  }

  private textToAdf(text: string): object {
    return {
      type: 'doc',
      version: 1,
      content: text.split('\n').map((line) => ({
        type: 'paragraph',
        content: line
          ? [
              {
                type: 'text',
                text: line,
              },
            ]
          : [],
      })),
    };
  }

  private extractTextFromAdf(adf: any): string {
    if (!adf || !adf.content) return '';

    const extractText = (node: any): string => {
      if (node.type === 'text') return node.text || '';
      if (node.content) return node.content.map(extractText).join('');
      return '';
    };

    return adf.content.map(extractText).join('\n');
  }

  private handleApiError(error: AxiosError): Error {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as any;

      if (status === 401) {
        return new Error('Jira authentication failed. Check your API token.');
      }
      if (status === 403) {
        return new Error('Access denied. You may not have permission for this action.');
      }
      if (status === 404) {
        return new Error('Resource not found.');
      }
      if (data?.errorMessages?.length > 0) {
        return new Error(data.errorMessages.join(', '));
      }
    }
    return new Error('Failed to communicate with Jira API.');
  }
}
