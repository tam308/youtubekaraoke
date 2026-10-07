import { useCallback, useEffect, useRef, useState } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';
import { playerStore, useYtControls } from './playerStore';
import { PopupNotice } from './PopupNotice';

let apiPromise: Promise<typeof YT> | null = null;

function loadYouTubeApi(): Promise<typeof YT> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the YouTube player. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** How long to wait for playback to start before assuming the browser blocked sound. */
const AUTOPLAY_CHECK_MS = 2500;

/**
 * The one and only YouTube player. It is mounted once and never unmounted (mode switches only
 * change the layout around it), so playback is never interrupted. It follows the server's
 * `nowPlaying` and reports ended / error / progress back.
 *
 * Browsers block autoplay *with sound* until the page has been clicked once. If that happens
 * the song plays muted and a banner asks for a click; the first click anywhere unmutes.
 *
 * YouTube's own controls (title at the top edge, control bar at the bottom edge) only show when
 * asked for. The player is made 120 px taller than the visible 16:9 frame on each side and the
 * frame clips it: YouTube letterboxes the video into the middle and draws its title and bar on
 * the clipped-off edges, so they can't linger over the video. "Change YouTube video settings"
 * removes the trim, which is only a resize (no reload, no blip); playerStore puts the trim back
 * after 10 s no matter what.
 *
 * After a song played in a pop-up window, the next song starts in a brand-new player: YouTube's
 * player could otherwise keep its controls (the faded round pause button) stuck on screen,
 * likely because Chrome paused its fade-out while the window was covered by the pop-up.
 */
