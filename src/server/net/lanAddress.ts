import dgram from 'node:dgram';
import os from 'node:os';
import type { LanAdapter } from '../../shared/types';

// Windows virtual adapters, plus macOS tunnels/peer-to-peer links (utun, awdl, llw, anpi, gif, stf).
const VIRTUAL_RE = /vEthernet|Hyper-V|VirtualBox|VMware|WSL|Docker|Loopback|ZeroTier|Tailscale|VPN|TAP|Npcap|Bluetooth|Teredo|isatap|^utun|^awdl|^llw|^anpi|^gif|^stf/i;
const PREFERRED_RE = /Wi-?Fi|Wireless|WLAN|Ethernet|^en\d|^eth\d|^wl/i;
/** Windows "Mobile hotspot" always uses this address for the PC. */
const WINDOWS_HOTSPOT_IP = '192.168.137.1';
/** macOS Internet Sharing creates a bridgeNNN interface that phones connect through. */
const MAC_SHARING_RE = /^bridge1\d\d$/;

export function isPrivateIPv4(addr: string): boolean {
  const p = addr.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) || (p[0] === 192 && p[1] === 168);
}

type Interfaces = ReturnType<typeof os.networkInterfaces>;

/**
 * The local IPv4 the OS would use to reach the internet (i.e. the network the PC is "on").
 * Uses a UDP connect, which only consults the routing table (no packet is sent).
 */
export function getDefaultRouteAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (addr: string | null) => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(addr);
    };
    sock.on('error', () => done(null));
    try {
      sock.connect(53, '1.1.1.1', () => {
        try {
          done(sock.address().address);
        } catch {
          done(null);
        }
      });
    } catch {
      done(null);
    }
  });
}

/**
 * Private IPv4 addresses phones could reach, best candidate first:
 * 1. this PC's own Mobile hotspot (phones connected to it can only reach that address),
 * 2. the adapter carrying internet traffic (the network the PC is actually on),
 * 3. Wi-Fi/Ethernet over other adapters. Virtual adapters (Hyper-V, WSL, VPNs, ...) are skipped.
 */
export function listLanAdapters(interfaces: Interfaces = os.networkInterfaces(), defaultRoute: string | null = null): LanAdapter[] {
  const candidates: Array<LanAdapter & { score: number }> = [];
  for (const [rawName, addrs] of Object.entries(interfaces)) {
    if (!addrs || VIRTUAL_RE.test(rawName)) continue;
    for (const a of addrs) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateIPv4(a.address)) continue;
      const isMacSharing = MAC_SHARING_RE.test(rawName);
      const isHotspot = a.address === WINDOWS_HOTSPOT_IP || isMacSharing;
      let score = 0;
      if (isHotspot) score += 10;
      if (a.address === defaultRoute) score += 5;
      if (PREFERRED_RE.test(rawName)) score += 2;
      const name = isMacSharing ? 'Internet Sharing (this Mac)' : isHotspot ? 'Mobile hotspot (this PC)' : rawName;
      candidates.push({ name, address: a.address, recommended: false, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.map(({ score: _score, ...rest }, i) => ({ ...rest, recommended: i === 0 }));
}

export async function listLanAdaptersNow(): Promise<LanAdapter[]> {
  return listLanAdapters(os.networkInterfaces(), await getDefaultRouteAddress());
}

/** The configured address if it still exists, otherwise the best candidate. */
export function pickLanAddress(preferred: string | null, adapters: LanAdapter[]): string | null {
  if (preferred && adapters.some((a) => a.address === preferred)) return preferred;
  return adapters[0]?.address ?? null;
}
