import { VIDEO_ID_RE, thumbnailFor } from '../../shared/commands';
import type { Video } from '../../shared/types';

/** "1:02:03" / "4:10" -> seconds. Returns 0 for anything unparsable. */
export function parseDuration(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const parts = text.trim().split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Best-effort text from a string, youtubei.js Text object, or raw `{runs}` / `{simpleText}`. */
export function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.simpleText === 'string') return o.simpleText;
    if (Array.isArray(o.runs)) return o.runs.map((r) => str(r)).join('');
    if (typeof o.toString === 'function' && o.toString !== Object.prototype.toString) return String(o);
  }
  return '';
}

function makeVideo(videoId: unknown, title: unknown, channel: unknown, durationSec: number): Video | null {
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) return null;
  const t = str(title).trim();
  if (!t) return null;
  return {
    videoId,
    title: t,
    channel: str(channel).trim(),
    durationSec: Number.isFinite(durationSec) ? Math.max(0, Math.round(durationSec)) : 0,
    thumbnailUrl: thumbnailFor(videoId),
  };
}

/**
 * Map a youtubei.js node (search `Video`, playlist `PlaylistVideo`, or the newer
 * `LockupView`) to our Video shape. Defensive on purpose: YouTube changes these often.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapYoutubeiNode(node: any): Video | null {
  if (!node || typeof node !== 'object') return null;
  switch (node.type) {
    case 'Video':
    case 'CompactVideo':
    case 'PlaylistVideo':
    case 'GridVideo': {
      if (node.is_live || node.is_upcoming || node.upcoming) return null;
      if (node.is_playable === false) return null;
      const seconds = node.duration?.seconds ?? parseDuration(str(node.duration?.text ?? node.length_text));
      return makeVideo(node.video_id ?? node.id, node.title, node.author?.name, seconds);
    }
    case 'LockupView': {
      if (node.content_type && node.content_type !== 'VIDEO') return null;
      const meta = node.metadata;
      const channel = meta?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text;
      let seconds = 0;
      for (const overlay of node.content_image?.overlays ?? []) {
        for (const badge of overlay?.badges ?? []) {
          const s = parseDuration(badge?.text);
          if (s > 0) seconds = s;
        }
      }
      return makeVideo(node.content_id, meta?.title, channel, seconds);
    }
    default:
      return null;
  }
}

/** Walk raw `ytInitialData` JSON and collect video renderers (results page / playlist page fallback). */
export function collectRenderers(root: unknown, kinds: string[]): Video[] {
  const out: Video[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      continue;
    }
    const obj = cur as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const kind of kinds) {
      const r = obj[kind];
      if (r && typeof r === 'object') {
        const v = rendererToVideo(r);
        if (v && !seen.has(v.videoId)) {
          seen.add(v.videoId);
          out.push(v);
        }
      }
    }
    for (const key of Object.keys(obj)) {
      if (!kinds.includes(key)) stack.push(obj[key]);
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rendererToVideo(r: any): Video | null {
  const isLive = (r.badges ?? []).some((b: any) => /LIVE/.test(b?.metadataBadgeRenderer?.style ?? '')); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (isLive) return null;
  const seconds = r.lengthSeconds ? Number(r.lengthSeconds) : parseDuration(str(r.lengthText));
  return makeVideo(r.videoId, r.title, r.ownerText ?? r.shortBylineText ?? r.longBylineText, seconds);
}

/** Extract the `ytInitialData` JSON object embedded in a youtube.com HTML page. */
export function extractInitialData(html: string): unknown {
  const marker = html.search(/(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*\{/);
  if (marker === -1) throw new Error('ytInitialData not found');
  const start = html.indexOf('{', marker);
  // Find the matching closing brace, respecting strings.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('ytInitialData is truncated');
}

export async function fetchYoutubeHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      // Skip the EU consent interstitial.
      Cookie: 'CONSENT=YES+1; SOCS=CAI',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`YouTube responded ${res.status}`);
  return res.text();
}
