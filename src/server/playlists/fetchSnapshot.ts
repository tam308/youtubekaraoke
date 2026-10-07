/**
 * Build-time script (run by build.py): fetches the built-in playlists and writes
 * a snapshot JSON that gets embedded in the exe, so presets work offline on first launch.
 *
 *   node out/fetch-playlists.cjs <output.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PLAYLISTS, withFixedName } from '../../shared/constants';
import { fetchPlaylist, type FetchedPlaylist } from '../youtube/fetchPlaylist';
import type { PlaylistSnapshot } from './PlaylistService';

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('usage: fetch-playlists <output.json>');

  const playlists: FetchedPlaylist[] = [];
  let failed = 0;
  for (const { id } of DEFAULT_PLAYLISTS) {
    try {
      const p = withFixedName(await fetchPlaylist(id));
      playlists.push(p);
      console.log(`  ${id}: "${p.title}", ${p.items.length} songs`);
    } catch (err) {
      failed++;
      console.warn(`  ${id}: FAILED (${(err as Error).message})`);
    }
  }
  const snapshot: PlaylistSnapshot = { generatedAt: Date.now(), playlists };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot));
  if (failed > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
