import { useCallback, useEffect, useRef, useState } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { NowPlaying } from '../shared-ui/NowPlaying';
import { ConfirmButton } from '../shared-ui/QueueList';
import { SongBrowser } from '../shared-ui/SongBrowser';
import type { DisplayActions } from './App';
import { PlaylistManager } from './PlaylistManager';
import { playerStore, useYtControls } from './playerStore';
import { QrImage } from './QrModal';
import { YtControlsDone } from './YtControlsDone';
import { Transport } from './Transport';

const HIDE_AFTER_MS = 3000;

/**
 * Party-mode UI over the fullscreen video. Everything lives behind one menu button in the
 * top-left corner, so the video stays clear.
 *
 * A transparent "activity layer" covers the whole iframe (iframes swallow mouse events), so
 * moving the mouse reveals the menu button; it fades after 3 s. The menu item "Change YouTube
 * video settings" switches YouTube's own controls on and the layer off, so the gear menu etc.
 * can be used; after 10 s (or "Click here when done") both switch back, whatever happens.
 * Nothing here ever pauses or reloads the player.
 */
export function PartyOverlay({ actions, drawerOpen, setDrawerOpen }: { actions: DisplayActions; drawerOpen: boolean; setDrawerOpen: (v: boolean) => void }) {
  const { state, hostInfo } = useKaraoke();
  const [visible, setVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const ytMode = useYtControls();
  const hoveringRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poke = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!hoveringRef.current) setVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    poke();
    window.addEventListener('keydown', poke);
    return () => {
      window.removeEventListener('keydown', poke);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poke]);

  const showUi = !ytMode && (visible || drawerOpen || menuOpen);
  const next = state?.queue[0];
  const settings = hostInfo?.settings;
  const hover = {
    onMouseEnter: () => (hoveringRef.current = true),
    onMouseLeave: () => {
      hoveringRef.current = false;
      poke();
    },
  };
  const pick = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div className={`party-overlay${showUi ? ' ui-visible' : ''}`}>
      <div
        className={`activity-layer${ytMode ? ' pass-through' : ''}`}
        onMouseMove={poke}
        onClick={() => {
          setMenuOpen(false);
          poke();
        }}
        onDoubleClick={actions.toggleFullscreen}
      />

      <button
        className={`po-burger fade${menuOpen ? ' open' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Menu"
        aria-expanded={menuOpen}
        title="Menu"
        {...hover}
      >
        <span />
        <span />
        <span />
      </button>

      {ytMode && <YtControlsDone />}

      {menuOpen && !ytMode && (
        <div className="po-menu" role="menu" {...hover}>
          <div className="brand">
            <img className="brand-icon" src="/icon-32.png" alt="" /> YouTube Karaoke <span className="tag">Party mode</span>
          </div>
          <NowPlaying extraControls={<Transport />} />
          <div className="po-menu-items">
            <button className="btn primary" onClick={pick(() => setDrawerOpen(!drawerOpen))}>
              Songs
            </button>
            <button className="btn" onClick={pick(actions.openQr)} title="Show QR code (Q)">
              QR code
            </button>
            <button className="btn" onClick={pick(actions.openSettings)} title="Settings (S)">
              Settings
            </button>
            <button className="btn" onClick={pick(() => playerStore.setYtControls(true))} title="Use YouTube's own player controls, e.g. to change the video quality">
              Change YouTube video settings
            </button>
            <button className="btn" onClick={pick(() => actions.setMode('local'))} title="Switch to Local mode (M)">
              Local mode
            </button>
            <ConfirmButton className="btn" confirmLabel="Exit app?" onConfirm={actions.exitApp} title="Close the karaoke app">
              Exit
            </ConfirmButton>
          </div>
        </div>
      )}

      {/* Always-visible helpers (configurable in Settings); hidden while YouTube's controls are in use. */}
      {settings?.showUpNext && next && !showUi && !ytMode && (
        <div className="po-upnext">
          <span className="uns-label">Up next</span> {next.title} <span className="singer">{next.addedBy}</span>
        </div>
      )}
      {settings?.showCornerQr && state?.joinUrl && !drawerOpen && !ytMode && (
        <div className="po-corner-qr" onClick={actions.openQr}>
          <QrImage size={120} />
          <span>Scan to add songs</span>
        </div>
      )}

      <aside className={`po-drawer${drawerOpen ? ' open' : ''}`} {...hover}>
        <div className="po-drawer-header">
          <strong>Songs</strong>
          <button className="btn small icon ghost" onClick={() => setDrawerOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        {drawerOpen && <SongBrowser managePanel={<PlaylistManager />} />}
      </aside>
    </div>
  );
}
