// jsdom polyfills xterm requires that jsdom 25 doesn't ship out of the box.
// Keep this narrow — only what's load-bearing for the smoke probe.

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// xterm probes getBoundingClientRect + ResizeObserver. jsdom returns zeros;
// the component's rAF-deferred fit() swallows the resulting NaN dims. No
// polyfill needed — just confirming the shape is tolerable.

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
