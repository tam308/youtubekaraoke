import { useKaraoke } from './KaraokeContext';
import { formatDuration } from './format';
import { ConfirmButton } from './QueueList';

export function ProgressBar({ position, duration }: { position: number; duration: number }) {
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={position}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Compact "now playing" card with a skip button (two taps, so nobody skips by accident). */
export function NowPlaying({ extraControls }: { extraControls?: React.ReactNode }) {
  const { state, playback, send, notify } = useKaraoke();
  const np = state?.nowPlaying;

  if (!np) {
    return (
      <div className="now-playing idle">
        <div className="np-label">Nothing playing</div>
        <div className="np-hint">Add a song to get started.</div>
      </div>
    );
  }

  const pos = playback?.itemId === np.id ? playback.positionSec : 0;
  const inPopup = state?.popup?.itemId === np.id;

  async function skip() {
    const ack = await send({ type: 'player:skip' });
    if (!ack.ok) notify(ack.error, 'error');
  }

  return (
    <div className="now-playing">
      <img className="np-thumb" src={np.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
      <div className="np-info">
        <div className="np-label">
          Queued by <span className="singer">{np.addedBy}</span>
          {inPopup && <span className="tag">Playing in a YouTube window</span>}
        </div>
        <div className="np-title" title={np.title}>
          {np.title}
        </div>
        <div className="np-time">
          <ProgressBar position={pos} duration={np.durationSec} />
          <span>
            {formatDuration(pos) || '0:00'} / {formatDuration(np.durationSec)}
          </span>
        </div>
      </div>
      <div className="np-controls">
        {extraControls}
        {inPopup && (
          <button className="btn small" onClick={() => void send({ type: 'popup:extend' })} title="Paused it? Add more time before the YouTube window closes">
            +30s
          </button>
        )}
        <ConfirmButton className="btn small" confirmLabel="Skip?" onConfirm={skip} title="Skip this song">
          Skip
        </ConfirmButton>
      </div>
    </div>
  );
}
