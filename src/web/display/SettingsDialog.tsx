import { useEffect } from 'react';
import type { BrowserChoice, Settings } from '../../shared/types';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { Modal } from './Modal';
import { FirewallStatus, NetworkPicker, SecurityHelp } from './NetworkHelp';

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Pause / resume'],
  ['N', 'Skip to the next song'],
  ['M', 'Switch between Party and Local mode'],
  ['Q', 'Show the QR code (Party mode)'],
  ['Tab', 'Hide / show the control pane (Local mode)'],
  ['F', 'Toggle fullscreen'],
  ['S', 'Settings'],
  ['Esc', 'Close dialogs'],
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { hostInfo, send, notify, state, refreshHostInfo } = useKaraoke();
  useEffect(() => refreshHostInfo(), [refreshHostInfo]);
  if (!hostInfo) return null;
  const s = hostInfo.settings;

  async function update(patch: Partial<Settings>) {
    const ack = await send({ type: 'settings:update', patch });
    if (!ack.ok) notify(ack.error, 'error');
  }

  return (
    <Modal onClose={onClose} className="settings-modal">
      <h2>Settings</h2>

      <h3>Display window</h3>
      <label className="field">
        <span>Browser used for this window</span>
        <select value={s.browser} onChange={(e) => update({ browser: e.target.value as BrowserChoice })}>
          <option value="auto">Automatic (your default browser if possible)</option>
          <option value="chrome">Google Chrome</option>
          <option value="edge">Microsoft Edge</option>
          <option value="brave">Brave</option>
          <option value="default">Default browser as a normal tab</option>
        </select>
      </label>
      <p className="hint">
        Currently using <strong>{hostInfo.browser?.name ?? 'unknown'}</strong>
        {hostInfo.browser?.appMode ? ' in app mode' : ''}. Changes apply the next time you start the app. Your browser's extensions (such as an ad
        blocker) also work in this window.
      </p>

      <h3>Party mode network</h3>
      <FirewallStatus />
      <NetworkPicker />
      {hostInfo.adapters.length === 0 && <p className="hint error-text">No Wi-Fi or Ethernet connection found.</p>}
      <label className="field">
        <span>Port</span>
        <input
          type="number"
          min={1024}
          max={65535}
          defaultValue={s.lanPort}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isInteger(v) && v >= 1024 && v <= 65535 && v !== s.lanPort) void update({ lanPort: v });
          }}
        />
      </label>
      {state?.joinUrl && (
        <p className="hint">
          Phones join at <strong>{state.joinUrl}</strong>
        </p>
      )}
      <details className="help">
        <summary>Phones can't connect?</summary>
        <SecurityHelp />
        <p className="hint">
          Also check the phone is on the same Wi-Fi or hotspot as this PC, pick the right network above if this PC has several, and turn off VPNs.
        </p>
      </details>

      <h3>Playback</h3>
      <label className="field">
        <span>Songs that can't play inside the app</span>
        <select value={s.blockedSongs} onChange={(e) => update({ blockedSongs: e.target.value as 'popup' | 'skip' })}>
          <option value="popup">Play them in a YouTube pop-up window</option>
          <option value="skip">Skip them</option>
        </select>
      </label>
      <p className="hint">
        About 1 in 4 popular songs (often major-label music) can't be played inside other apps because of the owner's settings. Every song is tried
        inside the app first; if YouTube refuses, it opens on youtube.com in a fullscreen window that closes when the song ends. If you pause it,
        press +30 seconds so it doesn't close early.
      </p>
      <label className="field">
        <span>Hide YouTube's end-of-video suggestions</span>
        <select value={s.endCurtainSec} onChange={(e) => update({ endCurtainSec: Number(e.target.value) })}>
          <option value={0}>Off (show the whole video)</option>
          <option value={5}>Cover the last 5 seconds</option>
          <option value={10}>Cover the last 10 seconds</option>
          <option value={15}>Cover the last 15 seconds</option>
          <option value={20}>Cover the last 20 seconds</option>
        </select>
      </label>
      <p className="hint">
        Near the end of a song, the video is covered by an "Up next" card so YouTube's suggestion pop-ups don't show. The music keeps playing
        underneath. To change the video quality, use the gear button on YouTube's control bar (in Party mode, open the menu and choose Change YouTube video settings first).
      </p>

      <h3>Party screen</h3>
      <label className="check">
        <input type="checkbox" checked={s.showCornerQr} onChange={(e) => update({ showCornerQr: e.target.checked })} />
        Show a small QR code in the corner
      </label>
      <label className="check">
        <input type="checkbox" checked={s.showUpNext} onChange={(e) => update({ showUpNext: e.target.checked })} />
        Show "Up next" at the bottom
      </label>

      <h3>About</h3>
      <p className="hint">
        Version {hostInfo.version}
      </p>
      <p className="hint">
        Your queue, settings and playlists are saved in <code>{hostInfo.dataDir}</code>
      </p>

      <h3>Keyboard shortcuts</h3>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
