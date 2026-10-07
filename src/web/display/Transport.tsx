import { useEffect, useState } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { playerStore, usePaused } from './playerStore';

/** Pause/resume + volume (host only; these act on the local player). */
export function Transport() {
  const { send, hostInfo, state } = useKaraoke();
  const paused = usePaused();
  const saved = hostInfo?.settings.volume ?? 80;
  const [volume, setVolume] = useState(saved);
  useEffect(() => setVolume(saved), [saved]);

  // Save the volume shortly after the slider stops moving.
  useEffect(() => {
    if (volume === saved) return;
    const t = setTimeout(() => void send({ type: 'settings:update', patch: { volume } }), 300);
    return () => clearTimeout(t);
  }, [volume, saved, send]);

  return (
    <div className="transport">
      <button className="btn small" onClick={() => playerStore.togglePause()} disabled={!state?.nowPlaying} title="Pause / resume (Space)">
        {paused ? 'Play' : 'Pause'}
      </button>
      <label className="volume" title="Volume">
        <span>Volume</span>
        <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
      </label>
    </div>
  );
}
