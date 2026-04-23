import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { XtermContainer } from '../src/xterm-container';

afterEach(() => cleanup());

describe('XtermContainer (KB-P4.2 scrollbar-gutter + explicit-dispose)', () => {
  it('renders host div with overflow:hidden inline style', () => {
    const { getByTestId } = render(<XtermContainer skipFit />);
    const host = getByTestId('xterm-container') as HTMLDivElement;
    expect(host).toBeTruthy();
    expect(host.style.overflow).toBe('hidden');
    expect(host.style.width).toBe('100%');
    expect(host.style.height).toBe('100%');
  });

  it('applies the cmdr-xterm-host scope class that our CSS targets', () => {
    const { getByTestId } = render(<XtermContainer skipFit />);
    const host = getByTestId('xterm-container');
    expect(host.className).toContain('cmdr-xterm-host');
  });

  it('inlines the scrollbar-gutter CSS rules (scrollbar-width:none + ::-webkit-scrollbar width:0)', () => {
    const { container } = render(<XtermContainer skipFit />);
    const styleTag = container.querySelector('style');
    expect(styleTag).toBeTruthy();
    const css = styleTag?.textContent ?? '';
    expect(css).toContain('scrollbar-width: none');
    expect(css).toContain('::-webkit-scrollbar');
    expect(css).toMatch(/width:\s*0/);
    expect(css).toMatch(/display:\s*none/);
  });

  it('unmounts cleanly without throwing — explicit-dispose discipline', () => {
    const { unmount } = render(<XtermContainer skipFit />);
    expect(() => unmount()).not.toThrow();
  });
});
