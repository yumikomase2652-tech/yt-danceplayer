import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlipHorizontal2, Gauge, Pause, Play, ScanSearch, SkipBack, SkipForward, X } from "lucide-react";

const STORAGE_KEY = "furi-practice-player-state";
const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

let youtubeApiPromise: Promise<typeof YT> | null = null;

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

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<typeof YT>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      youtubeApiPromise = null;
      reject(new Error("YouTube Player API の読み込みに失敗しました。"));
    }, 10000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      if (window.YT?.Player) {
        console.log("YT API loaded");
        resolve(window.YT);
        return;
      }
      youtubeApiPromise = null;
      reject(new Error("YouTube Player API の準備に失敗しました。"));
    };

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${YOUTUBE_API_SRC}"]`);
    if (existingScript) return;

    const script = document.createElement("script");
    script.src = YOUTUBE_API_SRC;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      youtubeApiPromise = null;
      reject(new Error("YouTube Player API script の読み込みに失敗しました。"));
    };
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

function isPlayerReady(player: YT.Player | null): player is YT.Player {
  return (
    player !== null &&
    typeof player.playVideo === "function" &&
    typeof player.pauseVideo === "function" &&
    typeof player.seekTo === "function" &&
    typeof player.loadVideoById === "function" &&
    typeof player.getCurrentTime === "function" &&
    typeof player.getDuration === "function"
  );
}

