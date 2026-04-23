import { useMemo } from 'react';

export function HomePage() {
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes('mac'), []);
  const cmdKey = isMac ? '⌘' : 'Ctrl';

  return (
    <main className="h-full w-full flex flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-100 select-none">
      <div className="text-4xl font-semibold tracking-tight">Command-Center</div>
      <div className="text-sm text-neutral-400">ready.</div>
      <div className="text-xs text-neutral-500 mt-6">
        <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300">
          {cmdKey}
        </kbd>
        <span className="mx-1">+</span>
        <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300">
          ,
        </kbd>
        <span className="ml-2">opens Preferences</span>
      </div>
      <div className="absolute bottom-4 right-4 text-[11px] text-neutral-600 font-mono">
        v0.1.0-n1 · foundation
      </div>
    </main>
  );
}
