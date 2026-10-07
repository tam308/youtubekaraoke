import { useEffect, useState } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';

const STEP = 10;

/** Phone tab: change the main screen's volume. */
export function VolumePanel() {
  const { state, send, notify } = useKaraoke();
  const serverVolume = state?.volume ?? 80;
  const [volume, setVolume] = useState(serverVolume);
  useEffect(() => setVolume(serverVolume), [serverVolume]);

  async function apply(v: number) {
    const next = Math.max(0, Math.min(100, Math.round(v)));
    setVolume(next);
    const ack = await send({ type: 'volume:set', volume: next });
    if (!ack.ok) notify(ack.error, 'error');
  }

  return (
    <div className="panel volume-panel">
      <div className="vol-value">{volume}%</div>
      <div className="vol-buttons">
        <button className="btn vol-btn" onClick={() => apply(volume - STEP)} disabled={volume <= 0}>
          Vol -
        </button>
        <button className="btn vol-btn" onClick={() => apply(volume + STEP)} disabled={volume >= 100}>
          Vol +
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        onPointerUp={(e) => apply(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => apply(Number((e.target as HTMLInputElement).value))}
        aria-label="Volume"
      />
      <p className="muted vol-hint">
        Changes the volume of the music on the main screen.
        {state?.popup ? ' The current song is playing in a YouTube window, so its volume is set there.' : ''}
      </p>
    </div>
  );
}
