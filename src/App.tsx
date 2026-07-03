import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlipHorizontal2, Gauge, Pause, Play, ScanSearch, SkipBack, SkipForward, X } from "lucide-react";

const STORAGE_KEY = "furi-practice-player-state";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const DOUBLE_TAP_JUMP_SECONDS = 0.5;

type SavedState = {
  url: string;
  videoId: string;
  mirrored: boolean;
  scale: number;
  speed: number;
  pointA: number | null;
  pointB: number | null;
};

type TouchSnapshot = {
  x: number;
  y: number;
  time: number;
  distance?: number;
  scale?: number;
};

const defaultState: SavedState = {
  url: "",
  videoId: "",
  mirrored: false,
  scale: 1,
  speed: 1,
  pointA: null,
  pointB: null
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00.0";

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function extractVideoId(value: string) {
  const input = value.trim();
  if (!input) return "";
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }

    if (url.hostname.includes("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId) return watchId;

      const parts = url.pathname.split("/").filter(Boolean);
      const videoIndex = parts.findIndex((part) => part === "embed" || part === "shorts");
      if (videoIndex >= 0) return parts[videoIndex + 1] ?? "";
    }
  } catch {
    return "";
  }

  return "";
}

function readSavedState(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultState, ...JSON.parse(raw) } : defaultState;
  } catch {
    return defaultState;
  }
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise<typeof YT>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });
}

