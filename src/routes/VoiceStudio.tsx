import { useCallback, useEffect, useRef, useState } from "react";
import { PcmPlayer, fromBase64, startMicCapture } from "../lib/audio.ts";
import "../styles/studio.css";

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
};

type Phase = "idle" | "connecting" | "live";

type Line = { id: number; role: "user" | "model"; text: string };

type ServerMessage =
  | { type: "ready" }
  | { type: "audio"; data: string }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "transcript"; role: "user" | "model"; text: string }
  | { type: "error"; message: string };

function liveUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/live`;
}

export function VoiceStudio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const stopMicRef = useRef<(() => void) | null>(null);
  const lineIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: Health) => setHealth(d))
      .catch(() =>
        setHealth({
          ready: false,
          mode: "unconfigured",
          detail: "서버에 연결하지 못했습니다",
        }),
      );
  }, []);

  const stop = useCallback(() => {
    stopMicRef.current?.();
    stopMicRef.current = null;

    playerRef.current?.close();
    playerRef.current = null;

    socketRef.current?.close();
    socketRef.current = null;

    setPhase("idle");
  }, []);

  // 페이지를 떠날 때 마이크와 세션을 반드시 정리한다 (비용·프라이버시 모두)
  useEffect(() => stop, [stop]);

  /** 같은 화자가 이어 말하면 줄을 새로 만들지 않고 뒤에 붙인다 */
  function appendTranscript(role: "user" | "model", text: string) {
    setLines((prev) => {
      const last = prev.at(-1);
      if (last?.role === role) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      lineIdRef.current += 1;
      return [...prev, { id: lineIdRef.current, role, text }];
    });
  }

  async function start() {
    if (phase !== "idle") return;
    setError(null);
    setPhase("connecting");

    const player = new PcmPlayer();
    playerRef.current = player;

    try {
      // 버튼 클릭(사용자 제스처) 안에서 열어야 자동재생 정책에 막히지 않는다
      await player.unlock();

      const socket = new WebSocket(liveUrl());
      socketRef.current = socket;

      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        switch (msg.type) {
          case "audio":
            player.play(fromBase64(msg.data));
            break;
          case "interrupted":
            player.flush();
            break;
          case "transcript":
            appendTranscript(msg.role, msg.text);
            break;
          case "error":
            setError(msg.message);
            stop();
            break;
        }
      };

      socket.onerror = () => {
        setError("음성 서버에 연결하지 못했습니다");
        stop();
      };
      socket.onclose = () => stop();

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        setTimeout(() => reject(new Error("연결 시간이 초과되었습니다")), 10000);
      });

      stopMicRef.current = await startMicCapture((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "audio", data }));
        }
      });

      setPhase("live");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "마이크를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.",
      );
      stop();
    }
  }

  return (
    <main className="studio audio">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">03 — Audio</span>
          <span className="c">Model — gemini-live-2.5-flash-native-audio</span>
        </div>
        <h1>Voice Studio</h1>
        <p>AI에게 말을 걸고 실시간으로 대화해보세요</p>
      </header>

      {health && !health.ready && (
        <div className="banner banner-warn">
          <strong>인증이 설정되지 않았습니다.</strong> {health.detail}
        </div>
      )}

      {error && (
        <div className="banner banner-error">
          <strong>오류</strong> {error}
          <button
            type="button"
            className="banner-close"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      <section className="composer">
        <div className={`mic ${phase}`}>
          <button
            type="button"
            className="mic-button"
            onClick={() => (phase === "idle" ? void start() : stop())}
            disabled={phase === "connecting" || health?.ready === false}
          >
            {phase === "live" ? "■" : "●"}
          </button>
          <span className="mic-state">
            {phase === "idle" && "눌러서 대화 시작"}
            {phase === "connecting" && "연결 중…"}
            {phase === "live" && "듣고 있습니다 — 그냥 말하세요"}
          </span>
          {phase === "live" && (
            <span className="hint-note">세션은 3분 후 자동 종료됩니다</span>
          )}
        </div>

        {lines.length > 0 && (
          <div className="transcript">
            {lines.map((line) => (
              <p key={line.id} className={`line ${line.role}`}>
                <span className="who">
                  {line.role === "user" ? "나" : "Gemini"}
                </span>
                {line.text}
              </p>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
