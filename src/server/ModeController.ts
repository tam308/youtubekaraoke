import http from 'node:http';
import type net from 'node:net';
import type { Server as IOServer } from 'socket.io';
import { PORT_SCAN_RANGE } from '../shared/constants';
import type { Hub } from './hub';
import { log } from './log';
import type { HostAllowlist } from './net/hostCheck';
import { listLanAdaptersNow, pickLanAddress } from './net/lanAddress';

export class ModeError extends Error {}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Party mode = a second HTTP listener on all network adapters (so phones can reach the PC
 * whichever network they're on: Wi-Fi, Ethernet, or this PC's own hotspot). It forwards every
 * request and WebSocket upgrade to the loopback server, so Express and Socket.io are shared.
 * The Host allowlist still only accepts this PC's private IPs on the party port.
 * Local mode = that listener is closed and every LAN client is disconnected.
 */
export class ModeController {
  private lan: http.Server | null = null;
  private lanSockets = new Set<net.Socket>();
  private boundPort: number | null = null;
  private watchTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly local: http.Server,
    private readonly io: IOServer,
    private readonly hosts: HostAllowlist,
    private readonly hub: Hub,
  ) {}

  async setMode(mode: 'party' | 'local'): Promise<void> {
    if (mode === 'party') await this.enterParty();
    else await this.enterLocal();
    this.hub.settings.update({ mode });
  }

  /** Re-bind after the party port setting changed. */
  async restartParty(): Promise<void> {
    if (!this.lan) return;
    await this.closeLan();
    await this.enterParty();
  }

  /** Recompute the QR/join URL (e.g. the chosen adapter changed). No re-bind needed. */
  async refreshJoinUrl(): Promise<void> {
    if (!this.lan || this.boundPort === null) return;
    const address = pickLanAddress(this.hub.settings.get().lanAddress, await listLanAdaptersNow());
    const joinUrl = address ? `http://${address}:${this.boundPort}/` : null;
    if (joinUrl !== this.hub.joinUrl) {
      log.info(`Join URL changed: ${joinUrl}`);
      this.hub.setMode('party', joinUrl);
    }
  }

  private async enterParty(): Promise<void> {
    if (this.lan) return;
    const { lanAddress, lanPort } = this.hub.settings.get();
    const address = pickLanAddress(lanAddress, await listLanAdaptersNow());
    if (!address) {
      throw new ModeError('No Wi-Fi or Ethernet network found. Connect this PC to the same network as the phones, or turn on Mobile hotspot.');
    }

    const server = http.createServer();
    server.on('request', (req, res) => this.local.emit('request', req, res));
    server.on('upgrade', (req, socket, head) => this.local.emit('upgrade', req, socket, head));
    server.on('connection', (s) => {
      this.lanSockets.add(s);
      s.on('close', () => this.lanSockets.delete(s));
    });

    let boundPort: number | null = null;
    for (let port = lanPort; port <= lanPort + PORT_SCAN_RANGE; port++) {
      try {
        await listen(server, port, '0.0.0.0');
        boundPort = port;
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
          throw new ModeError(`Could not open the party server: ${(err as Error).message}`);
        }
      }
    }
    if (boundPort === null) throw new ModeError(`Ports ${lanPort} to ${lanPort + PORT_SCAN_RANGE} are all in use.`);

    this.lan = server;
    this.boundPort = boundPort;
    this.hosts.setLanPort(boundPort);
    const joinUrl = `http://${address}:${boundPort}/`;
    log.info(`Party mode on: ${joinUrl}`);
    this.hub.setMode('party', joinUrl);
    // Networks change (Wi-Fi switched, hotspot turned on): keep the QR code pointing somewhere reachable.
    this.watchTimer = setInterval(() => void this.refreshJoinUrl().catch(() => undefined), 10_000);
  }

  private async enterLocal(): Promise<void> {
    await this.closeLan();
    this.hub.setMode('local', null);
  }

  private async closeLan(): Promise<void> {
    if (!this.lan) return;
    const server = this.lan;
    this.lan = null;
    this.boundPort = null;
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.hosts.setLanPort(null);
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data.viaLan) socket.disconnect(true);
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const s of this.lanSockets) s.destroy();
      this.lanSockets.clear();
    });
    log.info('Party mode off: LAN listener closed');
  }

  async shutdown(): Promise<void> {
    await this.closeLan();
  }
}
