import { PLAYLIST_ID_RE } from '../../shared/commands';

export type ParseResult = { ok: true; id: string } | { ok: false; error: string };

const YT_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

/**
 * Accepts youtube.com/playlist?list=…, watch?v=…&list=…, music.youtube.com,
 * youtu.be/…?list=…, or a bare playlist ID.
 */
export function parsePlaylistUrl(input: string): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Paste a YouTube playlist link.' };

  let id: string | null = null;
  if (PLAYLIST_ID_RE.test(text) && !text.includes('.')) {
    id = text;
  } else {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return { ok: false, error: "That doesn't look like a link." };
    }
    if (!YT_HOSTS.test(url.hostname)) return { ok: false, error: 'That is not a YouTube link.' };
    id = url.searchParams.get('list');
    if (!id) return { ok: false, error: 'That link has no playlist in it (no "list=" part).' };
  }

  if (/^(RD|UL|LL$|WL$)/.test(id)) {
    return { ok: false, error: "Auto-generated Mix, Liked and Watch Later lists can't be used. Save the songs to a normal playlist first." };
  }
  if (!PLAYLIST_ID_RE.test(id)) return { ok: false, error: 'That playlist ID looks invalid.' };
  return { ok: true, id };
}
