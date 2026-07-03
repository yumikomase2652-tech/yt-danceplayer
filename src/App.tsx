import { useEffect, useMemo, useRef, useState } from "react";
import { FlipHorizontal2, Gauge, Pause, Play, ScanSearch, SkipBack, SkipForward } from "lucide-react";

const STORAGE_KEY = "d-player-state";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const SHOW_YOUTUBE_CONTROLS = false;
const PREFERRED_QUALITY = "hd1080";
const EXPERIMENTAL_QUALITY = "highres";
const APPROX_DURATION_SECONDS = 180;
const MAX_SCALE = 5;

type SavedState = {
  url: string;
  videoId: string;
  mirrored: boolean;
  scale: number;
  translateX: number;
  translateY: number;
  speed: number;
};

type TouchSnapshot = {
  x: number;
  y: number;
  startTime: number;
  moved?: boolean;
  distance?: number;
  scale?: number;
  centerX?: number;
  centerY?: number;
  translateX?: number;
  translateY?: number;
  pinching: boolean;
};

const defaultState: SavedState = {
  url: "",
  videoId: "",
  mirrored: false,
  scale: 1,
  translateX: 0,
  translateY: 0,
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
    autoplay: "0",
    iv_load_policy: "3",
    cc_load_policy: "0",
    fs: "0",
    disablekb: "1",
    vq: PREFERRED_QUALITY,
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
  const [translateX, setTranslateX] = useState(saved.translateX);
  const [translateY, setTranslateY] = useState(saved.translateY);
  const [speed, setSpeed] = useState(saved.speed);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(Boolean(saved.videoId));
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [seekPercent, setSeekPercent] = useState(0);
  const [dragDelta, setDragDelta] = useState<number | null>(null);
  const [seekToast, setSeekToast] = useState("");
  const [uiVisible, setUiVisible] = useState(true);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoStageRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<TouchSnapshot | null>(null);
  const currentTimeRef = useRef(0);
  const seekToastTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const embedUrl = videoId ? buildEmbedUrl(videoId) : "";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, videoId, mirrored, scale, translateX, translateY, speed }));
  }, [url, videoId, mirrored, scale, translateX, translateY, speed]);

  useEffect(() => {
    if (scale <= 1) {
      setTranslateX(0);
      setTranslateY(0);
      return;
    }

    const nextTranslate = clampTranslate(translateX, translateY, scale);
    if (nextTranslate.x !== translateX) setTranslateX(nextTranslate.x);
    if (nextTranslate.y !== translateY) setTranslateY(nextTranslate.y);
  }, [scale]);

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

  useEffect(() => {
    return () => {
      if (seekToastTimerRef.current) window.clearTimeout(seekToastTimerRef.current);
    };
  }, []);

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
  const setPlaybackQuality = (quality: string) => postToPlayer("setPlaybackQuality", [quality]);
  const setPlaybackQualityRange = (quality: string) => postToPlayer("setPlaybackQualityRange", [quality, quality]);
  const disableCaptions = () => {
    // 字幕OFF命令はYouTube側で無視される場合があります。cc_load_policy=0 と併用して、効く範囲で抑制します。
    postToPlayer("unloadModule", ["captions"]);
    postToPlayer("unloadModule", ["cc"]);
    postToPlayer("setOption", ["captions", "track", {}]);
    postToPlayer("setOption", ["cc", "track", {}]);
  };

  const applyPlaybackPreferences = () => {
    setPlaybackRate(speed);
    disableCaptions();
    // postMessageの画質指定はYouTube側で無視される場合があります。iframe src の vq も併用します。
    setPlaybackQuality(EXPERIMENTAL_QUALITY);
    setPlaybackQualityRange(EXPERIMENTAL_QUALITY);
    window.setTimeout(() => {
      setPlaybackQuality(PREFERRED_QUALITY);
      setPlaybackQualityRange(PREFERRED_QUALITY);
    }, 300);
  };

  const formatClock = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const rest = Math.floor(safeSeconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  };

  const showSeekToast = (delta: number, targetTime: number) => {
    setSeekToast(`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}s -> ${formatClock(targetTime)}`);
    if (seekToastTimerRef.current) window.clearTimeout(seekToastTimerRef.current);
    seekToastTimerRef.current = window.setTimeout(() => setSeekToast(""), 1000);
  };

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
    window.setTimeout(disableCaptions, 500);
  };

  const togglePlay = () => {
    if (!videoId) return;
    disableCaptions();
    if (isPlaying) {
      pauseVideo();
      setIsPlaying(false);
    } else {
      playVideo();
      setIsPlaying(true);
    }
    window.setTimeout(disableCaptions, 500);
  };

  const jumpBy = (seconds: number) => {
    const nextTime = Math.max(0, currentTimeRef.current + seconds);
    const nextPercent = clamp(nextTime / APPROX_DURATION_SECONDS, 0, 1);
    currentTimeRef.current = nextTime;
    setSeekPercent(nextPercent);
    seekTo(nextTime);
    showSeekToast(seconds, nextTime);
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
    showSeekToast(0, nextTime);
  };

  const touchDistance = (touches: React.TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const touchCenter = (touches: React.TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2
    };
  };

  const clampTranslate = (x: number, y: number, nextScale: number) => {
    const rect = videoStageRef.current?.getBoundingClientRect();
    if (!rect || nextScale <= 1) return { x: 0, y: 0 };

    const maxX = (rect.width * (nextScale - 1)) / 2;
    const maxY = (rect.height * (nextScale - 1)) / 2;
    return {
      x: clamp(x, -maxX, maxX),
      y: clamp(y, -maxY, maxY)
    };
  };

  const resetZoom = () => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
  };

  const onStageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    setSpeedMenuOpen(false);
    event.preventDefault();

    if (event.touches.length === 2) {
      const center = touchCenter(event.touches);
      touchRef.current = {
        x: 0,
        y: 0,
        startTime: currentTimeRef.current,
        distance: touchDistance(event.touches),
        scale,
        centerX: center.x,
        centerY: center.y,
        translateX,
        translateY,
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
      moved: false,
      pinching: false
    };
  };

  const onStageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current;
    if (!start) return;

    event.preventDefault();

    if (event.touches.length === 2 && start.distance && start.scale) {
      touchRef.current = { ...start, pinching: true };
      const center = touchCenter(event.touches);
      const nextScale = clamp(start.scale * (touchDistance(event.touches) / start.distance), 1, MAX_SCALE);
      const baseX = start.translateX ?? 0;
      const baseY = start.translateY ?? 0;
      const nextX = nextScale > 1 ? baseX + center.x - (start.centerX ?? center.x) : 0;
      const nextY = nextScale > 1 ? baseY + center.y - (start.centerY ?? center.y) : 0;
      const nextTranslate = clampTranslate(nextX, nextY, nextScale);
      setScale(nextScale);
      setTranslateX(nextTranslate.x);
      setTranslateY(nextTranslate.y);
      setDragDelta(null);
      return;
    }

    if (event.touches.length !== 1 || start.pinching) return;

    const touch = event.touches[0];
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioY = clamp((start.y - rect.top) / rect.height, 0, 1);
    const sensitivity = ratioY < 1 / 3 ? 0.2 : ratioY < 2 / 3 ? 0.05 : 0.01;
    const deltaX = touch.clientX - start.x;
    if (Math.abs(deltaX) > 4) {
      touchRef.current = { ...start, moved: true };
      setDragDelta(deltaX * sensitivity);
    }
  };

  const onStageTouchEnd = (event?: React.TouchEvent<HTMLDivElement>) => {
    const snapshot = touchRef.current;
    if (snapshot && !snapshot.pinching && dragDelta !== null) {
      const nextTime = Math.max(0, snapshot.startTime + dragDelta);
      currentTimeRef.current = nextTime;
      setSeekPercent(clamp(nextTime / APPROX_DURATION_SECONDS, 0, 1));
      seekTo(nextTime);
      showSeekToast(dragDelta, nextTime);
    } else if (snapshot && !snapshot.pinching && !snapshot.moved && event?.changedTouches[0]) {
      const touch = event.changedTouches[0];
      const now = Date.now();
      const previous = lastTapRef.current;
      if (
        previous &&
        now - previous.time < 300 &&
        Math.abs(previous.x - touch.clientX) < 42 &&
        Math.abs(previous.y - touch.clientY) < 42
      ) {
        resetZoom();
        lastTapRef.current = null;
      } else {
        lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
        setUiVisible((value) => !value);
      }
    }
    touchRef.current = null;
    setDragDelta(null);
  };

  return (
    <main className={`app-shell ${uiVisible ? "" : "ui-hidden"}`}>
      <header className="top-bar" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
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
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            loadVideo();
          }}
        >
          読込
        </button>
      </header>

      <section className="player-zone" aria-label="YouTube プレーヤー">
        <div className="video-stage" ref={videoStageRef} onDoubleClick={resetZoom}>
          <div
            className="videoTransformLayer"
            style={{
              transform: `translate(${translateX}px, ${translateY}px) scale(${scale}) ${mirrored ? "scaleX(-1)" : ""}`
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
                  applyPlaybackPreferences();
                  window.setTimeout(disableCaptions, 800);
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
          {(dragDelta !== null || seekToast) && (
            <p className="drag-delta">
              {dragDelta !== null
                ? `${dragDelta >= 0 ? "+" : ""}${dragDelta.toFixed(1)}s -> ${formatClock(Math.max(0, (touchRef.current?.startTime ?? currentTimeRef.current) + dragDelta))}`
                : seekToast}
            </p>
          )}
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

      <div className="seek-strip" aria-label="シークバー" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
        <button
          className="seek-track"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleSeek(event.clientX, event.currentTarget.getBoundingClientRect());
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            if (event.buttons === 1) handleSeek(event.clientX, event.currentTarget.getBoundingClientRect());
          }}
        >
          <span className="seek-fill" style={{ width: `${seekPercent * 100}%` }} />
          <span className="seek-thumb" style={{ left: `${seekPercent * 100}%` }} />
        </button>
      </div>

      <footer className="bottom-bar" aria-label="操作バー" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
        <button
          className="icon-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            jumpBy(-5);
          }}
          disabled={!videoId}
          aria-label="5秒戻る"
        >
          <SkipBack />
          <span>-5</span>
        </button>
        <button
          className="play-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            togglePlay();
          }}
          disabled={!videoId}
          aria-label="再生停止"
        >
          {isPlaying ? <Pause /> : <Play />}
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            jumpBy(5);
          }}
          disabled={!videoId}
          aria-label="5秒進む"
        >
          <SkipForward />
          <span>+5</span>
        </button>
        <button
          className={`icon-button ${mirrored ? "is-active" : ""}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setMirrored((value) => !value);
          }}
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
            onClick={(event) => {
              event.stopPropagation();
              setSpeedMenuOpen((value) => !value);
            }}
            disabled={!videoId}
            aria-label="速度"
          >
            <Gauge />
            <span>{speed}x</span>
          </button>
          {speedMenuOpen && (
            <div className="speed-popover" role="menu" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
              {SPEEDS.map((value) => (
                <button
                  className={speed === value ? "is-active" : ""}
                  type="button"
                  key={value}
                  onClick={(event) => {
                    event.stopPropagation();
                    changeSpeed(value);
                  }}
                >
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
