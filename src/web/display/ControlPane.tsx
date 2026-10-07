import { NowPlaying } from '../shared-ui/NowPlaying';
import { SongBrowser } from '../shared-ui/SongBrowser';
import type { DisplayActions } from './App';
import { PlaylistManager } from './PlaylistManager';
import { playerStore, useYtControls } from './playerStore';
import { YtControlsDone } from './YtControlsDone';
import { Transport } from './Transport';

/** Left pane in Local mode: header, now playing + transport, and the Search/Playlists/Queue tabs. */
export function ControlPane({ actions }: { actions: DisplayActions }) {
  const ytControls = useYtControls();
  return (
    <div className="control-pane-inner">
      <header className="cp-header">
        <div className="brand">
          <img className="brand-icon" src="/icon-32.png" alt="" /> YouTube Karaoke
        </div>
        <div className="cp-header-actions">
          <button className="btn small primary" onClick={() => actions.setMode('party')} title="Let phones join (M)">
            Party mode
          </button>
          <button className="btn small ghost" onClick={actions.openSettings} title="Settings (S)">
            Settings
          </button>
          <button className="btn small ghost" onClick={actions.toggleCollapsed} title="Hide this pane (Tab)">
            Hide
          </button>
        </div>
      </header>
      <NowPlaying extraControls={<Transport />} />
      <div className="cp-yt">
        {ytControls ? (
          <YtControlsDone />
        ) : (
          <button className="btn small ghost" onClick={() => playerStore.setYtControls(true)} title="Use YouTube's own controls for 10 seconds, e.g. the gear to change quality">
            Change YouTube video settings
          </button>
        )}
      </div>
      <div className="cp-browser">
        <SongBrowser managePanel={<PlaylistManager />} />
      </div>
    </div>
  );
}
