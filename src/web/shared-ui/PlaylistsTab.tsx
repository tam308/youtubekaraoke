import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LIMITS } from '../../shared/constants';
import type { PlaylistDetail, PlaylistSummary, Video } from '../../shared/types';
import { getPlaylist, getPlaylists, videoPayload } from './api';
import { chunk, playlistName, shuffle } from './format';
import { useKaraoke } from './KaraokeContext';
import { VideoRow } from './VideoRow';

export function usePlaylists() {
  const { playlistsVersion } = useKaraoke();
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPlaylists()
      .then((p) => !cancelled && (setPlaylists(p), setError(null)))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [playlistsVersion]);

  return { playlists, error };
}

/**
 * Preset playlists. `managePanel` (host only) is rendered above the list
 * for pasting links / renaming / removing.
 */
export function PlaylistsTab({ managePanel }: { managePanel?: ReactNode }) {
  const { playlists, error } = usePlaylists();
  const [openId, setOpenId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  if (openId) return <PlaylistBrowser id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="panel playlists-panel">
      {managePanel && (
        <div className="panel-header">
          <span>Preset playlists</span>
          <button className="btn small ghost" onClick={() => setManaging((m) => !m)}>
            {managing ? 'Done' : 'Manage'}
          </button>
        </div>
      )}
      {managing && managePanel}
      <div className="list-scroll">
        {error && <div className="empty error-text">{error}</div>}
        {playlists?.length === 0 && (
          <div className="empty">No playlists yet.{managePanel ? ' Press Manage to paste a YouTube playlist link.' : ''}</div>
        )}
        {!managing &&
          playlists?.map((p) => (
            <button key={p.id} className="playlist-card" onClick={() => setOpenId(p.id)}>
              <div className="pl-info">
                <div className="pl-name">{playlistName(p)}</div>
                <div className="pl-sub">
                  {p.loading && p.itemCount === 0 ? 'Loading…' : `${p.itemCount} songs`}
                  {p.builtIn && <span className="tag">Built-in</span>}
                  {p.error && <span className="tag warn">Offline copy</span>}
                </div>
              </div>
              <span className="chev">›</span>
            </button>
          ))}
      </div>
    </div>
  );
}

function PlaylistBrowser({ id, onBack }: { id: string; onBack: () => void }) {
  const { send, notify, playlistsVersion } = useKaraoke();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getPlaylist(id)
      .then((d) => !cancelled && (setDetail(d), setError(null)))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, playlistsVersion]);

  const items = useMemo(() => {
    const all = detail?.items ?? [];
    const f = filter.trim().toLowerCase();
    return f ? all.filter((v) => v.title.toLowerCase().includes(f) || v.channel.toLowerCase().includes(f)) : all;
  }, [detail, filter]);
  const playable = useMemo(() => detail?.items ?? [], [detail]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  async function addVideos(videos: Video[], position: 'end' | 'next', label: string) {
    if (videos.length === 0) return;
    setBusy(true);
    try {
      let added = 0;
      for (const part of chunk(videos, LIMITS.maxAddMany)) {
        const ack = await send<{ added: number }>({ type: 'queue:addMany', videos: part.map(videoPayload), position });
        if (!ack.ok) {
          notify(ack.error, 'error');
          break;
        }
        added += ack.data?.added ?? part.length;
      }
      if (added) notify(label.replace('{n}', String(added)), 'success');
    } finally {
      setBusy(false);
    }
  }

  function toggle(videoId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  async function addSelected() {
    const videos = (detail?.items ?? []).filter((v) => selected.has(v.videoId));
    await addVideos(videos, 'end', 'Added {n} songs');
    setSelected(new Set());
    setSelecting(false);
  }

  return (
    <div className="panel playlist-browser">
      <div className="panel-header">
        <button className="btn small ghost" onClick={onBack}>
          ‹ Back
        </button>
        <span className="pl-title" title={detail ? playlistName(detail) : ''}>
          {detail ? playlistName(detail) : 'Loading…'}
        </span>
        <span className="muted">{detail ? `${detail.items.length}` : ''}</span>
      </div>

      {detail?.loading && detail.items.length === 0 && <div className="empty">Loading songs from YouTube…</div>}
      {error && <div className="empty error-text">{error}</div>}
      {detail?.error && detail.items.length === 0 && <div className="empty error-text">{detail.error}</div>}

      {detail && detail.items.length > 0 && (
        <>
          <div className="pl-toolbar">
            <input type="search" placeholder="Filter songs…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className={`btn small${selecting ? ' primary' : ' ghost'}`} onClick={() => (setSelecting(!selecting), setSelected(new Set()))}>
              {selecting ? 'Cancel' : 'Select'}
            </button>
          </div>
          <div className="pl-quick">
            <button className="btn small" disabled={busy} onClick={() => addVideos(shuffle(playable).slice(0, 1), 'next', 'Surprise! Playing a random song next')}>
              Random song next
            </button>
            <button className="btn small" disabled={busy} onClick={() => addVideos(shuffle(playable).slice(0, 5), 'end', 'Added {n} random songs')}>
              + 5 random
            </button>
          </div>

          <div className="list-scroll" ref={scrollRef}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const v = items[row.index]!;
                const isSel = selected.has(v.videoId);
                return (
                  <div
                    key={v.videoId}
                    data-index={row.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${row.start}px)` }}
                  >
                    <VideoRow
                      video={v}
                      onClick={selecting ? () => toggle(v.videoId) : undefined}
                      leading={selecting ? <input type="checkbox" className="row-check" checked={isSel} readOnly /> : undefined}
                      actions={
                        selecting ? undefined : (
                          <>
                            <button className="btn small primary" disabled={busy} onClick={() => addVideos([v], 'end', `Added: ${v.title}`)}>
                              + Add
                            </button>
                            <button className="btn small ghost" disabled={busy} onClick={() => addVideos([v], 'next', `Playing next: ${v.title}`)}>
                              Next
                            </button>
                          </>
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
            {items.length === 0 && <div className="empty">No songs match "{filter}".</div>}
          </div>

          {selecting && (
            <div className="selection-bar">
              <span>{selected.size} selected</span>
              <button className="btn primary" disabled={busy || selected.size === 0} onClick={addSelected}>
                Add selected
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
