import { useEffect, useState } from 'react';

declare const __APP_VERSION__: string;

export const SPLASH_MS = 1000;

/** Purely visual start-up screen: logo + 1-second loading bar, then fades away. */
export function Splash() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), SPLASH_MS);
    const remove = setTimeout(() => setGone(true), SPLASH_MS + 300);
    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, []);

  if (gone) return null;
  return (
    <div className={`splash${leaving ? ' leaving' : ''}`} aria-hidden={leaving}>
      <img className="splash-logo" src="/icon-192.png" alt="" />
      <h1>Starting YouTube Karaoke</h1>
      <div className="splash-bar">
        <div className="splash-bar-fill" style={{ animationDuration: `${SPLASH_MS}ms` }} />
      </div>
      <p className="splash-version">v{__APP_VERSION__}</p>
    </div>
  );
}
