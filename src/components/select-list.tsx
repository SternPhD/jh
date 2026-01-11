import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Fuse from 'fuse.js';

export interface SelectItem<T = any> {
  label: string;
  value: T;
  description?: string;
}

interface SelectListProps<T> {
  items: SelectItem<T>[];
  onSelect: (item: SelectItem<T>) => void;
  onBack?: () => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  groupBy?: (item: SelectItem<T>) => string;
  renderItem?: (item: SelectItem<T>, isSelected: boolean) => React.ReactNode;
}

export function SelectList<T>({
  items,
  onSelect,
  onBack,
  searchable = false,
  searchPlaceholder = 'Type to search...',
  searchKeys = ['label'],
  groupBy,
  renderItem,
}: SelectListProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState(items);

  // Set up Fuse.js for fuzzy search
  const fuse = new Fuse(items, {
    keys: searchKeys,
    threshold: 0.4,
    includeScore: true,
  });

  // Filter items when search query changes
  useEffect(() => {
    if (!searchable || !searchQuery) {
      setFilteredItems(items);
      setSelectedIndex(0);
      return;
    }

    const results = fuse.search(searchQuery);
    setFilteredItems(results.map((r) => r.item));
    setSelectedIndex(0);
  }, [searchQuery, items, searchable]);

  useInput((input, key) => {
    if (key.escape && onBack) {
      onBack();
      return;
    }

    if (key.return && filteredItems.length > 0) {
      onSelect(filteredItems[selectedIndex]);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredItems.length - 1
      );
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev < filteredItems.length - 1 ? prev + 1 : 0
      );
      return;
    }

    // Handle search input
    if (searchable && input && !key.ctrl && !key.meta) {
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1));
      } else if (input.length === 1 && input.match(/[a-zA-Z0-9\s-]/)) {
        setSearchQuery((prev) => prev + input);
      }
    }
  });

  // Group items if groupBy is provided
  const renderItems = () => {
    if (!groupBy) {
      return filteredItems.map((item, index) => (
        <ItemRow
          key={index}
          item={item}
          isSelected={index === selectedIndex}
          renderItem={renderItem}
        />
      ));
    }

    // Group items
    const groups = new Map<string, SelectItem<T>[]>();
    let currentIndex = 0;
    const indexMap = new Map<SelectItem<T>, number>();

    filteredItems.forEach((item) => {
      const group = groupBy(item);
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(item);
      indexMap.set(item, currentIndex++);
    });

    const elements: React.ReactNode[] = [];
    groups.forEach((groupItems, groupName) => {
      elements.push(
        <Box key={`group-${groupName}`} marginTop={1}>
          <Text dimColor>─────────── {groupName} ───────────</Text>
        </Box>
      );
      groupItems.forEach((item) => {
        const index = indexMap.get(item)!;
        elements.push(
          <ItemRow
            key={`item-${index}`}
            item={item}
            isSelected={index === selectedIndex}
            renderItem={renderItem}
          />
        );
      });
    });

    return elements;
  };

  return (
    <Box flexDirection="column">
      {searchable && (
        <Box marginBottom={1}>
          <Text dimColor>
            {searchQuery || searchPlaceholder}
            {searchQuery && <Text>█</Text>}
          </Text>
        </Box>
      )}

      {filteredItems.length === 0 ? (
        <Text dimColor>No items found</Text>
      ) : (
        renderItems()
      )}
    </Box>
  );
}

interface ItemRowProps<T> {
  item: SelectItem<T>;
  isSelected: boolean;
  renderItem?: (item: SelectItem<T>, isSelected: boolean) => React.ReactNode;
}

function ItemRow<T>({ item, isSelected, renderItem }: ItemRowProps<T>) {
  if (renderItem) {
    return <>{renderItem(item, isSelected)}</>;
  }

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>
        {isSelected ? '→ ' : '  '}
        {item.label}
      </Text>
      {item.description && (
        <Text dimColor> {item.description}</Text>
      )}
    </Box>
  );
}
