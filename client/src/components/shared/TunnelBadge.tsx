import { useEffect, useRef, useState } from 'react';
import { Globe, Copy, Check, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { api } from '../../services/api';
import type { WSEvent } from '@commander/shared';

const M = 'Montserrat, sans-serif';

interface TunnelStatus {
  active: boolean;
  url?: string;
}

// Surfaces the active Cloudflare tunnel URL in the TopCommandBar with a
// copy button and a QR-code popover. Renders nothing when no tunnel is
// up — staying out of the layout when there's nothing to surface keeps
// the bar uncluttered. Reads /api/tunnel/status once on mount, then
// stays in sync via the existing WS tunnel:started/tunnel:stopped
// events (no extra polling).
export const TunnelBadge = () => {
  const [active, setActive] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const { lastEvent } = useWebSocket();
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<TunnelStatus>('/tunnel/status')
      .then((res) => { setActive(res.active); setUrl(res.url ?? null); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    const ev = lastEvent as WSEvent;
    if (ev.type === 'tunnel:started') {
      setActive(true);
      setUrl(ev.url);
    } else if (ev.type === 'tunnel:stopped') {
      setActive(false);
      setUrl(null);
      setQrOpen(false);
    }
  }, [lastEvent]);

  // Close QR popover on outside click.
  useEffect(() => {
    if (!qrOpen) return;
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setQrOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [qrOpen]);

  if (!active || !url) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative" ref={popRef}>
      <div
        className="flex items-center gap-1.5 px-2 h-7 rounded-md"
        style={{
          fontFamily: M,
          background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
          color: 'var(--color-accent-light)',
          boxShadow: '0 0 10px -3px var(--color-accent-glow)',
        }}
        title={url}
      >
        <Globe size={11} strokeWidth={2.2} />
        <span className="text-[10px] font-mono-stats truncate max-w-[140px]">
          {url.replace(/^https?:\/\//, '')}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center justify-center rounded transition-colors"
          style={{
            width: 18, height: 18,
            color: copied ? 'var(--color-working)' : 'var(--color-accent-light)',
            background: copied ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
          }}
          aria-label={copied ? 'Copied' : 'Copy tunnel URL'}
          title={copied ? 'Copied' : 'Copy URL'}
        >
          {copied ? <Check size={11} strokeWidth={2.4} /> : <Copy size={11} strokeWidth={2} />}
        </button>
        <button
          onClick={() => setQrOpen((v) => !v)}
          className="flex items-center justify-center rounded transition-colors"
          style={{
            width: 18, height: 18,
            color: qrOpen ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
            background: qrOpen ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'transparent',
          }}
          aria-label={qrOpen ? 'Hide QR code' : 'Show QR code for phone access'}
          title="Phone access (QR)"
        >
          <QrCode size={11} strokeWidth={2} />
        </button>
      </div>

      {qrOpen && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 rounded-xl"
          style={{
            background: 'rgba(12, 16, 22, 0.96)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
            backdropFilter: 'blur(24px) saturate(180%)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 24px -6px var(--color-accent-glow)',
            padding: 16,
            fontFamily: M,
          }}
        >
          <div className="flex flex-col items-center gap-2">
            <div
              style={{
                background: '#fff',
                padding: 8,
                borderRadius: 8,
              }}
            >
              <QRCodeSVG value={url} size={144} level="M" />
            </div>
            <span
              className="text-[10px] font-mono-stats text-center max-w-[160px] break-all"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {url.replace(/^https?:\/\//, '')}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Scan with your phone camera
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
