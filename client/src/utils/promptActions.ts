// Pure mapping from a server-detected interactive prompt into the set
// of button actions the UI should render. Shared by both permission-
// prompt surfaces (SessionTerminalPreview + PermissionPrompt) so a new
// prompt type only needs one branch added in one place.

export interface DetectedPrompt {
  type: string;
  message: string;
  context?: string;
  options?: string[];
}

export interface PromptAction {
  label: string;
  type: 'command' | 'key';
  value: string;
}

export const getPromptActions = (prompt: DetectedPrompt): PromptAction[] => {
  const options = prompt.options ?? [];

  if (prompt.type === 'choice') {
    // Numbered-choice pane (Claude Code v2.1.114 edit/permission prompt).
    // Options arrive as "1. Yes", "2. ...", "3. No"; the command we
    // send back is the 1-based index as a plain digit.
    return options.map((label, i) => ({
      label,
      type: 'command' as const,
      value: String(i + 1),
    }));
  }

  if (prompt.type === 'trust') {
    return options.map((label, i) => ({
      label,
      type: 'command' as const,
      value: i === 0 ? 'yes' : 'no',
    }));
  }

  if (prompt.type === 'permission') {
    return options.map((label) => {
      if (label === 'Allow') return { label, type: 'command' as const, value: 'y' };
      if (label === 'Allow always') return { label, type: 'command' as const, value: 'a' };
      if (label === 'Deny') return { label, type: 'command' as const, value: 'n' };
      return { label, type: 'command' as const, value: label };
    });
  }

  if (prompt.type === 'confirm') {
    // y/n prompts: server rarely provides options, so synthesize Yes/No
    // keymapped to Enter/Escape — matches the keyboard a human would hit
    // and works across every confirm shape Claude Code emits.
    const yn = options.length >= 2 ? options : ['Yes', 'No'];
    return [
      { label: yn[0]!, type: 'key', value: 'Enter' },
      { label: yn[1]!, type: 'key', value: 'Escape' },
    ];
  }

  return [];
};
