import { useState, type FormEvent } from 'react';
import type { Video } from '../../shared/types';
import { searchVideos, videoPayload } from './api';
import { useKaraoke } from './KaraokeContext';
import { VideoRow } from './VideoRow';

function loadKaraokeOnly(): boolean {
  try {
    return localStorage.getItem('karaokeOnly') === '1';
  } catch {
    return false;
  }
}

export function SearchPanel({ autoFocus }: { autoFocus?: boolean }) {
  const { send, notify } = useKaraoke();
  const [query, setQuery] = useState('');
  const [karaokeOnly, setKaraokeOnly] = useState(loadKaraokeOnly);
  const [results, setResults] = useState<Video[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, true>>({});


  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchVideos(q, karaokeOnly);
      setResults(res.results);
      setAdded({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggleKaraoke() {
    const next = !karaokeOnly;
    setKaraokeOnly(next);
    try {
      localStorage.setItem('karaokeOnly', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  async function add(v: Video, position: 'end' | 'next') {
    const ack = await send({ type: 'queue:add', video: videoPayload(v), position });
    if (ack.ok) {
      setAdded((a) => ({ ...a, [v.videoId]: true }));
      notify(position === 'next' ? `Playing next: ${v.title}` : `Added: ${v.title}`, 'success');
    } else notify(ack.error, 'error');
  }

  return (
    <div className="panel search-panel">
      <form className="search-form" onSubmit={onSubmit}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube for a song…"
          autoFocus={autoFocus}
          enterKeyHint="search"
          maxLength={200}
        />
        <button type="submit" className="btn primary" disabled={loading || !query.trim()}>
          {loading ? '…' : 'Search'}
        </button>
      </form>
      <label className="toggle-chip">
        <input type="checkbox" checked={karaokeOnly} onChange={toggleKaraoke} />
        <span>Karaoke versions only</span>
      </label>

      <div className="list-scroll">
        {error && <div className="empty error-text">{error}</div>}
        {!error && results === null && !loading && (
          <div className="empty">Search for any song. Karaoke versions with on-screen lyrics work best.</div>
        )}
        {!error && results?.length === 0 && <div className="empty">No results. Try different words.</div>}
        {results?.map((v) => (
            <VideoRow
              key={v.videoId}
              video={v}
              actions={
                added[v.videoId] ? (
                  <span className="added-badge">Added</span>
                ) : (
                  <>
                    <button className="btn small primary" onClick={() => add(v, 'end')} title="Add to the end of the queue">
                      + Add
                    </button>
                    <button className="btn small ghost" onClick={() => add(v, 'next')} title="Play this next">
                      Next
                    </button>
                  </>
                )
              }
            />
          ))}
      </div>
    </div>
  );
}
