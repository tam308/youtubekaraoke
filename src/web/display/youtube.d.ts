// Minimal typings for the YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference).
declare namespace YT {
  const PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };

  interface PlayerEvent {
    target: Player;
    data: number;
  }

  interface PlayerOptions {
    width?: string | number;
    height?: string | number;
    videoId?: string;
    host?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (e: PlayerEvent) => void;
      onStateChange?: (e: PlayerEvent) => void;
      onError?: (e: PlayerEvent) => void;
    };
  }

  class Player {
    constructor(el: HTMLElement | string, opts: PlayerOptions);
    loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
    cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    setVolume(v: number): void;
    getCurrentTime(): number;
    getDuration(): number;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getPlayerState(): number;
    destroy(): void;
  }
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
