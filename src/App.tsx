import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlipHorizontal2, Gauge, Pause, Play, ScanSearch, SkipBack, SkipForward, X } from "lucide-react";

const STORAGE_KEY = "furi-practice-player-state";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const DOUBLE_TAP_JUMP_SECONDS = 0.5;
const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";
const QUALITY_PRIORITY = ["highres", "hd2160", "hd1440", "hd1080", "hd720"];

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
      reject(new Error("YouTube IFrame Player API の読み込みがタイムアウトしました。"));
      youtubeApiPromise = null;
    }, 12000);

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timeoutId);
      if (window.YT?.Player) {
        console.log("YT API loaded");
        resolve(window.YT);
        return;
      }
      reject(new Error("YouTube IFrame Player API は読み込まれましたが、window.YT が undefined です。"));
      youtubeApiPromise = null;
    };

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${YOUTUBE_API_SRC}"]`);
    if (existingScript) {
      existingScript.addEventListener("error", () => {
        window.clearTimeout(timeoutId);
        youtubeApiPromise = null;
        reject(new Error("YouTube IFrame Player API script の読み込みに失敗しました。"));
      });
      return;
    }

    if (!document.querySelector(`script[src="${YOUTUBE_API_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = YOUTUBE_API_SRC;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeoutId);
        youtubeApiPromise = null;
        reject(new Error("YouTube IFrame Player API script の読み込みに失敗しました。"));
      };
      document.head.appendChild(script);
    }
  });

  return youtubeApiPromise;
}

function playerErrorMessage(code: number) {
  if (code === 2) return "動画IDが正しくない可能性があります。URLを確認してください。";
  if (code === 5) return "この動画は現在のブラウザ環境では再生できない形式の可能性があります。";
  if (code === 100) return "動画が見つかりません。削除済み、非公開、またはURLが違う可能性があります。";
  if (code === 101 || code === 150) {
    return "この動画は外部サイトでの再生が許可されていない可能性があります。YouTubeで直接開いて確認してください。";
  }
  return `YouTube動画の読み込みに失敗しました。エラーコード: ${code}`;
}

function selectBestQuality(availableLevels: string[]) {
  return QUALITY_PRIORITY.find((quality) => availableLevels.includes(quality)) ?? availableLevels[0] ?? "hd1080";
}

function applyBestPlaybackQuality(player: YT.Player) {
  if (
    typeof player.setPlaybackQuality !== "function" ||
    typeof player.getAvailableQualityLevels !== "function" ||
    typeof player.getPlaybackQuality !== "function"
  ) {
    console.log("playback quality API unavailable", player);
    return;
  }

  const availableLevels = player.getAvailableQualityLevels?.() ?? [];
  const selectedQuality = selectBestQuality(availableLevels);

  for (const quality of QUALITY_PRIORITY) {
    player.setPlaybackQuality(quality);
  }
  player.setPlaybackQuality(selectedQuality);

  window.setTimeout(() => {
    console.log("available quality levels", player.getAvailableQualityLevels?.() ?? []);
    console.log("selected playback quality", selectedQuality);
    console.log("actual playback quality", player.getPlaybackQuality?.() ?? "unknown");
  }, 500);
}

function isYouTubePlayer(value: unknown): value is YT.Player {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as YT.Player).loadVideoById === "function" &&
    typeof (value as YT.Player).destroy === "function"
  );
}

function getSafeCurrentTime(player: YT.Player | null, fallback: number) {
  if (!isYouTubePlayer(player) || typeof player.getCurrentTime !== "function") return fallback;
  return player.getCurrentTime() ?? fallback;
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

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerMountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const pendingVideoIdRef = useRef(videoId);
  const playerReadyRef = useRef(false);
  const creatingPlayerRef = useRef(false);
  const playerGenerationRef = useRef(0);
  const latestVideoIdRef = useRef(videoId);
  const latestSpeedRef = useRef(speed);
  const touchRef = useRef<TouchSnapshot | null>(null);
  const dragStartedRef = useRef(false);
  const tapTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const longPressRef = useRef<{ timer: number | null; used: boolean }>({ timer: null, used: false });
  const playerElementId = "youtube-player";

  const validLoop = pointA !== null && pointB !== null && pointB > pointA;
  useEffect(() => {
    latestVideoIdRef.current = videoId;
    pendingVideoIdRef.current = videoId;
  }, [videoId]);

  useEffect(() => {
    latestSpeedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const nextState: SavedState = { url, videoId, mirrored, scale, speed, pointA, pointB };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [url, videoId, mirrored, scale, speed, pointA, pointB]);

  const destroyPlayer = useCallback(() => {
    const existingPlayer = playerRef.current;
    if (existingPlayer && typeof existingPlayer.destroy === "function") {
      existingPlayer.destroy();
    }
    playerRef.current = null;
    playerReadyRef.current = false;
    setPlayerReady(false);
    creatingPlayerRef.current = false;
    playerGenerationRef.current += 1;
    playerMountRef.current = null;

    if (playerHostRef.current) {
      playerHostRef.current.replaceChildren();
    }
  }, []);

  const safeLoadVideo = useCallback((nextVideoId: string) => {
    const player = playerRef.current;
    console.log("playerRef.current", player);
    console.log("typeof loadVideoById", typeof player?.loadVideoById);

    if (!isYouTubePlayer(player) || !playerReadyRef.current || typeof player.loadVideoById !== "function") {
      pendingVideoIdRef.current = nextVideoId;
      setStatusMessage("動画プレーヤーを準備中...");
      return false;
    }

    setStatusMessage("");
    setErrorMessage("");
    player.loadVideoById(nextVideoId);
    window.setTimeout(() => applyBestPlaybackQuality(player), 900);
    return true;
  }, []);

  const createPlayer = useCallback((initialVideoId: string) => {
    if (!window.YT?.Player || !playerHostRef.current || creatingPlayerRef.current) return playerRef.current;
    if (isYouTubePlayer(playerRef.current)) return playerRef.current;

    if (playerRef.current) {
      destroyPlayer();
    }
    creatingPlayerRef.current = true;
    pendingVideoIdRef.current = initialVideoId;
    const generation = playerGenerationRef.current;

    const mount = document.createElement("div");
    mount.id = playerElementId;
    playerHostRef.current.appendChild(mount);
    playerMountRef.current = mount;

    const player = new YT.Player(mount, {
      width: "100%",
      height: "100%",
      videoId: undefined,
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        controls: 0,
        fs: 0,
        iv_load_policy: 3,
        disablekb: 1,
        vq: "hd1080",
        origin: window.location.origin
      },
      events: {
        onReady: (event) => {
          if (generation !== playerGenerationRef.current) return;
          console.log("player ready");
          playerRef.current = event.target;
          playerReadyRef.current = true;
          setPlayerReady(true);
          creatingPlayerRef.current = false;
          console.log("playerRef.current", playerRef.current);
          console.log("typeof loadVideoById", typeof playerRef.current?.loadVideoById);
          event.target.setPlaybackRate(latestSpeedRef.current);
          applyBestPlaybackQuality(event.target);
          setDuration(event.target.getDuration() || 0);
          setStatusMessage("");
          setErrorMessage("");

          const pendingVideoId = pendingVideoIdRef.current || latestVideoIdRef.current;
          if (pendingVideoId && typeof event.target.loadVideoById === "function") {
            console.log("loading pending videoId on ready", pendingVideoId);
            event.target.loadVideoById(pendingVideoId);
            window.setTimeout(() => applyBestPlaybackQuality(event.target), 900);
          }
        },
        onStateChange: (event) => {
          if (generation !== playerGenerationRef.current) return;
          setIsPlaying(event.data === YT.PlayerState.PLAYING);
        },
        onError: (event) => {
          if (generation !== playerGenerationRef.current) return;
          console.log("player error code", event.data);
          setStatusMessage("");
          setErrorMessage(playerErrorMessage(event.data));
        }
      }
    });

    playerRef.current = player;
    console.log("playerRef.current", playerRef.current);
    console.log("typeof loadVideoById", typeof playerRef.current?.loadVideoById);
    return playerRef.current;
  }, [destroyPlayer]);

  useEffect(() => {
    let disposed = false;

    loadYouTubeApi().then(() => {
      if (disposed || playerRef.current) return;
      createPlayer(latestVideoIdRef.current);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "YouTube IFrame Player API の読み込みに失敗しました。";
      console.log("YT API load error", message);
      setStatusMessage("");
      setErrorMessage(message);
    });

    return () => {
      disposed = true;
    };
  }, [createPlayer]);

  useEffect(() => {
    if (playerReady && videoId) {
      safeLoadVideo(videoId);
    }
  }, [playerReady, safeLoadVideo, videoId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (
        !isYouTubePlayer(player) ||
        typeof player.getCurrentTime !== "function" ||
        typeof player.getDuration !== "function"
      ) {
        return;
      }

      const time = player.getCurrentTime() || 0;
      const length = player.getDuration() || 0;
      setCurrentTime(time);
      setDuration(length);

      if (validLoop && pointA !== null && pointB !== null && time >= pointB) {
        if (typeof player.seekTo === "function") player.seekTo(pointA, true);
        if (typeof player.playVideo === "function") player.playVideo();
      }
    }, 80);

    return () => window.clearInterval(timer);
  }, [pointA, pointB, validLoop]);

  useEffect(() => {
    const player = playerRef.current;
    if (isYouTubePlayer(player) && typeof player.setPlaybackRate === "function") {
      player.setPlaybackRate(speed);
    }
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
      const player = playerRef.current;
      if (isYouTubePlayer(player) && typeof player.seekTo === "function" && playerReadyRef.current) {
        player.seekTo(safeTime, true);
      }
      setCurrentTime(safeTime);
    },
    [duration]
  );

  const jump = useCallback(
    (delta: number) => {
      seekTo(getSafeCurrentTime(playerRef.current, currentTime) + delta);
    },
    [currentTime, seekTo]
  );

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!isYouTubePlayer(player) || !playerReadyRef.current || !videoId) {
      setStatusMessage("動画プレーヤーを準備中...");
      return;
    }

    if (isPlaying) {
      if (typeof player.pauseVideo === "function") player.pauseVideo();
      return;
    }

    if (validLoop && pointA !== null && currentTime >= (pointB ?? Infinity)) {
      if (typeof player.seekTo === "function") player.seekTo(pointA, true);
    }
    if (typeof player.playVideo === "function") player.playVideo();
  }, [currentTime, isPlaying, pointA, pointB, validLoop, videoId]);

  const loadVideo = useCallback(async () => {
    const nextId = extractVideoId(url);
    console.log("extracted videoId", nextId);

    if (!nextId) {
      setStatusMessage("");
      setErrorMessage("YouTube URL または動画 ID を入力してください。");
      return;
    }

    pendingVideoIdRef.current = nextId;
    setVideoId(nextId);
    setCurrentTime(0);
    setDuration(0);
    setErrorMessage("");
    setStatusMessage("動画プレーヤーを準備中...");

    try {
      await loadYouTubeApi();
      const player = isYouTubePlayer(playerRef.current) ? playerRef.current : createPlayer(nextId);
      if (isYouTubePlayer(player) && typeof player.setPlaybackRate === "function") {
        player.setPlaybackRate(latestSpeedRef.current);
      }
      safeLoadVideo(nextId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube IFrame Player API の読み込みに失敗しました。";
      console.log("YT API load error", message);
      setStatusMessage("");
      setErrorMessage(message);
    }
  }, [createPlayer, safeLoadVideo, url]);

  const setLoopPoint = (side: "A" | "B") => {
    const time = getSafeCurrentTime(playerRef.current, currentTime);
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
      time: getSafeCurrentTime(playerRef.current, currentTime)
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
            if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
            tapTimerRef.current = null;
            lastTapRef.current = null;
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
            <div ref={playerHostRef} className="youtube-player-host" />
          </div>

          {!videoId && (
            <div className="empty-state">
              <ScanSearch size={42} />
              <p>YouTube URL を入力して練習を始める</p>
            </div>
          )}

          {statusMessage && <p className="status-message">{statusMessage}</p>}
          {errorMessage && <p className="notice">{errorMessage}</p>}

          <div className="gesture-layer" aria-hidden="true" />
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
