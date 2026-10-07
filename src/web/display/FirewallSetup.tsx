import { useState } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { Modal } from './Modal';

/**
 * Shown when Party mode is switched on and Windows Firewall would block phones.
 * Adding our rule *before* the party port opens also stops Windows showing its own
 * "allow access" prompt, whose defaults often create Block rules for Public networks.
 */
export function FirewallSetup({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { send, notify } = useKaraoke();
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    const ack = await send({ type: 'firewall:allow' }, 130_000);
    setBusy(false);
    if (!ack.ok) notify(ack.error, 'warning');
    onDone();
  }

  return (
    <Modal onClose={onCancel}>
      <h2>Let phones connect</h2>
      <p>
        Windows Firewall blocks phones from reaching this PC on hotspots and most Wi-Fi networks. Click <strong>Allow phones</strong>, then{' '}
        <strong>Yes</strong> when Windows asks for permission. You only need to do this once.
      </p>
      <p className="hint">The rule only covers YouTube Karaoke, its party ports, and devices on your local network.</p>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onDone} disabled={busy}>
          Skip
        </button>
        <button className="btn primary" onClick={allow} disabled={busy} autoFocus>
          {busy ? 'Waiting for Windows...' : 'Allow phones'}
        </button>
      </div>
    </Modal>
  );
}
