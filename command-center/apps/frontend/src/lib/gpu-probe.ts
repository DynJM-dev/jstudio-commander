// Webview-introspection GPU probe — per KB-P4.12 + dispatch §1.3 + SMOKE_
// DISCIPLINE §4.2 sanctioned exception ("chrome://gpu OR equivalent"). We
// can't navigate to chrome://gpu in WKWebView (Chromium-only URL), but we
// CAN query the WebGL renderer info which answers the same question: is
// this context hardware-accelerated, and on what GPU?
//
// Software fallback signatures:
//   - "SwiftShader" (Chromium's software GL)
//   - "Mesa/X.org llvmpipe" (Linux software fallback)
//   - "Apple Software Renderer" (macOS rare fallback)
// Hardware signatures (macOS): "Apple M1", "Apple M2", "Apple GPU", "AMD
// Radeon *", "Intel Iris *".

export interface GpuProbe {
  accelerated: boolean;
  renderer: string;
  vendor: string;
  webglVersion: 'webgl2' | 'webgl' | 'none';
  reason?: string;
}

const SOFTWARE_SIGNATURES = [
  'swiftshader',
  'llvmpipe',
  'software rasterizer',
  'apple software renderer',
];

export function probeGpu(): GpuProbe {
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    const gl = gl2 ?? canvas.getContext('webgl');
    if (!gl) {
      return {
        accelerated: false,
        renderer: 'unavailable',
        vendor: 'unavailable',
        webglVersion: 'none',
        reason: 'WebGL context creation failed',
      };
    }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const vendor = dbg
      ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR));
    const lower = renderer.toLowerCase();
    const software = SOFTWARE_SIGNATURES.some((s) => lower.includes(s));
    return {
      accelerated: !software,
      renderer,
      vendor,
      webglVersion: gl2 ? 'webgl2' : 'webgl',
      reason: software ? 'Renderer matches software fallback signature' : undefined,
    };
  } catch (err) {
    return {
      accelerated: false,
      renderer: 'probe-error',
      vendor: 'probe-error',
      webglVersion: 'none',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
