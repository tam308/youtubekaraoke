import { useEffect, useState } from 'react';
import { playerStore } from './playerStore';

/** Shown while YouTube's own controls are on: the way out, and how long until they switch off. */
export function YtControlsDone() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((playerStore.ytControlsUntil - now) / 1000));
  return (
    <button className="po-yt-done" onClick={() => playerStore.setYtControls(false)}>
      Using YouTube's controls ({left}s). Click here when done.
    </button>
  );
}
