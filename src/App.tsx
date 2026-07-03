import { useEffect, useMemo, useRef, useState } from "react";
import { FlipHorizontal2, Gauge, Play, ScanSearch, SkipBack, SkipForward, X } from "lucide-react";

const STORAGE_KEY = "furi-practice-player-state";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

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

function formatTime(totalSeconds: number | null) {
  if (!Number.isFinite(totalSeconds) || !totalSeconds || totalSeconds <= 0) return "--:--.-";

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
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    controls: "0"
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
  const [pointA, setPointA] = useState<number | null>(saved.pointA);
  const [pointB, setPointB] = useState<number | null>(saved.pointB);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const touchRef = useRef<TouchSnapshot | null>(null);
  const iframeLoadedRef = useRef(false);

  const embedUrl = videoId ? buildEmbedUrl(videoId) : "";

  useEffect(() => {
    const nextState: SavedState = { url, videoId, mirrored, scale, speed, pointA, pointB };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [url, videoId, mirrored, scale, speed, pointA, pointB]);

  const loadVideo = () => {
    const nextId = extractVideoId(url);
    console.log("extracted videoId", nextId);

    if (!nextId) {
      setStatusMessage("");
      setErrorMessage("YouTube URL または動画 ID を入力してください。");
      return;
    }

    iframeLoadedRef.current = false;
    setVideoId(nextId);
    setStatusMessage("動画を読み込んでいます...");
    setErrorMessage("");
  };

  const showApiPendingStatus = () => {
    // 再生/停止、シーク、速度、A-B は iframe 表示復旧後に YouTube Player API へ段階的に戻す。
    setStatusMessage("再生操作は次の段階で YouTube Player API に戻します。動画内をタップして再生してください。");
  };

  const touchDistance = (touches: React.TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const onStageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    setSpeedMenuOpen(false);
    if (event.touches.length === 2) {
      touchRef.current = {
        x: 0,
        distance: touchDistance(event.touches),
        scale
      };
      return;
    }

    touchRef.current = { x: event.touches[0].clientX };
  };

  const onStageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current;
    if (!start) return;

    if (event.touches.length === 2 && start.distance && start.scale) {
      event.preventDefault();
      setScale(clamp(start.scale * (touchDistance(event.touches) / start.distance), 1, 3));
    }
  };

  const onStageTouchEnd = () => {
    touchRef.current = null;
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
        <div className="video-stage" onTouchStart={onStageTouchStart} onTouchMove={onStageTouchMove} onTouchEnd={onStageTouchEnd}>
          <div
            className="video-transform"
            style={{
              transform: `scale(${scale}) ${mirrored ? "scaleX(-1)" : ""}`
            }}
          >
            {embedUrl && (
              <iframe
                title="YouTube video player"
                src={embedUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen={false}
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => {
                  iframeLoadedRef.current = true;
                  setStatusMessage("");
                  console.log("iframe loaded", embedUrl);
                }}
                onError={() => {
                  setStatusMessage("");
                  setErrorMessage("動画の埋め込み再生が許可されていない可能性があります。YouTubeで直接確認してください。");
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

          {statusMessage && <p className="status-message">{statusMessage}</p>}
          {errorMessage && <p className="notice">{errorMessage}</p>}
        </div>
      </section>

      <footer className="bottom-bar" aria-label="操作バー">
        <button className="icon-button" type="button" onClick={showApiPendingStatus} aria-label="5秒戻る">
          <SkipBack />
          <span>-5</span>
        </button>
        <button className="play-button" type="button" onClick={showApiPendingStatus} aria-label="再生停止">
          <Play />
        </button>
        <button className="icon-button" type="button" onClick={showApiPendingStatus} aria-label="5秒進む">
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
                    showApiPendingStatus();
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
          onClick={() => {
            setPointA(0);
            showApiPendingStatus();
          }}
          aria-label="A点"
        >
          A
        </button>
        <button
          className={`text-button ${pointB !== null ? "has-point" : ""}`}
          type="button"
          onClick={() => {
            setPointB(0);
            showApiPendingStatus();
          }}
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
        <span>A {formatTime(pointA)}</span>
        <span>B {formatTime(pointB)}</span>
      </div>
    </main>
  );
}
