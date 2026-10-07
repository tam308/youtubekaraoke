import { useState, type ReactNode } from 'react';
import { useKaraoke } from './KaraokeContext';
import { PlaylistsTab } from './PlaylistsTab';
import { QueueList } from './QueueList';
import { SearchPanel } from './SearchPanel';

export type SongTab = 'search' | 'playlists' | 'queue' | 'extra';

/**
 * Search / Playlists / Queue tabs, shared by the PC control pane, the party drawer and the phone.
 * Panels stay mounted while hidden so search results and scroll positions survive tab switches.
 */
export function SongBrowser({
  managePanel,
  tabPosition = 'top',
  initialTab = 'search',
  extraTab,
}: {
  managePanel?: ReactNode;
  tabPosition?: 'top' | 'bottom';
  initialTab?: SongTab;
  /** An additional tab after Queue (the phone uses it for Volume). */
  extraTab?: { label: string; content: ReactNode };
}) {
  const { state } = useKaraoke();
  const [tab, setTab] = useState<SongTab>(initialTab);
  const count = state?.queue.length ?? 0;

  const tabs = (
    <nav className={`tabs tabs-${tabPosition}`} role="tablist">
      <TabButton active={tab === 'search'} onClick={() => setTab('search')} label="Search" />
      <TabButton active={tab === 'playlists'} onClick={() => setTab('playlists')} label="Playlists" />
      <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} label="Queue" badge={count || undefined} />
      {extraTab && <TabButton active={tab === 'extra'} onClick={() => setTab('extra')} label={extraTab.label} />}
    </nav>
  );

  return (
    <div className="song-browser">
      {tabPosition === 'top' && tabs}
      <div className="tab-body">
        <div className="tab-panel" hidden={tab !== 'search'}>
          <SearchPanel />
        </div>
        <div className="tab-panel" hidden={tab !== 'playlists'}>
          <PlaylistsTab managePanel={managePanel} />
        </div>
        <div className="tab-panel" hidden={tab !== 'queue'}>
          <QueueList />
        </div>
        {extraTab && (
          <div className="tab-panel" hidden={tab !== 'extra'}>
            {extraTab.content}
          </div>
        )}
      </div>
      {tabPosition === 'bottom' && tabs}
    </div>
  );
}

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button role="tab" aria-selected={active} className={`tab${active ? ' active' : ''}`} onClick={onClick}>
      <span className="tab-label">{label}</span>
      {badge !== undefined && <span className="badge">{badge}</span>}
    </button>
  );
}
