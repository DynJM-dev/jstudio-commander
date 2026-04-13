import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { eventBus } from '../ws/event-bus.js';

let tunnelProcess: ChildProcess | null = null;
let tunnelUrl: string | null = null;

export const tunnelService = {
  isCloudflaredInstalled(): boolean {
    try {
      execSync('which cloudflared', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  async start(): Promise<string> {
    if (tunnelProcess) {
      if (tunnelUrl) return tunnelUrl;
      throw new Error('Tunnel is already starting');
    }

    if (!this.isCloudflaredInstalled()) {
      throw new Error('cloudflared is not installed. Install it with: brew install cloudflared');
    }

    return new Promise<string>((resolve, reject) => {
      const proc = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3001'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      tunnelProcess = proc;
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Timed out waiting for tunnel URL'));
        }
      }, 30_000);

      const handleOutput = (data: Buffer) => {
        const line = data.toString();
        // cloudflared prints the URL in stderr like: "https://xxx.trycloudflare.com"
        const urlMatch = line.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (urlMatch && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          tunnelUrl = urlMatch[1]!;
          eventBus.emitTunnelStarted(tunnelUrl);
          resolve(tunnelUrl);
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to start cloudflared: ${err.message}`));
        }
        tunnelProcess = null;
        tunnelUrl = null;
      });

      proc.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited with code ${code}`));
        }
        tunnelProcess = null;
        tunnelUrl = null;
        eventBus.emitTunnelStopped();
      });
    });
  },

  stop(): void {
    if (tunnelProcess) {
      try {
        tunnelProcess.kill('SIGTERM');
      } catch {
        // Already dead
      }
      tunnelProcess = null;
      tunnelUrl = null;
      eventBus.emitTunnelStopped();
    }
  },

  getStatus(): { active: boolean; url?: string } {
    return {
      active: tunnelProcess !== null && tunnelUrl !== null,
      url: tunnelUrl ?? undefined,
    };
  },

  cleanup(): void {
    this.stop();
  },
};
