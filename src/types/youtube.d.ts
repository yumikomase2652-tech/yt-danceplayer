export {};

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }

  namespace YT {
    class Player {
      constructor(elementId: string | HTMLElement, options: PlayerOptions);
      cueVideoById(videoId: string): void;
      loadVideoById(videoId: string): void;
      playVideo(): void;
      pauseVideo(): void;
      seekTo(seconds: number, allowSeekAhead: boolean): void;
      setPlaybackRate(suggestedRate: number): void;
      setPlaybackQuality(suggestedQuality: string): void;
      getPlaybackQuality(): string;
      getAvailableQualityLevels(): string[];
      getPlayerState(): number;
      getCurrentTime(): number;
      getDuration(): number;
      destroy(): void;
    }

    interface PlayerOptions {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: PlayerEvent) => void;
        onStateChange?: (event: OnStateChangeEvent) => void;
        onError?: (event: OnErrorEvent) => void;
      };
    }

    interface PlayerEvent {
      target: Player;
    }

    interface OnStateChangeEvent {
      target: Player;
      data: number;
    }

    interface OnErrorEvent {
      target: Player;
      data: number;
    }

    const PlayerState: {
      UNSTARTED: -1;
      ENDED: 0;
      PLAYING: 1;
      PAUSED: 2;
      BUFFERING: 3;
      CUED: 5;
    };
  }
}
