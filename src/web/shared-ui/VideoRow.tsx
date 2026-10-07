import type { ReactNode } from 'react';
import type { Video } from '../../shared/types';
import { formatDuration } from './format';

export function VideoRow({
  video,
  actions,
  leading,
  meta,
  dimmed,
  onClick,
}: {
  video: Pick<Video, 'title' | 'channel' | 'durationSec' | 'thumbnailUrl'>;
  actions?: ReactNode;
  leading?: ReactNode;
  meta?: ReactNode;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`video-row${dimmed ? ' dimmed' : ''}${onClick ? ' clickable' : ''}`} onClick={onClick}>
      {leading}
      <div className="thumb">
        <img src={video.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        {video.durationSec > 0 && <span className="duration">{formatDuration(video.durationSec)}</span>}
      </div>
      <div className="info">
        <div className="title" title={video.title}>
          {video.title}
        </div>
        <div className="sub">
          {video.channel}
          {meta}
        </div>
      </div>
      {actions && (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
