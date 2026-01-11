import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = 'Loading...' }: SpinnerProps) {
  return (
    <Box>
      <Text color="cyan">
        <InkSpinner type="dots" />
      </Text>
      <Text> {label}</Text>
    </Box>
  );
}

interface SuccessMessageProps {
  messages: string[];
  onContinue?: () => void;
}

export function SuccessMessage({ messages, onContinue }: SuccessMessageProps) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index}>
          <Text color="green">✓ </Text>
          <Text>{message}</Text>
        </Box>
      ))}
      {onContinue && (
        <Box marginTop={1}>
          <Text dimColor>Press any key to continue...</Text>
        </Box>
      )}
    </Box>
  );
}

interface ErrorMessageProps {
  error: string;
  onBack?: () => void;
}

export function ErrorMessage({ error, onBack }: ErrorMessageProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="red">✗ Error: </Text>
        <Text>{error}</Text>
      </Box>
      {onBack && (
        <Box marginTop={1}>
          <Text dimColor>[Esc] Go back</Text>
        </Box>
      )}
    </Box>
  );
}
