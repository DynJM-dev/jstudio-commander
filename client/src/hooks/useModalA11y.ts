import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

// Phase P.2 C2 — reusable modal a11y hook. Three concerns, one surface:
//
// 1. Autofocus the first focusable element inside the modal when it
//    opens. Restores focus to the previously-focused element on close
//    so keyboard flow returns to where the user was.
// 2. ESC closes the modal (many of our modals had inconsistent
//    coverage — some handled it, some didn't).
// 3. Tab/Shift+Tab cycles WITHIN the modal so focus can't escape
//    behind the backdrop. Native browser focus order walks the DOM; a
//    modal that's DOM-adjacent to the main layout would tab out to
//    nav items without this trap.
//
// Hand-rolled — no focus-trap-react dep. Follows the
// ForceCloseTeammateModal pattern already in the codebase, adds the
// trap + ESC coverage those modals were missing.

// Selector covers every element that can take keyboard focus by default
// (WAI-ARIA Authoring Practices list). Exported so tests can pin it.
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface UseModalA11yOpts {
  // Whether the modal is currently visible. Hook is a no-op when false.
  open: boolean;
  // Ref to the modal's containing element. Focus trap operates inside
  // this subtree.
  containerRef: RefObject<HTMLElement | null>;
  // Called when ESC is pressed. Typically the same `onClose` handler
  // the caller would pass to the backdrop click.
  onClose: () => void;
  // When true, skip the autofocus step. Useful for modals that carry
  // their own `autoFocus` attribute on a specific input (e.g. PinGate).
  skipAutoFocus?: boolean;
}

export const useModalA11y = ({ open, containerRef, onClose, skipAutoFocus }: UseModalA11yOpts): void => {
  // Remember who had focus BEFORE the modal opened so we can restore
  // it on close. Captured at open-time; released on close.
  const restoreTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTargetRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const container = containerRef.current;
    if (container && !skipAutoFocus) {
      // Defer one tick so any framer-motion enter animation that
      // transforms the element doesn't race the focus call.
      const id = setTimeout(() => {
        const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length > 0) {
          focusable[0]!.focus();
        } else {
          // No focusable children — give the container itself focus
          // so screen readers announce the dialog.
          container.focus({ preventScroll: true });
        }
      }, 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open, containerRef, skipAutoFocus]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        // Nothing tabbable inside → don't let Tab move focus out.
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, containerRef, onClose]);

  useEffect(() => {
    if (open) return;
    // Modal transitioned from open → closed. Put focus back where the
    // user started so keyboard flow continues seamlessly.
    const target = restoreTargetRef.current;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      target.focus();
    }
    restoreTargetRef.current = null;
  }, [open]);
};
