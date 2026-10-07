import { useKaraoke } from '../shared-ui/KaraokeContext';
import { formatDuration } from '../shared-ui/format';

/** Fills the space under the video in Local mode: who queued the current song + the next three songs. */
export function UpNextStrip() {
  const { state } = useKaraoke();
  const np = state?.nowPlaying;
  const next = state?.queue.slice(0, 3) ?? [];
  return (
    <div className="up-next-strip">
      <div className="uns-now">
        {np ? (
          <>
            <div className="uns-label">Queued by</div>
            <div className="uns-singer">{np.addedBy}</div>
            <div className="uns-title">{np.title}</div>
          </>
        ) : (
          <div className="uns-label">Nothing playing</div>
        )}
      </div>
      <div className="uns-next">
        <div className="uns-label">Up next</div>
        {next.length === 0 && <div className="muted">Queue is empty</div>}
        <div className="uns-cards">
          {next.map((item, i) => (
            <div key={item.id} className="uns-card">
              <img src={item.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
              <div>
                <div className="uns-card-title">
                  {i + 1}. {item.title}
                </div>
                <div className="muted">
                  {item.addedBy} · {formatDuration(item.durationSec)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
