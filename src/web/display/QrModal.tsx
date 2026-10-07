import { useEffect } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { Modal } from './Modal';
import { FirewallStatus, NetworkPicker, SecurityHelp } from './NetworkHelp';

export function QrImage({ size }: { size: number }) {
  const { state } = useKaraoke();
  if (!state?.joinUrl) return null;
  return (
    <img
      className="qr-img"
      src={`/api/qr.svg?u=${encodeURIComponent(state.joinUrl)}`}
      width={size}
      height={size}
      alt={`QR code for ${state.joinUrl}`}
    />
  );
}

export function QrModal({ onClose }: { onClose: () => void }) {
  const { state, refreshHostInfo } = useKaraoke();
  // Refresh adapters + firewall status each time the QR is shown.
  useEffect(() => refreshHostInfo(), [refreshHostInfo]);

  return (
    <Modal onClose={onClose} className="qr-modal">
      <h2>Scan to add songs</h2>
      {state?.joinUrl ? (
        <>
          <QrImage size={300} />
          <p className="join-url">{state.joinUrl}</p>
          <p className="muted">Phones must be on the same network as this PC (the same Wi-Fi or hotspot). No app or account needed.</p>
          <div className="qr-help">
            <FirewallStatus />
            <NetworkPicker />
            <ConnectHelp joinUrl={state.joinUrl} />
          </div>
        </>
      ) : (
        <p className="muted">Party mode is off. Switch to Party mode to let phones join.</p>
      )}
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/** Why a phone may fail to connect: firewall/antivirus first (the usual cause), then network. */
function ConnectHelp({ joinUrl }: { joinUrl: string }) {
  const { hostInfo } = useKaraoke();
  const port = new URL(joinUrl).port;
  const others = (hostInfo?.adapters ?? []).filter((a) => !joinUrl.includes(`//${a.address}:`));
  return (
    <details className="help" open={false}>
      <summary>Phone can't connect?</summary>
      <h4>1. Firewall or antivirus (most common)</h4>
      <p>
        The page loading forever on the phone almost always means a firewall on this PC is blocking it. There is no way for an app to switch this
        off by itself; it has to be allowed once on each PC.
      </p>
      <SecurityHelp />
      <h4>2. Network</h4>
      <ul>
        <li>The phone must be on the same Wi-Fi or hotspot as this PC. Mobile data won't work.</li>
        <li>
          Try one of this PC's other addresses in the phone's browser:
          {others.length === 0 ? (
            <span className="muted"> (this PC has no other network addresses)</span>
          ) : (
            others.map((a) => (
              <div key={a.address}>
                <code>
                  http://{a.address}:{port}/
                </code>{' '}
                <span className="muted">({a.name})</span>
              </div>
            ))
          )}
        </li>
        <li>
          School, office, hotel and cafe Wi-Fi often blocks devices from talking to each other. Use a phone hotspot (connect this PC to it), or turn on
          this computer's own hotspot (Windows: Mobile hotspot; Mac: Internet Sharing) and connect the phones to that. The QR code switches
          automatically.
        </li>
        <li>Turn off any VPN on this PC or the phone.</li>
      </ul>
    </details>
  );
}