export function Player() {
  const { state, send, hostInfo } = useKaraoke();
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const currentItemRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutedForAutoplay, setMutedForAutoplay] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  /** Bumped to replace the YouTube player with a fresh one (after a pop-up). */
  const [playerGen, setPlayerGen] = useState(0);
  /** The last song was played in a pop-up window, so the next one gets a fresh player. */
  const afterPopupRef = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const nowPlaying = state?.nowPlaying ?? null;
  const ytControls = useYtControls();
  // A song the in-app player refused is playing in a youtube.com window instead.
  const inPopup = !!nowPlaying && state?.popup?.itemId === nowPlaying.id;
  const volume = hostInfo?.settings.volume ?? 80;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const curtainSec = hostInfo?.settings.endCurtainSec ?? 10;

  const logToApp = useCallback((message: string) => void sendRef.current({ type: 'client:log', message }), []);

  // Create the player (and again, fresh, after a pop-up: see playerGen).
  useEffect(() => {
    let disposed = false;
    const old = playerRef.current;
    if (old) {
      try {
        old.destroy();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
      currentItemRef.current = null; // "follow now playing" loads the current song into the new player
      setReady(false);
      containerRef.current?.replaceChildren();
    }
    loadYouTubeApi()
      .then((YTApi) => {
        if (disposed || !containerRef.current) return;
        const mount = document.createElement('div');
        containerRef.current.appendChild(mount);
        playerRef.current = new YTApi.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            // Always on, but kept outside the visible frame unless asked for (see the trim above).
            controls: 1,
            disablekb: 1,
            fs: 0,
            rel: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => setReady(true),
            onStateChange: (e) => {
              const itemId = currentItemRef.current;
              if (!itemId) return;
              playerStore.setPaused(e.data === YTApi.PlayerState.PAUSED);
              if (e.data === YTApi.PlayerState.ENDED) {
                void sendRef.current({ type: 'player:ended', itemId });
              } else if (e.data === YTApi.PlayerState.PLAYING || e.data === YTApi.PlayerState.PAUSED || e.data === YTApi.PlayerState.BUFFERING) {
                const status = e.data === YTApi.PlayerState.PLAYING ? 'playing' : e.data === YTApi.PlayerState.PAUSED ? 'paused' : 'buffering';
                void sendRef.current({ type: 'player:progress', itemId, status, positionSec: e.target.getCurrentTime() || 0 });
              }
            },
            onError: (e) => {
              const itemId = currentItemRef.current;
              logToApp(`player error ${e.data} for item ${itemId}`);
              if (itemId) void sendRef.current({ type: 'player:error', itemId, code: e.data });
            },
          },
        });
        playerStore.register(() => {
          const p = playerRef.current;
          if (!p) return;
          if (p.getPlayerState() === YTApi.PlayerState.PLAYING) p.pauseVideo();
          else p.playVideo();
        });
      })
      .catch((err: Error) => {
        setLoadError(err.message);
        logToApp(`YouTube API failed to load: ${err.message}`);
      });
    return () => {
      disposed = true;
    };
  }, [logToApp, playerGen]);

  // Follow the server's "now playing".
  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player) return;
    setRemainingSec(null);
    if (!nowPlaying) {
      if (currentItemRef.current) player.stopVideo();
      currentItemRef.current = null;
      playerStore.setPaused(false);
      return;
    }
    if (inPopup) {
      // The YouTube window plays this one; keep the in-app player quiet.
      player.stopVideo();
      currentItemRef.current = nowPlaying.id;
      afterPopupRef.current = true;
      return;
    }
    if (currentItemRef.current === nowPlaying.id) return;
    if (afterPopupRef.current) {
      // Back from a pop-up: replace the player with a fresh one, which then loads this song.
      afterPopupRef.current = false;
      logToApp('back from a YouTube pop-up: starting the next song in a fresh player');
      setPlayerGen((g) => g + 1);
      return;
    }
    // New song: hide YouTube's controls again.
    if (playerStore.ytControls) playerStore.setYtControls(false);
    currentItemRef.current = nowPlaying.id;
    const pb = state?.playback;
    const startSeconds = pb?.itemId === nowPlaying.id ? Math.floor(pb.positionSec) : 0;
    player.loadVideoById({ videoId: nowPlaying.videoId, startSeconds });

    // If the browser blocked autoplay with sound, play muted rather than not at all.
    const itemId = nowPlaying.id;
    const t = setTimeout(() => {
      const p = playerRef.current;
      if (!p || currentItemRef.current !== itemId) return;
      const st = p.getPlayerState();
      if (st === YT.PlayerState.UNSTARTED || st === YT.PlayerState.CUED) {
        logToApp('autoplay with sound was blocked; playing muted until the first click');
        p.mute();
        p.playVideo();
        setMutedForAutoplay(true);
      }
    }, AUTOPLAY_CHECK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, nowPlaying?.id, inPopup]);

  // First click/keypress anywhere on the page unmutes.
  useEffect(() => {
    if (!mutedForAutoplay) return;
    const unmute = () => {
      const p = playerRef.current;
      if (!p) return;
      p.unMute();
      p.setVolume(volumeRef.current);
      if (p.getPlayerState() !== YT.PlayerState.PLAYING) p.playVideo();
      setMutedForAutoplay(false);
    };
    window.addEventListener('pointerdown', unmute, { capture: true, once: true });
    window.addEventListener('keydown', unmute, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', unmute, { capture: true });
      window.removeEventListener('keydown', unmute, { capture: true });
    };
  }, [mutedForAutoplay]);

  useEffect(() => {
    if (ready && !mutedForAutoplay) playerRef.current?.setVolume(volume);
  }, [ready, volume, mutedForAutoplay]);

  // Report the position every 2 s, and track time remaining for the end-of-song curtain.
  useEffect(() => {
    if (!ready) return;
    let ticks = 0;
    const t = setInterval(() => {
      const p = playerRef.current;
      const itemId = currentItemRef.current;
      if (!p || !itemId) return;
      const playing = p.getPlayerState() === YT.PlayerState.PLAYING;
      const pos = p.getCurrentTime() || 0;
      const dur = p.getDuration() || 0;
      setRemainingSec(playing && dur > 0 ? dur - pos : null);
      if (playing && ++ticks % 4 === 0) {
        void sendRef.current({ type: 'player:progress', itemId, status: 'playing', positionSec: pos });
      }
    }, 500);
    return () => clearInterval(t);
  }, [ready]);

  const next = state?.queue[0];
  const showCurtain = !inPopup && curtainSec > 0 && remainingSec !== null && remainingSec <= curtainSec && !!nowPlaying;

  return (
    <>
      <div className={`yt-frame${ytControls ? '' : ' trimmed'}`}>
        <div className="yt-container" ref={containerRef} />
      </div>
      {inPopup && nowPlaying && <PopupNotice />}
      {showCurtain && (
        <div className="end-curtain">
          <div className="ec-card">
            {next ? (
              <>
                <div className="uns-label">Up next</div>
                <img src={next.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
                <div className="ec-title">{next.title}</div>
                <div className="ec-sub">
                  Queued by <span className="singer">{next.addedBy}</span>
                </div>
              </>
            ) : (
              <>
                <div className="ec-title">That's the last song in the queue</div>
                <div className="ec-sub">{state?.mode === 'party' ? 'Scan the QR code to add more.' : 'Search for another one on the left.'}</div>
              </>
            )}
          </div>
        </div>
      )}
      {mutedForAutoplay && (
        <button className="unmute-banner" onClick={() => undefined}>
          Sound is off. Click anywhere to turn it on.
        </button>
      )}
      {(loadError || !nowPlaying) && (
        <div className="idle-screen">
          {loadError ? (
            <p className="error-text">{loadError}</p>
          ) : (
            <>
              <img className="idle-logo" src="/icon-192.png" alt="" />
              <h1>Ready to sing</h1>
              <p>{state?.mode === 'party' ? 'Scan the QR code with your phone to add songs.' : 'Search for a song on the left to get started.'}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
