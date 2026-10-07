import type http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Server as IOServer, type Socket } from 'socket.io';
import { commandSchema, isAllowed, rateBucket, thumbnailFor, type Command, type VideoInput } from '../shared/commands';
import { LIMITS, RATE_LIMITS } from '../shared/constants';
import type { Ack, HostInfo, Role, Video } from '../shared/types';
import { APP_VERSION } from './env';
import type { Hub } from './hub';
import { log } from './log';
import { ModeError, type ModeController } from './ModeController';
import type { PopupPlayer } from './browser/popupPlayer';
import { isLoopback, type HostAllowlist } from './net/hostCheck';
import { addFirewallRule } from './net/firewall';
import { RateLimiter } from './net/rateLimit';
import { PlaylistError } from './playlists/PlaylistService';
import { QueueError } from './queue/QueueManager';
import { PlaylistUnavailableError } from './youtube/fetchPlaylist';

interface SocketData {
  role: Role;
  nickname: string;
  viaLan: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEvents = Record<string, (...args: any[]) => void>;
type KSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;

function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function cleanNickname(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxNicknameLength) : '';
  return s || fallback;
}

function toVideo(v: VideoInput): Video {
  return { ...v, thumbnailUrl: thumbnailFor(v.videoId) };
}

const short = (title: string) => (title.length > 60 ? `${title.slice(0, 57)}…` : title);

