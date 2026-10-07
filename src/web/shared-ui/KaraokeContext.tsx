import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { CommandInput } from '../../shared/commands';
import type { Ack, HostInfo, KaraokeState, Playback, Role, Toast } from '../../shared/types';

interface KaraokeCtx {
  connected: boolean;
  everConnected: boolean;
  role: Role | null;
  serverVersion: string | null;
  state: KaraokeState | null;
  playback: Playback | null;
  hostInfo: HostInfo | null;
  /** Bumped whenever the server says playlists changed, so lists can refetch. */
  playlistsVersion: number;
  toasts: Toast[];
  send: <T = unknown>(cmd: CommandInput, timeoutMs?: number) => Promise<Ack<T>>;
  notify: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  /** Host only: re-read settings, network adapters and firewall status. */
  refreshHostInfo: () => void;
}

const Ctx = createContext<KaraokeCtx | null>(null);

export function useKaraoke(): KaraokeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useKaraoke must be used inside <KaraokeProvider>');
  return ctx;
}

let toastSeq = 0;

export function KaraokeProvider({ auth, children }: { auth: { token?: string; nickname?: string }; children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [state, setState] = useState<KaraokeState | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [playlistsVersion, setPlaylistsVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const pushToast = useCallback(
    (toast: Toast) => {
      setToasts((t) => [...t.slice(-4), toast]);
      setTimeout(() => dismissToast(toast.id), toast.kind === 'error' || toast.kind === 'warning' ? 6000 : 3500);
    },
    [dismissToast],
  );
  const notify = useCallback(
    (message: string, kind: Toast['kind'] = 'info') => pushToast({ id: `local-${++toastSeq}`, kind, message }),
    [pushToast],
  );

  useEffect(() => {
    const socket = io({ auth, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      setEverConnected(true);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('hello', (h: { role: Role; version: string }) => {
      setRole(h.role);
      setServerVersion(h.version);
      if (h.role === 'host') {
        socket.emit('cmd', { type: 'settings:get' }, (ack: Ack<HostInfo>) => ack.ok && ack.data && setHostInfo(ack.data));
      }
    });
    socket.on('state', (s: KaraokeState) => {
      setState(s);
      setPlayback(s.playback);
    });
    socket.on('playback', (p: Playback) => setPlayback(p));
    socket.on('settings', (info: HostInfo) => setHostInfo(info));
    socket.on('playlists:changed', () => setPlaylistsVersion((v) => v + 1));
    socket.on('toast', (t: Toast) => pushToast(t));
    return () => {
      socket.close();
      socketRef.current = null;
    };
    // The socket lives for the whole page; auth is fixed at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(<T,>(cmd: CommandInput, timeoutMs = 15_000) => {
    const socket = socketRef.current;
    if (!socket?.connected) return Promise.resolve<Ack<T>>({ ok: false, error: 'Not connected to the karaoke app.' });
    return new Promise<Ack<T>>((resolve) => {
      socket.timeout(timeoutMs).emit('cmd', cmd, (err: Error | null, ack: Ack<T>) => {
        resolve(err ? { ok: false, error: 'The karaoke app did not respond.' } : ack);
      });
    });
  }, []);

  const refreshHostInfo = useCallback(() => {
    void send<HostInfo>({ type: 'settings:get' }).then((ack) => ack.ok && ack.data && setHostInfo(ack.data));
  }, [send]);

  const value = useMemo<KaraokeCtx>(
    () => ({ connected, everConnected, role, serverVersion, state, playback, hostInfo, playlistsVersion, toasts, send, notify, dismissToast, refreshHostInfo }),
    [connected, everConnected, role, serverVersion, state, playback, hostInfo, playlistsVersion, toasts, send, notify, dismissToast, refreshHostInfo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
