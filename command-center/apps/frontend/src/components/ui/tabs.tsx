import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export interface TabsShellProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: Array<{ value: string; label: string; content: ReactNode }>;
}

export function TabsShell({ value, onValueChange, tabs }: TabsShellProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className="flex flex-col h-full">
      <RadixTabs.List className="flex gap-1 px-6 pt-3 border-b border-neutral-800">
        {tabs.map((t) => (
          <RadixTabs.Trigger
            key={t.value}
            value={t.value}
            className="px-3 py-2 text-sm text-neutral-400 data-[state=active]:text-neutral-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-400 hover:text-neutral-200 transition-colors -mb-px"
          >
            {t.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((t) => (
        <RadixTabs.Content
          key={t.value}
          value={t.value}
          className="p-6 data-[state=inactive]:hidden focus-visible:outline-none"
        >
          {t.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