export function createSocketServer(opts: {
  server: http.Server;
  hub: Hub;
  hosts: HostAllowlist;
  getModes: () => ModeController;
  hostInfo: () => Promise<HostInfo>;
  getPopup: () => PopupPlayer;
  onHostCountChange: (count: number) => void;
}): IOServer {
  const { hub, hosts } = opts;
  const io = new IOServer(opts.server, {
    serveClient: false,
    maxHttpBufferSize: 256 * 1024,
    allowRequest: (req, cb) => {
      const host = req.headers.host;
      cb(null, hosts.isAllowedHost(host) && hosts.isAllowedOrigin(req.headers.origin, host));
    },
  });
  const limiter = new RateLimiter();
  let hostCount = 0;

  hub.on('state', (s) => io.emit('state', s));
  hub.on('playback', (p) => io.emit('playback', p));
  hub.on('toast', (t, audience) => (audience === 'all' ? io.emit('toast', t) : io.to(audience).emit('toast', t)));
  hub.on('playlistsChanged', () => io.emit('playlists:changed'));
  hub.on('settingsChanged', async () => io.to('host').emit('settings', await opts.hostInfo()));

  io.on('connection', (raw) => {
    const socket = raw as unknown as KSocket;
    const req = socket.request;
    const viaLan = !isLoopback(req.socket.localAddress) || !hosts.isLocalPort(req.socket.localPort);
    const auth = socket.handshake.auth ?? {};
    const isHost = !viaLan && isLoopback(req.socket.remoteAddress) && tokenMatches(auth.token, hub.hostToken);
    const role: Role = isHost ? 'host' : 'guest';
    socket.data = { role, viaLan, nickname: cleanNickname(auth.nickname, isHost ? 'Host' : 'Guest') };
    void socket.join(role);

    socket.emit('hello', { role, version: APP_VERSION });
    socket.emit('state', hub.state());
    if (isHost) {
      hostCount++;
      opts.onHostCountChange(hostCount);
    }
    log.info(`${role} connected (${socket.data.nickname}${viaLan ? ', LAN' : ''})`);

    socket.on('cmd', async (payload: unknown, ack?: (res: Ack<unknown>) => void) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const parsed = commandSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: 'Invalid request.' });
      const cmd = parsed.data;
      if (!isAllowed(socket.data.role, cmd.type)) return reply({ ok: false, error: 'Only the main screen can do that.' });

      const bucket = rateBucket(cmd.type);
      if (bucket && socket.data.role === 'guest') {
        const [max, windowMs] = RATE_LIMITS[bucket];
        if (!limiter.allow(`${socket.id}:${bucket}`, max, windowMs)) {
          return reply({ ok: false, error: 'Too many requests. Slow down a little.' });
        }
      }

      try {
        reply({ ok: true, data: await handle(cmd, socket) });
      } catch (err) {
        if (err instanceof QueueError || err instanceof PlaylistError || err instanceof ModeError || err instanceof PlaylistUnavailableError) {
          reply({ ok: false, error: err.message });
        } else {
          log.error(`Command ${cmd.type} failed:`, err);
          reply({ ok: false, error: 'Something went wrong.' });
        }
      }
    });

    socket.on('disconnect', () => {
      limiter.forget(`${socket.id}:`);
      if (socket.data.role === 'host') {
        hostCount--;
        opts.onHostCountChange(hostCount);
      }
    });
  });

  async function handle(cmd: Command, socket: KSocket): Promise<unknown> {
    const who = socket.data.nickname;
    const isGuest = socket.data.role === 'guest';
    switch (cmd.type) {
      case 'queue:add': {
        const item = hub.queue.add(toVideo(cmd.video), who, cmd.position);
        if (isGuest) hub.toast(`${who} added "${short(item.title)}"`, 'info', 'host');
        return { itemId: item.id };
      }
      case 'queue:addMany': {
        const items = hub.queue.addMany(cmd.videos.map(toVideo), who, cmd.position);
        if (isGuest) hub.toast(`${who} added ${items.length} song${items.length === 1 ? '' : 's'}`, 'info', 'host');
        return { added: items.length };
      }
      case 'queue:move':
        return hub.queue.move(cmd.itemId, cmd.toIndex);
      case 'queue:remove': {
        const item = hub.queue.remove(cmd.itemId);
        hub.toast(`${who} removed "${short(item.title)}"`);
        return undefined;
      }
      case 'queue:clear':
        hub.queue.clear();
        hub.toast('Queue cleared');
        return undefined;
      case 'player:skip': {
        const skipped = hub.queue.skip();
        if (skipped) hub.toast(`${who} skipped "${short(skipped.title)}"`);
        return undefined;
      }
      case 'session:setNickname':
        socket.data.nickname = cleanNickname(cmd.nickname, socket.data.nickname);
        return undefined;

      case 'player:ended':
        hub.queue.ended(cmd.itemId);
        return undefined;
      case 'player:error': {
        const current = hub.queue.current();
        if (!current || current.id !== cmd.itemId || opts.getPopup().itemId === cmd.itemId) return undefined;
        log.warn(`Video ${current.videoId} failed with player error ${cmd.code}`);
        // 101/150: the owner blocks playback outside youtube.com (often a label's copyright
        // claim). It still plays on youtube.com itself, so open it in a YouTube window there.
        // Nothing is remembered: every song is tried in the app first, every time.
        const embedBlocked = cmd.code === 101 || cmd.code === 150;
        if (embedBlocked && hub.settings.get().blockedSongs === 'popup') {
          hub.toast(`"${short(current.title)}" can't play inside the app, so it's opening in a YouTube window`, 'info');
          const pb = hub.queue.snapshot().playback;
          void opts.getPopup().start(current, pb.itemId === current.id ? pb.positionSec : 0);
          return undefined;
        }
        const item = hub.queue.failed(cmd.itemId);
        if (item) {
          hub.toast(
            embedBlocked
              ? `Skipped "${short(item.title)}": the uploader doesn't allow it to play inside the app`
              : `Skipped "${short(item.title)}": it failed to play (error ${cmd.code})`,
            'warning',
          );
        }
        return undefined;
      }
      case 'volume:set':
        hub.settings.update({ volume: cmd.volume });
        return undefined;
      case 'popup:extend':
        opts.getPopup().extend();
        return undefined;
      case 'player:progress':
        hub.queue.progress(cmd.itemId, cmd.positionSec, cmd.status);
        return undefined;

      case 'mode:set':
        await opts.getModes().setMode(cmd.mode);
        return undefined;
      case 'settings:get':
        return opts.hostInfo();
      case 'settings:update': {
        const before = hub.settings.get();
        const after = hub.settings.update(cmd.patch);
        if (hub.mode === 'party' && before.lanPort !== after.lanPort) await opts.getModes().restartParty();
        else if (hub.mode === 'party' && before.lanAddress !== after.lanAddress) await opts.getModes().refreshJoinUrl();
        return undefined;
      }
      case 'client:log':
        log.info(`[display] ${cmd.message}`);
        return undefined;
      case 'firewall:allow': {
        const ok = await addFirewallRule(hub.settings.get().lanPort);
        hub.emit('settingsChanged');
        if (!ok) throw new ModeError('The firewall rule was not added (the Windows prompt was cancelled or failed).');
        hub.toast('Phones are now allowed through Windows Firewall', 'success', 'host');
        return undefined;
      }

      case 'playlist:preview':
        return hub.playlists.preview(cmd.url);
      case 'playlist:save':
        return hub.playlists.save(cmd.url, cmd.customName);
      case 'playlist:remove':
        return hub.playlists.remove(cmd.id);
      case 'playlist:rename':
        return hub.playlists.rename(cmd.id, cmd.customName);
      case 'playlist:refresh':
        await hub.playlists.refresh(cmd.id);
        return undefined;
      case 'playlist:restoreDefaults':
        return hub.playlists.restoreDefaults();

      case 'app:exit':
        hub.toast('The karaoke app was closed on the main screen.', 'warning', 'guest');
        setTimeout(() => hub.emit('exit'), 200);
        return undefined;
    }
  }

  return io;
}

