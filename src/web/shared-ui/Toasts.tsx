import { useKaraoke } from './KaraokeContext';

export function Toasts() {
  const { toasts, dismissToast } = useKaraoke();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/** Banner shown while the socket is down (e.g. the host switched to local mode). */
export function ConnectionBanner({ guestHint }: { guestHint?: boolean }) {
  const { connected, everConnected } = useKaraoke();
  if (connected) return null;
  if (!everConnected) {
    return (
      <div className="conn-banner">
        <strong>Connecting to the karaoke app...</strong>
      </div>
    );
  }
  return (
    <div className="conn-banner">
      <strong>Disconnected.</strong>
      {guestHint ? <span> Please refresh this page once Party mode is turned back on.</span> : <span> Reconnecting...</span>}
      {guestHint && (
        <button className="btn small" onClick={() => window.location.reload()}>
          Refresh
        </button>
      )}
    </div>
  );
}
