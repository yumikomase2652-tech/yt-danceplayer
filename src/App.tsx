import { useEffect, useMemo, useRef, useState } from "react";
import { FlipHorizontal2, Gauge, Pause, Play, ScanSearch, SkipBack, SkipForward } from "lucide-react";

const STORAGE_KEY = "d-player-state";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const SHOW_YOUTUBE_CONTROLS = false;
const APPROX_DURATION_SECONDS = 180;

type SavedState = {
  url: string;
  videoId: string;
  mirrored: boolean;
  scale: number;
  speed: number;
};

type TouchSnapshot = {
  x: number;
  y: number;
  startTime: number;
  distance?: number;
  scale?: number;
  pinching: boolean;
};

const defaultState: SavedState = {
  url: "",
  videoId: "",
  mirrored: false,
  scale: 1,
  speed: 1
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function extractVideoId(value: string) {
  const input = value.trim();
  if (!input) return "";
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : "";
    }

    if (url.hostname.includes("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId && /^[a-zA-Z0-9_-]{11}$/.test(watchId)) return watchId;

      const parts = url.pathname.split("/").filter(Boolean);
      const videoIndex = parts.findIndex((part) => part === "embed" || part === "shorts");
      const id = videoIndex >= 0 ? (parts[videoIndex + 1] ?? "") : "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : "";
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

function buildEmbedUrl(videoId: string) {
  const params = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    controls: SHOW_YOUTUBE_CONTROLS ? "1" : "0",
    iv_load_policy: "3",
    fs: "0",
    disablekb: "1",
    origin: window.location.origin
  });

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function App() {
  const saved = useMemo(readSavedState, []);
  const [url, setUrl] = useState(saved.url);
  const [videoId, setVideoId] = useState(saved.videoId);
  const [mirrored, setMirrored] = useState(saved.mirrored);
  const [scale, setScale] = useState(saved.scale);
  const [speed, setSpeed] = useState(saved.speed);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(Boolean(saved.videoId));
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [seekPercent, setSeekPercent] = useState(0);
  const [dragDelta, setDragDelta] = useState<number | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const touchRef = useRef<TouchSnapshot | null>(null);
  const currentTimeRef = useRef(0);

  const embedUrl = videoId ? buildEmbedUrl(videoId) : "";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, videoId, mirrored, scale, speed }));
  }, [url, videoId, mirrored, scale, speed]);

  useEffect(() => {
    const preventGesture = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
    };
  }, []);

  useEffect(() => {
    if (!loading) return;

    const timer = window.setTimeout(() => {
      setLoading(false);
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [loading, videoId]);

  const postToPlayer = (func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func,
        args
      }),
      "https://www.youtube.com"
    );
  };

  const playVideo = () => postToPlayer("playVideo");
  const pauseVideo = () => postToPlayer("pauseVideo");
  const seekTo = (seconds: number) => postToPlayer("seekTo", [Math.max(0, seconds), true]);
  const setPlaybackRate = (rate: number) => postToPlayer("setPlaybackRate", [rate]);

  const loadVideo = () => {
    const nextId = extractVideoId(url);
    console.log("extracted videoId", nextId);

    if (!nextId) {
      setErrorMessage("YouTube URL または動画 ID を入力してください。");
      return;
    }

    setVideoId(nextId);
    setLoading(true);
    setErrorMessage("");
    setIsPlaying(false);
    setSeekPercent(0);
  };

  const togglePlay = () => {
    if (!videoId) return;
    if (isPlaying) {
      pauseVideo();
      setIsPlaying(false);
    } else {
      playVideo();
      setIsPlaying(true);
    }
  };

  const jumpBy = (seconds: number) => {
    const nextTime = Math.max(0, currentTimeRef.current + seconds);
    const nextPercent = clamp(nextTime / APPROX_DURATION_SECONDS, 0, 1);
    currentTimeRef.current = nextTime;
    setSeekPercent(nextPercent);
    seekTo(nextTime);
  };

  const changeSpeed = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    setSpeedMenuOpen(false);
    setPlaybackRate(nextSpeed);
  };

  const handleSeek = (clientX: number, rect: DOMRect) => {
    const nextPercent = clamp((clientX - rect.left) / rect.width, 0, 1);
    const nextTime = nextPercent * APPROX_DURATION_SECONDS;
    currentTimeRef.current = nextTime;
    setSeekPercent(nextPercent);
    seekTo(nextTime);
  };

  const touchDistance = (touches: React.TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const onStageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    setSpeedMenuOpen(false);
    event.preventDefault();

    if (event.touches.length === 2) {
      touchRef.current = {
        x: 0,
        y: 0,
        startTime: currentTimeRef.current,
        distance: touchDistance(event.touches),
        scale,
        pinching: true
      };
      setDragDelta(null);
      return;
    }

    const touch = event.touches[0];
    touchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startTime: currentTimeRef.current,
      pinching: false
    };
  };

  const onStageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current;
    if (!start) return;

    event.preventDefault();

    if (event.touches.length === 2 && start.distance && start.scale) {
      touchRef.current = { ...start, pinching: true };
      setScale(clamp(start.scale * (touchDistance(event.touches) / start.distance), 1, 3));
      setDragDelta(null);
      return;
    }

    if (event.touches.length !== 1 || start.pinching) return;

    const touch = event.touches[0];
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioY = clamp((start.y - rect.top) / rect.height, 0, 1);
    const sensitivity = ratioY < 1 / 3 ? 0.2 : ratioY < 2 / 3 ? 0.05 : 0.01;
    setDragDelta((touch.clientX - start.x) * sensitivity);
  };

  const onStageTouchEnd = () => {
    if (touchRef.current && !touchRef.current.pinching && dragDelta !== null) {
      const nextTime = Math.max(0, touchRef.current.startTime + dragDelta);
      currentTimeRef.current = nextTime;
      setSeekPercent(clamp(nextTime / APPROX_DURATION_SECONDS, 0, 1));
      seekTo(nextTime);
    }
    touchRef.current = null;
    setDragDelta(null);
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
        <div className="video-stage">
          <div
            className="videoTransformLayer"
            style={{
              transform: `scale(${scale}) ${mirrored ? "scaleX(-1)" : ""}`
            }}
          >
            {embedUrl && (
              <iframe
                ref={iframeRef}
                title="YouTube video player"
                src={embedUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => {
                  setLoading(false);
                  setErrorMessage("");
                  setPlaybackRate(speed);
                  console.log("iframe loaded", embedUrl);
                }}
              />
            )}
          </div>

          {!videoId && (
            <div className="empty-state">
              <ScanSearch size={42} />
              <p>YouTube URL を入力して練習を始める</p>
            </div>
          )}

          {loading && <p className="status-message">動画を読み込んでいます...</p>}
          {errorMessage && <p className="notice">{errorMessage}</p>}
          {dragDelta !== null && <p className="drag-delta">{dragDelta >= 0 ? "+" : ""}{dragDelta.toFixed(1)}s</p>}
          {videoId && (
            <div
              className="gesture-layer is-enabled"
              aria-hidden="true"
              onTouchStart={onStageTouchStart}
              onTouchMove={onStageTouchMove}
              onTouchEnd={onStageTouchEnd}
              onTouchCancel={onStageTouchEnd}
            />
          )}
        </div>
      </section>

      <div className="seek-strip" aria-label="シークバー">
        <button
          className="seek-track"
          type="button"
          onClick={(event) => handleSeek(event.clientX, event.currentTarget.getBoundingClientRect())}
          onPointerMove={(event) => {
            if (event.buttons === 1) handleSeek(event.clientX, event.currentTarget.getBoundingClientRect());
          }}
        >
          <span className="seek-fill" style={{ width: `${seekPercent * 100}%` }} />
          <span className="seek-thumb" style={{ left: `${seekPercent * 100}%` }} />
        </button>
      </div>

      <footer className="bottom-bar" aria-label="操作バー">
        <button className="icon-button" type="button" onClick={() => jumpBy(-5)} disabled={!videoId} aria-label="5秒戻る">
          <SkipBack />
          <span>-5</span>
        </button>
        <button className="play-button" type="button" onClick={togglePlay} disabled={!videoId} aria-label="再生停止">
          {isPlaying ? <Pause /> : <Play />}
        </button>
        <button className="icon-button" type="button" onClick={() => jumpBy(5)} disabled={!videoId} aria-label="5秒進む">
          <SkipForward />
          <span>+5</span>
        </button>
        <button
          className={`icon-button ${mirrored ? "is-active" : ""}`}
          type="button"
          onClick={() => setMirrored((value) => !value)}
          disabled={!videoId}
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
            disabled={!videoId}
            aria-label="速度"
          >
            <Gauge />
            <span>{speed}x</span>
          </button>
          {speedMenuOpen && (
            <div className="speed-popover" role="menu">
              {SPEEDS.map((value) => (
                <button className={speed === value ? "is-active" : ""} type="button" key={value} onClick={() => changeSpeed(value)}>
                  {value}x
                </button>
              ))}
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}