export function App() {
  const saved = useMemo(readSavedState, []);
  const [url, setUrl] = useState(saved.url);
  const [videoId, setVideoId] = useState(saved.videoId);
  const [mirrored, setMirrored] = useState(saved.mirrored);
  const [scale, setScale] = useState(saved.scale);
  const [speed, setSpeed] = useState(saved.speed);
  const [pointA, setPointA] = useState<number | null>(saved.pointA);
  const [pointB, setPointB] = useState<number | null>(saved.pointB);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const playerRef = useRef<YT.Player | null>(null);
  const touchRef = useRef<TouchSnapshot | null>(null);
  const dragStartedRef = useRef(false);
  const tapTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const longPressRef = useRef<{ timer: number | null; used: boolean }>({ timer: null, used: false });
  const playerElementId = "youtube-player";

  const validLoop = pointA !== null && pointB !== null && pointB > pointA;
  const progress = duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;

  useEffect(() => {
    const nextState: SavedState = { url, videoId, mirrored, scale, speed, pointA, pointB };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [url, videoId, mirrored, scale, speed, pointA, pointB]);

  useEffect(() => {
    let disposed = false;

    loadYouTubeApi().then(() => {
      if (disposed || playerRef.current) return;

      playerRef.current = new YT.Player(playerElementId, {
        width: "100%",
        height: "100%",
        videoId: videoId || undefined,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          controls: 0,
          disablekb: 1
        },
        events: {
          onReady: (event) => {
            event.target.setPlaybackRate(speed);
            setDuration(event.target.getDuration() || 0);
          },
          onStateChange: (event) => {
            setIsPlaying(event.data === YT.PlayerState.PLAYING);
          }
        }
      });
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const time = player.getCurrentTime() || 0;
      const length = player.getDuration() || 0;
      setCurrentTime(time);
      setDuration(length);

      if (validLoop && pointA !== null && pointB !== null && time >= pointB) {
        player.seekTo(pointA, true);
        player.playVideo();
      }
    }, 80);

    return () => window.clearInterval(timer);
  }, [pointA, pointB, validLoop]);

  useEffect(() => {
    playerRef.current?.setPlaybackRate(speed);
  }, [speed]);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
      if (longPressRef.current.timer) window.clearTimeout(longPressRef.current.timer);
    };
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const safeTime = clamp(seconds, 0, duration || Number.MAX_SAFE_INTEGER);
      playerRef.current?.seekTo(safeTime, true);
      setCurrentTime(safeTime);
    },
    [duration]
  );

  const jump = useCallback(
    (delta: number) => {
      seekTo((playerRef.current?.getCurrentTime() ?? currentTime) + delta);
    },
    [currentTime, seekTo]
  );

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player || !videoId) return;

    if (isPlaying) {
      player.pauseVideo();
      return;
    }

    if (validLoop && pointA !== null && currentTime >= (pointB ?? Infinity)) {
      player.seekTo(pointA, true);
    }
    player.playVideo();
  }, [currentTime, isPlaying, pointA, pointB, validLoop, videoId]);

  const loadVideo = useCallback(() => {
    const nextId = extractVideoId(url);
    if (!nextId) {
      setNotice("YouTube URL または動画 ID を入力してください。");
      return;
    }

    setNotice("");
    setVideoId(nextId);
    setCurrentTime(0);
    setDuration(0);
    playerRef.current?.loadVideoById(nextId);
    playerRef.current?.setPlaybackRate(speed);
  }, [speed, url]);

  const setLoopPoint = (side: "A" | "B") => {
    const time = playerRef.current?.getCurrentTime() ?? currentTime;
    if (side === "A") {
      setPointA(time);
      if (pointB !== null && pointB <= time) setPointB(null);
      return;
    }
    setPointB(time);
  };

  const seekToLoopPoint = (side: "A" | "B") => {
    const target = side === "A" ? pointA : pointB;
    if (target !== null) seekTo(target);
  };

  const handleSeekBar = (clientX: number, rect: DOMRect) => {
    if (!duration) return;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    seekTo(ratio * duration);
  };

  const touchDistance = (touches: React.TouchList | TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const seekSensitivity = (y: number, height: number) => {
    const ratio = y / height;
    if (ratio < 0.34) return 0.2;
    if (ratio < 0.67) return 0.05;
    return 0.01;
  };

  const handleTap = (clientX: number, clientY: number, width: number) => {
    const now = Date.now();
    const previous = lastTapRef.current;
    const doubleTap =
      previous !== null &&
      now - previous.at < 280 &&
      Math.abs(clientX - previous.x) < 48 &&
      Math.abs(clientY - previous.y) < 48;

    if (doubleTap) {
      if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      lastTapRef.current = null;
      jump(clientX < width / 2 ? -DOUBLE_TAP_JUMP_SECONDS : DOUBLE_TAP_JUMP_SECONDS);
      return;
    }

    lastTapRef.current = { at: now, x: clientX, y: clientY };
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => {
      togglePlay();
      tapTimerRef.current = null;
    }, 230);
  };

  const onStageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!videoId) return;
    setSpeedMenuOpen(false);

    if (event.touches.length === 2) {
      touchRef.current = {
        x: 0,
        y: 0,
        time: currentTime,
        distance: touchDistance(event.touches),
        scale
      };
      dragStartedRef.current = true;
      return;
    }

    const touch = event.touches[0];
    touchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: playerRef.current?.getCurrentTime() ?? currentTime
    };
    dragStartedRef.current = false;
  };

  const onStageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current;
    if (!start) return;
    event.preventDefault();

    if (event.touches.length === 2 && start.distance && start.scale) {
      setScale(clamp(start.scale * (touchDistance(event.touches) / start.distance), 1, 3));
      dragStartedRef.current = true;
      return;
    }

    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = touch.clientX - start.x;
    if (Math.abs(deltaX) < 4) return;

    dragStartedRef.current = true;
    seekTo(start.time + deltaX * seekSensitivity(start.y - rect.top, rect.height));
  };

  const onStageTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!dragStartedRef.current && event.changedTouches[0]) {
      const touch = event.changedTouches[0];
      const rect = event.currentTarget.getBoundingClientRect();
      handleTap(touch.clientX - rect.left, touch.clientY - rect.top, rect.width);
    }
    touchRef.current = null;
    dragStartedRef.current = false;
  };

  const onStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.detail > 1 || !videoId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    handleTap(event.clientX - rect.left, event.clientY - rect.top, rect.width);
  };

  const startLoopButtonPress = (side: "A" | "B") => {
    longPressRef.current.used = false;
    longPressRef.current.timer = window.setTimeout(() => {
      longPressRef.current.used = true;
      seekToLoopPoint(side);
    }, 460);
  };

  const finishLoopButtonPress = (side: "A" | "B") => {
    if (longPressRef.current.timer) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }

    if (!longPressRef.current.used) setLoopPoint(side);
  };

  const cancelLoopButtonPress = () => {
    if (longPressRef.current.timer) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current.timer = null;
    longPressRef.current.used = false;
  };

  return (
    <main className="app-shell">
      <header className="top-bar">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") loadVideo();
          }}
          inputMode="url"
          placeholder="YouTube URL"
          aria-label="YouTube URL"
        />
        <button type="button" onClick={loadVideo}>
          読込
        </button>
      </header>

      <section className="player-zone" aria-label="YouTube プレーヤー">
        <div
          className="video-stage"
          onClick={onStageClick}
          onDoubleClick={(event) => {
            if (!videoId) return;
            const rect = event.currentTarget.getBoundingClientRect();
            jump(event.clientX - rect.left < rect.width / 2 ? -DOUBLE_TAP_JUMP_SECONDS : DOUBLE_TAP_JUMP_SECONDS);
          }}
          onTouchStart={onStageTouchStart}
          onTouchMove={onStageTouchMove}
          onTouchEnd={onStageTouchEnd}
        >
          <div
            className="video-transform"
            style={{
              transform: `scale(${scale}) ${mirrored ? "scaleX(-1)" : ""}`
            }}
          >
            <div id={playerElementId} />
          </div>

          {!videoId && (
            <div className="empty-state">
              <ScanSearch size={42} />
              <p>YouTube URL を入力して練習を始める</p>
            </div>
          )}

          {notice && <p className="notice">{notice}</p>}

          <div className="gesture-zones" aria-hidden="true">
            <span>大きく</span>
            <span>ふつう</span>
            <span>細かく</span>
          </div>

          <div className="time-overlay">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <button
            className="seekbar"
            type="button"
            aria-label="シークバー"
            onClick={(event) => {
              event.stopPropagation();
              handleSeekBar(event.clientX, event.currentTarget.getBoundingClientRect());
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) handleSeekBar(event.clientX, event.currentTarget.getBoundingClientRect());
            }}
            onTouchStart={(event) => event.stopPropagation()}
            onTouchMove={(event) => {
              event.stopPropagation();
              handleSeekBar(event.touches[0].clientX, event.currentTarget.getBoundingClientRect());
            }}
            onTouchEnd={(event) => event.stopPropagation()}
          >
            <span className="seekbar-fill" style={{ width: `${progress}%` }} />
            {pointA !== null && duration > 0 && (
              <span className="marker marker-a" style={{ left: `${(pointA / duration) * 100}%` }} />
            )}
            {pointB !== null && duration > 0 && (
              <span className="marker marker-b" style={{ left: `${(pointB / duration) * 100}%` }} />
            )}
          </button>
        </div>
      </section>

      <footer className="bottom-bar" aria-label="操作バー">
        <button className="icon-button" type="button" onClick={() => jump(-5)} aria-label="5秒戻る">
          <SkipBack />
          <span>-5</span>
        </button>
        <button className="play-button" type="button" onClick={togglePlay} aria-label="再生停止">
          {isPlaying ? <Pause /> : <Play />}
        </button>
        <button className="icon-button" type="button" onClick={() => jump(5)} aria-label="5秒進む">
          <SkipForward />
          <span>+5</span>
        </button>
        <button
          className={`icon-button ${mirrored ? "is-active" : ""}`}
          type="button"
          onClick={() => setMirrored((value) => !value)}
          aria-label="左右反転"
        >
          <FlipHorizontal2 />
          <span>反転</span>
        </button>
        <div className="speed-control">
          <button
            className={`icon-button ${speedMenuOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => setSpeedMenuOpen((value) => !value)}
            aria-label="速度"
          >
            <Gauge />
            <span>{speed}x</span>
          </button>
          {speedMenuOpen && (
            <div className="speed-popover" role="menu">
              {SPEEDS.map((value) => (
                <button
                  className={speed === value ? "is-active" : ""}
                  type="button"
                  key={value}
                  onClick={() => {
                    setSpeed(value);
                    setSpeedMenuOpen(false);
                  }}
                >
                  {value}x
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={`text-button ${pointA !== null ? "has-point" : ""}`}
          type="button"
          onPointerDown={() => startLoopButtonPress("A")}
          onPointerUp={() => finishLoopButtonPress("A")}
          onPointerCancel={cancelLoopButtonPress}
          onPointerLeave={cancelLoopButtonPress}
          aria-label="A点"
        >
          A
        </button>
        <button
          className={`text-button ${pointB !== null ? "has-point" : ""}`}
          type="button"
          onPointerDown={() => startLoopButtonPress("B")}
          onPointerUp={() => finishLoopButtonPress("B")}
          onPointerCancel={cancelLoopButtonPress}
          onPointerLeave={cancelLoopButtonPress}
          aria-label="B点"
        >
          B
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => {
            setPointA(null);
            setPointB(null);
          }}
          aria-label="A-B解除"
        >
          <X />
          <span>解除</span>
        </button>
      </footer>

      <div className="loop-readout" aria-live="polite">
        <span>A {pointA === null ? "--:--.-" : formatTime(pointA)}</span>
        <span>B {pointB === null ? "--:--.-" : formatTime(pointB)}</span>
      </div>
    </main>
  );
}
