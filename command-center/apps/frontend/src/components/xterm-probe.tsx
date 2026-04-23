import { XtermContainer } from '@commander/ui';

const SAMPLE_CONTENT = [
  '\x1b[1;36mCommand-Center\x1b[0m — xterm probe',
  '─────────────────────────────────────────────────────────────────────────────',
  '\x1b[32m✓\x1b[0m ascii characters render',
  '\x1b[32m✓\x1b[0m em-dash — en-dash – bullet •',
  '\x1b[32m✓\x1b[0m box drawing: ┌─┐ │ │ └─┘ ╔═╗ ║ ║ ╚═╝',
  '\x1b[32m✓\x1b[0m braille: \x1b[33m⠁ ⠂ ⠄ ⠈ ⠐ ⠠ ⡀ ⢀ ⣾⣽⣻⢿⡿⣟⣯⣷\x1b[0m',
  '\x1b[32m✓\x1b[0m CJK: 你好世界 こんにちは 안녕하세요',
  '',
  'Horizontal overflow test — long line that should NOT produce a 14px dead strip on the right side:',
  `\x1b[90m${'x'.repeat(220)}\x1b[0m`,
  '',
  '\x1b[2mIf any mojibake (â / â¢) appears here, the utf8 decoder path is wrong.\x1b[0m',
  '\x1b[2mIf a 14px blank gutter appears on the right, scrollbar-gutter CSS failed to load.\x1b[0m',
].join('\r\n');

/**
 * Debug-tab smoke probe for the scrollbar-gutter CSS fix (KB-P4.2) and a
 * visual mojibake sanity check across the character classes Bug K exercised.
 * Lazy-loaded so the main bundle stays under 500 KB per KB-P1.14.
 */
export function XtermProbe() {
  return <XtermContainer initialContent={SAMPLE_CONTENT} />;
}
