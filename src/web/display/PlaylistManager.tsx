import { useState, type FormEvent } from 'react';
import type { PlaylistPreview } from '../../shared/types';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { usePlaylists } from '../shared-ui/PlaylistsTab';
import { ConfirmButton } from '../shared-ui/QueueList';
import { playlistName } from '../shared-ui/format';

/** Host-only: paste a YouTube playlist link to save it as a preset; rename / refresh / remove presets. */
export function PlaylistManager() {
  const { send, notify } = useKaraoke();
  const { playlists } = usePlaylists();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function onPreview(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    const ack = await send<PlaylistPreview>({ type: 'playlist:preview', url }, 120_000);
    setBusy(false);
    if (ack.ok && ack.data) setPreview(ack.data);
    else if (!ack.ok) setError(ack.error);
  }

  async function onSave() {
    setBusy(true);
    const ack = await send({ type: 'playlist:save', url, customName: name.trim() || null }, 120_000);
    setBusy(false);
    if (ack.ok) {
      notify(`Saved "${name.trim() || preview?.title}"`, 'success');
      setUrl('');
      setName('');
      setPreview(null);
    } else setError(ack.error);
  }

  async function run(cmd: Parameters<typeof send>[0], okMessage?: string) {
    const ack = await send(cmd, 120_000);
    if (!ack.ok) notify(ack.error, 'error');
    else if (okMessage) notify(okMessage, 'success');
  }

  return (
    <div className="playlist-manager">
      <form className="pm-add" onSubmit={onPreview}>
        <input type="text" placeholder="Paste a YouTube playlist link…" value={url} onChange={(e) => (setUrl(e.target.value), setPreview(null))} />
        <button className="btn small primary" disabled={busy || !url.trim()}>
          {busy && !preview ? 'Loading…' : 'Preview'}
        </button>
      </form>
      {error && <p className="hint error-text">{error}</p>}
      {preview && (
        <div className="pm-preview">
          <div>
            <strong>{preview.title}</strong>
            <div className="muted">
              {preview.itemCount} songs{preview.author ? ` · by ${preview.author}` : ''}
            </div>
          </div>
          <input type="text" placeholder="Custom name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          <button className="btn small primary" onClick={onSave} disabled={busy}>
            Save playlist
          </button>
        </div>
      )}

      <div className="pm-list">
        {playlists?.map((p) => (
          <div key={p.id} className="pm-row">
            {editing === p.id ? (
              <form
                className="pm-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run({ type: 'playlist:rename', id: p.id, customName: editName.trim() || null });
                  setEditing(null);
                }}
              >
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={p.title} autoFocus maxLength={100} />
                <button className="btn small primary">Save</button>
              </form>
            ) : (
              <div className="pm-name">
                <strong>{playlistName(p)}</strong>
                <span className="muted">
                  {' '}
                  · {p.itemCount} songs{p.builtIn ? ' · built-in' : ''}
                  {p.loading ? ' · refreshing…' : ''}
                </span>
              </div>
            )}
            <div className="pm-actions">
              <button className="btn small ghost" onClick={() => (setEditing(editing === p.id ? null : p.id), setEditName(p.customName ?? ''))}>
                Rename
              </button>
              <button className="btn small ghost" disabled={p.loading} onClick={() => run({ type: 'playlist:refresh', id: p.id }, 'Playlist refreshed')}>
                Refresh
              </button>
              <ConfirmButton className="btn small danger-ghost" confirmLabel="Remove?" onConfirm={() => run({ type: 'playlist:remove', id: p.id })}>
                Remove
              </ConfirmButton>
            </div>
          </div>
        ))}
      </div>
      <button className="btn small ghost" onClick={() => run({ type: 'playlist:restoreDefaults' }, 'Built-in playlists restored')}>
        Restore built-in playlists
      </button>
    </div>
  );
}
