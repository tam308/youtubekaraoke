import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.ERROR);

let instance: Promise<Innertube> | null = null;

/** Shared InnerTube session (no API key, no login). Recreated after a failure. */
export function getInnertube(): Promise<Innertube> {
  instance ??= Innertube.create({ retrieve_player: false, lang: 'en' }).catch((err) => {
    instance = null;
    throw err;
  });
  return instance;
}

export function resetInnertube(): void {
  instance = null;
}
