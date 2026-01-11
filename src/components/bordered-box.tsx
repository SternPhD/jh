import React from 'react';
import { Box, Text } from 'ink';

interface BorderedBoxProps {
  title?: string;
  children: React.ReactNode;
  width?: number;
}

export function BorderedBox({ title, children, width }: BorderedBoxProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      width={width}
    >
      {title && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {title}
          </Text>
        </Box>
      )}
      {children}
    </Box>
  );
}

interface StatusBoxProps {
  repo?: string | null;
  workspace?: string | null;
  branch?: string | null;
  ticket?: {
    key: string;
    summary: string;
    status: string;
  } | null;
  commitsAhead?: number;
}

export function StatusBox({
  repo,
  workspace,
  branch,
  ticket,
  commitsAhead = 0,
}: StatusBoxProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      {/* Header */}
      <Box>
        <Text bold color="cyan">
          {repo || 'Unknown repo'}
        </Text>
        {workspace && (
          <>
            <Text dimColor> → </Text>
            <Text color="yellow">{workspace}</Text>
          </>
        )}
      </Box>

      {/* Separator */}
      <Box marginY={0}>
        <Text dimColor>────────────────────────────────────────</Text>
      </Box>

      {/* Branch info */}
      {branch && (
        <Box>
          <Text dimColor>Branch: </Text>
          <Text>{branch}</Text>
        </Box>
      )}

      {/* Ticket info */}
      {ticket && (
        <Box>
          <Text dimColor>Ticket: </Text>
          <Text>"{ticket.summary}" </Text>
          <Text color="yellow">[{ticket.status}]</Text>
        </Box>
      )}

      {/* Commits ahead */}
      {commitsAhead > 0 && (
        <Box>
          <Text dimColor>Commits: </Text>
          <Text>{commitsAhead} ahead of main</Text>
        </Box>
      )}
    </Box>
  );
}

interface KeyHintsProps {
  hints: { key: string; action: string }[];
}

export function KeyHints({ hints }: KeyHintsProps) {
  return (
    <Box marginTop={1}>
      {hints.map((hint, index) => (
        <React.Fragment key={hint.key}>
          {index > 0 && <Text dimColor>  </Text>}
          <Text dimColor>[</Text>
          <Text color="cyan">{hint.key}</Text>
          <Text dimColor>] {hint.action}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
}
