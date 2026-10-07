import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { HostInfo, Mode } from '../../shared/types';
import { isTypingTarget } from '../shared-ui/format';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { ConnectionBanner, Toasts } from '../shared-ui/Toasts';
import { ControlPane } from './ControlPane';
import { FirewallSetup } from './FirewallSetup';
import { PartyOverlay } from './PartyOverlay';
import { Player } from './Player';
import { playerStore } from './playerStore';
import { QrModal } from './QrModal';
import { SettingsDialog } from './SettingsDialog';
import { Splitter } from './Splitter';
import { Splash } from './Splash';
import { UpNextStrip } from './UpNextStrip';

export interface DisplayActions {
  setMode: (mode: Mode) => void;
  openQr: () => void;
  openSettings: () => void;
  toggleCollapsed: () => void;
  toggleFullscreen: () => void;
  exitApp: () => void;
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

export function DisplayApp() {
  const { state, role, hostInfo, send, notify, connected } = useKaraoke();
  const [qrOpen, setQrOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [firewallPending, setFirewallPending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exited, setExited] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const mode = state?.mode ?? 'local';
  const settings = hostInfo?.settings;
  const collapsed = settings?.controlPaneCollapsed ?? false;
  const ratio = dragRatio ?? settings?.splitRatio ?? 1 / 3;
  const showPane = mode === 'local' && !collapsed;

  const doSetMode = useCallback(
    async (target: Mode) => {
      const ack = await send({ type: 'mode:set', mode: target }, 20_000);
      if (!ack.ok) notify(ack.error, 'error');
      else if (target === 'party') {
        setQrOpen(true);
        setDrawerOpen(false);
      }
    },
    [send, notify],
  );

  const actions: DisplayActions = {
    setMode: (target) => {
      if (target !== 'party') return void doSetMode(target);
      // Check the firewall first: if phones would be blocked, offer to fix it before the port opens.
      void send<HostInfo>({ type: 'settings:get' }).then((ack) => {
        if (ack.ok && ack.data?.firewallRule === false) setFirewallPending(true);
        else void doSetMode('party');
      });
    },
    openQr: () => setQrOpen(true),
    openSettings: () => setSettingsOpen(true),
    toggleCollapsed: () => void send({ type: 'settings:update', patch: { controlPaneCollapsed: !collapsed } }),
    toggleFullscreen,
    exitApp: () => {
      void send({ type: 'app:exit' });
      setExited(true);
      setTimeout(() => window.close(), 300);
    },
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      if (qrOpen || settingsOpen || firewallPending) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          playerStore.togglePause();
          break;
        case 'n':
        case 'N':
          void send({ type: 'player:skip' });
          break;
        case 'm':
        case 'M':
          actions.setMode(mode === 'party' ? 'local' : 'party');
          break;
        case 'q':
        case 'Q':
          if (mode === 'party') setQrOpen(true);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 's':
        case 'S':
          setSettingsOpen(true);
          break;
        case 'Tab':
          if (mode === 'local') {
            e.preventDefault();
            actions.toggleCollapsed();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (role === 'guest') {
    return (
      <div className="center-screen">
        <h1>This is the main-screen page</h1>
        <p className="muted">Open YouTube Karaoke from the app on your PC. On a phone, scan the QR code instead.</p>
      </div>
    );
  }

  if (exited) {
    return (
      <div className="center-screen">
        <h1>YouTube Karaoke has closed</h1>
        <p className="muted">You can close this window.</p>
      </div>
    );
  }

  // The element order below never changes (null placeholders keep positions), so React never
  // re-creates <main>/<Player> when switching modes, the video keeps playing.
  return (
    <div className={`display mode-${mode}${collapsed ? ' collapsed' : ''}`} style={{ '--ratio': ratio } as CSSProperties}>
      {showPane ? (
        <aside className="control-pane">
          <ControlPane actions={actions} />
        </aside>
      ) : null}
      {showPane ? <Splitter onChange={setDragRatio} onCommit={(r) => void send({ type: 'settings:update', patch: { splitRatio: r } }).then(() => setDragRatio(null))} /> : null}
      <main className="stage">
        <div className="player-box">
          <Player />
        </div>
        {mode === 'local' ? <UpNextStrip /> : null}
        {mode === 'party' ? <PartyOverlay actions={actions} drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} /> : null}
        {mode === 'local' && collapsed ? (
          <button className="expand-pane btn small" onClick={actions.toggleCollapsed} title="Show the control pane (Tab)">
            Show controls
          </button>
        ) : null}
      </main>

      {!connected && (
        <div className="display-banner">
          <ConnectionBanner />
        </div>
      )}
      <Toasts />
      {qrOpen && <QrModal onClose={() => setQrOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {firewallPending && (
        <FirewallSetup
          onCancel={() => setFirewallPending(false)}
          onDone={() => {
            setFirewallPending(false);
            void doSetMode('party');
          }}
        />
      )}
      <Splash />
    </div>
  );
}
