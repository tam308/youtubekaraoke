import { useEffect, useState } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { formatDuration } from '../shared-ui/format';

/** Shown over the player while a blocked song plays in a youtube.com pop-up window. */
export function PopupNotice() {
  const { state, send, notify } = useKaraoke();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const np = state?.nowPlaying;
  const popup = state?.popup;
  if (!np) return null;
  const left = popup ? Math.max(0, Math.round((popup.endsAt - now) / 1000)) : null;

  async function run(cmd: Parameters<typeof send>[0]) {
    const ack = await send(cmd);
    if (!ack.ok) notify(ack.error, 'error');
  }

  return (
    <div className="popup-notice">
      <div className="pn-card">
        <img src={np.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
        <h2>Playing on YouTube</h2>
        <div className="pn-title">{np.title}</div>
        <p className="muted">
          The owner of this video doesn't allow it to play inside other apps, so it's playing in a YouTube window instead. The window closes by itself
          when the song ends.
        </p>
        {popup && !popup.windowFound && <p className="hint">Opening the YouTube window...</p>}
        {left !== null && <div className="pn-countdown">Closes in {formatDuration(left) || '0:00'}</div>}
        <div className="pn-actions">
          <button className="btn" onClick={() => run({ type: 'popup:extend' })} title="Paused it? Add more time before it closes">
            +30 seconds
          </button>
          <button className="btn primary" onClick={() => run({ type: 'player:skip' })}>
            Next song
          </button>
        </div>
      </div>
    </div>
  );
}
