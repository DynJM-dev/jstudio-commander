import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { api, setPin } from '../../services/api';

const M = 'Montserrat, sans-serif';

interface PinGateProps {
  children: ReactNode;
}

const isRemoteAccess = (): boolean => {
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1';
};

export const PinGate = ({ children }: PinGateProps) => {
  const [needsPin, setNeedsPin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!isRemoteAccess()) {
      setChecking(false);
      return;
    }

    // Try a request to see if PIN is needed
    api.get('/system/health').then(() => {
      setChecking(false);
    }).catch((err) => {
      if (err && typeof err === 'object' && 'requiresPin' in err && err.requiresPin) {
        setNeedsPin(true);
      }
      setChecking(false);
    });
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || verifying) return;

    setVerifying(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await res.json();

      if (data.valid) {
        setPin(pin.trim());
        setNeedsPin(false);
      } else {
        setError('Invalid PIN');
      }
    } catch {
      setError('Connection failed');
    } finally {
      setVerifying(false);
    }
  }, [pin, verifying]);

  if (checking) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: 'var(--color-bg-deep)' }}
      >
        <span className="text-sm" style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}>
          Connecting...
        </span>
      </div>
    );
  }

  if (!needsPin) {
    return <>{children}</>;
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg-deep)' }}
    >
      <div className="glass-modal p-8 w-full max-w-sm text-center">
        <Lock
          size={32}
          strokeWidth={1.5}
          style={{ color: 'var(--color-accent)' }}
          className="mx-auto mb-4"
        />
        <h2
          className="text-lg font-semibold mb-1"
          style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
        >
          JStudio Commander
        </h2>
        <p
          className="text-sm mb-5"
          style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
        >
          Enter your PIN to continue
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPinValue(e.target.value)}
            placeholder="Enter PIN"
            autoFocus
            className="w-full text-center text-2xl tracking-[0.5em] rounded-lg px-4 py-3 mb-3 outline-none"
            style={{
              fontFamily: M,
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--color-text-primary)',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'; }}
          />

          {error && (
            <p className="text-xs mb-3" style={{ color: 'var(--color-error)', fontFamily: M }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={verifying || !pin.trim()}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              fontFamily: M,
              background: 'var(--color-accent)',
              color: '#fff',
              opacity: verifying || !pin.trim() ? 0.6 : 1,
            }}
          >
            {verifying ? 'Verifying...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
};