function playerErrorMessage(code: number) {
  if (code === 101 || code === 150) return "この動画は外部サイトでの再生が許可されていない可能性があります。";
  if (code === 100) return "動画が見つかりません。削除済み、非公開、またはURLが違う可能性があります。";
  return `YouTube Player API でエラーが発生しました。コード: ${code}`;
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
  const [playerReady, setPlayerReady] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const playerRef = useRef<YT.Player | null>(null);
  const playerMountRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<TouchSnapshot | null>(null);
  const creatingPlayerRef = useRef(false);
  const latestSpeedRef = useRef(speed);
  const latestVideoIdRef = useRef(videoId);

  const controlsDisabled = true;

  useEffect(() => {
    const nextState: SavedState = { url, videoId, mirrored, scale, speed, pointA, pointB };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [url, videoId, mirrored, scale, speed, pointA, pointB]);

  useEffect(() => {
    latestSpeedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    latestVideoIdRef.current = videoId;
  }, [videoId]);

  const createPlayer = useCallback(async (nextVideoId: string) => {
    if (!playerMountRef.current || creatingPlayerRef.current || isPlayerReady(playerRef.current)) return;

    creatingPlayerRef.current = true;
    setStatusMessage("操作機能を準備中...");

    try {
      await loadYouTubeApi();
      if (!playerMountRef.current || isPlayerReady(playerRef.current)) return;

      playerRef.current = new YT.Player(playerMountRef.current, {
        width: "100%",
        height: "100%",
        videoId: nextVideoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          controls: 0,
          fs: 0,
          iv_load_policy: 3,
          disablekb: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event) => {
            console.log("player ready");
            playerRef.current = event.target;
            setPlayerReady(true);
            setStatusMessage("");
            setErrorMessage("");
            event.target.setPlaybackRate(latestSpeedRef.current);
            const readyVideoId = latestVideoIdRef.current || nextVideoId;
            if (readyVideoId && typeof event.target.loadVideoById === "function") {
              event.target.loadVideoById(readyVideoId);
            }
          },
          onStateChange: (event) => {
            setIsPlaying(event.data === YT.PlayerState.PLAYING);
          },
          onError: (event) => {
            console.log("player error code", event.data);
            setPlayerReady(false);
            setStatusMessage("");
            setErrorMessage(playerErrorMessage(event.data));
          }
        }
      });
    } catch (error) {
      console.log("YT API error", error);
      setPlayerReady(false);
      setStatusMessage("");
      setErrorMessage(error instanceof Error ? error.message : "YouTube Player API の初期化に失敗しました。");
    } finally {
      creatingPlayerRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!videoId) return;

    const player = playerRef.current;
    if (isPlayerReady(player) && playerReady) {
      player.loadVideoById(videoId);
      player.setPlaybackRate(latestSpeedRef.current);
      return;
    }

    createPlayer(videoId);
  }, [createPlayer, playerReady, videoId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!isPlayerReady(player) || !playerReady) return;

      setCurrentTime(player.getCurrentTime() || 0);
      setDuration(player.getDuration() || 0);
    }, 250);

    return () => window.clearInterval(timer);
  }, [playerReady]);

  const loadVideo = () => {
    const nextId = extractVideoId(url);
    console.log("extracted videoId", nextId);

    if (!nextId) {
      setStatusMessage("");
      setErrorMessage("YouTube URL または動画 ID を入力してください。");
      return;
    }

    setVideoId(nextId);
    setCurrentTime(0);
    setDuration(0);
    setStatusMessage("動画を読み込んでいます...");
    setErrorMessage("");
  };

  const requireReady = () => {
    if (!controlsDisabled) return true;
    setStatusMessage("第1段階では動画表示を優先しています。操作機能は次の段階で戻します。");
    return false;
  };

  const togglePlay = () => {
    if (!requireReady()) return;
    const player = playerRef.current!;
    if (isPlaying) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  };

  const jump = (seconds: number) => {
    if (!requireReady()) return;
    const player = playerRef.current!;
    player.seekTo(Math.max(0, (player.getCurrentTime() || 0) + seconds), true);
  };

  const changeSpeed = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    setSpeedMenuOpen(false);
    const player = playerRef.current;
    if (isPlayerReady(player) && playerReady) {
      player.setPlaybackRate(nextSpeed);
    } else {
      setStatusMessage("速度変更は操作機能の準備後に反映されます。");
    }
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
        y: 0,
        time: currentTime,
        distance: touchDistance(event.touches),
        scale
      };
      return;
    }

    touchRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      time: currentTime
    };
  };

  const onStageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current;
    if (!start) return;
    event.preventDefault();

    if (event.touches.length === 2 && start.distance && start.scale) {
      setScale(clamp(start.scale * (touchDistance(event.touches) / start.distance), 1, 3));
      return;
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
        <div className="video-stage">
          <div
            className="videoTransformLayer"
            style={{
              transform: `scale(${scale}) ${mirrored ? "scaleX(-1)" : ""}`
            }}
          >
            <div className={`player-mount ${playerReady ? "is-ready" : ""}`} ref={playerMountRef} />
          </div>

          {playerReady && (
            <div
              className="gesture-layer is-enabled"
              aria-hidden="true"
              onTouchStart={onStageTouchStart}
              onTouchMove={onStageTouchMove}
              onTouchEnd={onStageTouchEnd}
            />
          )}

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
        <button className="icon-button" type="button" onClick={() => jump(-5)} disabled={controlsDisabled} aria-label="5秒戻る">
          <SkipBack />
          <span>-5</span>
        </button>
        <button className="play-button" type="button" onClick={togglePlay} disabled={controlsDisabled} aria-label="再生停止">
          {isPlaying ? <Pause /> : <Play />}
        </button>
        <button className="icon-button" type="button" onClick={() => jump(5)} disabled={controlsDisabled} aria-label="5秒進む">
          <SkipForward />
          <span>+5</span>
        </button>
        <button
          className={`icon-button ${mirrored ? "is-active" : ""}`}
          type="button"
          onClick={() => setMirrored((value) => !value)}
          disabled={controlsDisabled}
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
            disabled={controlsDisabled}
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
        <button
          className={`text-button ${pointA !== null ? "has-point" : ""}`}
          type="button"
          onClick={() => setPointA(currentTime)}
          disabled={controlsDisabled}
          aria-label="A点"
        >
          A
        </button>
        <button
          className={`text-button ${pointB !== null ? "has-point" : ""}`}
          type="button"
          onClick={() => setPointB(currentTime)}
          disabled={controlsDisabled}
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
          disabled={controlsDisabled}
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
