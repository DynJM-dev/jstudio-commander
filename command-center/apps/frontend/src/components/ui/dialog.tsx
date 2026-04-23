import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export interface DialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  widthClassName?: string;
}

export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  widthClassName = 'w-[720px] max-w-[92vw]',
}: DialogShellProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <RadixDialog.Content
          className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl ${widthClassName} max-h-[85vh] overflow-hidden flex flex-col`}
        >
          <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-neutral-800">
            <div className="flex-1 min-w-0">
              <RadixDialog.Title className="text-base font-semibold tracking-tight">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-xs text-neutral-400 mt-0.5">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </RadixDialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
