import os from 'node:os';
import { isPrivateIPv4 } from './lanAddress';

/** This machine's private IPv4 addresses, cached briefly (checked on every request). */
let cache: { at: number; addrs: Set<string> } | null = null;
function localPrivateAddresses(): Set<string> {
  if (cache && Date.now() - cache.at < 5000) return cache.addrs;
  const addrs = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && isPrivateIPv4(a.address)) addrs.add(a.address);
  }
  cache = { at: Date.now(), addrs };
  return addrs;
}

/**
 * Guards against DNS rebinding and cross-site requests from other web pages
 * open in the user's browser. Only these Host values are accepted:
 * - `127.0.0.1:<localPort>` / `localhost:<localPort>` (always)
 * - `<any private IPv4 of this PC>:<lanPort>` (only while Party mode is on)
 */
export class HostAllowlist {
  private localPort: number | null = null;
  private lanPort: number | null = null;

  constructor(private readonly getAddresses: () => Set<string> = localPrivateAddresses) {}

  setLocal(port: number): void {
    this.localPort = port;
  }

  /** True if a connection arrived on the loopback-only app port (not the party port). */
  isLocalPort(port: number | undefined): boolean {
    return port !== undefined && port === this.localPort;
  }

  setLanPort(port: number | null): void {
    this.lanPort = port;
  }

  isAllowedHost(host: string | undefined): boolean {
    if (!host) return false;
    const m = /^([^:]+):(\d+)$/.exec(host.toLowerCase());
    if (!m) return false;
    const [, name, portStr] = m;
    const port = Number(portStr);
    if (port === this.localPort && (name === '127.0.0.1' || name === 'localhost')) return true;
    return port === this.lanPort && this.getAddresses().has(name!);
  }

  /**
   * Browsers always send Origin on WebSocket and cross-origin requests. A request is accepted
   * when there is no Origin (non-browser client) or the Origin matches the Host it was sent to.
   */
  isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (!origin) return true;
    try {
      const u = new URL(origin);
      return u.protocol === 'http:' && !!host && u.host.toLowerCase() === host.toLowerCase() && this.isAllowedHost(u.host);
    } catch {
      return false;
    }
  }
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
