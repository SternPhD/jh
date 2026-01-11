import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBack?: () => void;
  placeholder?: string;
  mask?: boolean;
  multiline?: boolean;
}

export function TextInput({
  label,
  value,
  onChange,
  onSubmit,
  onBack,
  placeholder = '',
  mask = false,
  multiline = false,
}: TextInputProps) {
  useInput((input, key) => {
    if (key.escape && onBack) {
      onBack();
      return;
    }

    if (key.return && !multiline) {
      onSubmit();
      return;
    }

    // For multiline: Tab to submit (more reliable than Ctrl+Enter in terminals)
    if (key.tab && multiline) {
      onSubmit();
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    if (key.return && multiline) {
      onChange(value + '\n');
      return;
    }

    if (input && !key.ctrl && !key.meta && !key.tab) {
      onChange(value + input);
    }
  });

  const displayValue = mask ? '•'.repeat(value.length) : value;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{label}</Text>
      </Box>
      <Box>
        <Text>
          {displayValue || <Text dimColor>{placeholder}</Text>}
          <Text color="cyan">█</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {multiline ? '[Tab] Submit  ' : '[Enter] Continue  '}
          {onBack && '[Esc] Back'}
        </Text>
      </Box>
    </Box>
  );
}

interface ConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ message, onConfirm, onCancel }: ConfirmProps) {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (selected === 'yes') {
        onConfirm();
      } else {
        onCancel();
      }
      return;
    }

    if (key.leftArrow || key.rightArrow || input === 'y' || input === 'n') {
      if (input === 'y') {
        setSelected('yes');
        onConfirm();
      } else if (input === 'n') {
        setSelected('no');
        onCancel();
      } else {
        setSelected((prev) => (prev === 'yes' ? 'no' : 'yes'));
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{message}</Text>
      <Box marginTop={1}>
        <Text color={selected === 'yes' ? 'green' : undefined}>
          {selected === 'yes' ? '→ ' : '  '}Yes
        </Text>
        <Text>  </Text>
        <Text color={selected === 'no' ? 'red' : undefined}>
          {selected === 'no' ? '→ ' : '  '}No
        </Text>
      </Box>
    </Box>
  );
}
