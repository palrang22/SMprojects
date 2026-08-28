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
  | { type: "error"; message: string }
  | { type: "ended"; message: string };

function liveUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/live`;
}

/** 웹캠 프레임 전송 주기 — 관상은 얼굴이 거의 정지라 2초면 충분하다 (프레임마다 과금) */
const FRAME_INTERVAL_MS = 2000;
const FRAME_WIDTH = 512;

export function VoiceStudio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const stopMicRef = useRef<(() => void) | null>(null);
  const lineIdRef = useRef(0);

  const previewRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  // 서버가 이제 손님 발화 자막만 보낸다. 턴이 끝나면 다음 발화를 새 줄로 시작하기 위한 플래그
  const newLineRef = useRef(false);
  const pendingTextRef = useRef<string | null>(null);

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

  // 페이지에 들어오면 웹캠을 바로 켠다 (미리보기만 — 전송은 시작 버튼 이후).
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        camStreamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          void previewRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setCamError("웹캠을 열 수 없습니다. 음성만으로도 진행됩니다.");
      });

    return () => {
      cancelled = true;
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    if (frameTimerRef.current !== null) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }

    stopMicRef.current?.();
    stopMicRef.current = null;

    playerRef.current?.close();
    playerRef.current = null;

    socketRef.current?.close();
    socketRef.current = null;

    pendingTextRef.current = null;
    setPhase("idle");
  }, []);

  // 페이지를 떠날 때 세션을 반드시 정리한다 (웹캠은 위 effect 가 따로 정리)
  useEffect(() => stop, [stop]);

  /** 한 발화의 자막 조각들은 뒤에 이어붙이고, 턴이 바뀌면 새 줄로 시작한다 */
  function appendTranscript(role: "user" | "model", text: string) {
    const startNew = newLineRef.current;
    newLineRef.current = false;
    setLines((prev) => {
      const last = prev.at(-1);
      if (!startNew && last?.role === role) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      lineIdRef.current += 1;
      return [...prev, { id: lineIdRef.current, role, text }];
    });
  }

  /** 웹캠 프레임을 다운스케일해서 JPEG 로 보낸다 */
  function startFrameStreaming(socket: WebSocket) {
    const sendFrame = () => {
      const video = previewRef.current;
      if (!video || !video.videoWidth || socket.readyState !== WebSocket.OPEN) return;

      const canvas = document.createElement("canvas");
      canvas.width = FRAME_WIDTH;
      canvas.height = Math.round(video.videoHeight * (FRAME_WIDTH / video.videoWidth));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const url = canvas.toDataURL("image/jpeg", 0.6);
      socket.send(
        JSON.stringify({ type: "video", data: url.slice(url.indexOf(",") + 1) }),
      );
    };

    sendFrame();
    frameTimerRef.current = window.setInterval(sendFrame, FRAME_INTERVAL_MS);
  }

  function sendChat() {
    const text = chatText.trim();
    if (!text || phase === "connecting") return;
    setChatText("");

    if (phase === "live" && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "text", text }));
      newLineRef.current = true;
      appendTranscript("user", text);
    } else if (phase === "idle") {
      // 아직 세션이 없으면 먼저 연결하고, 열리면 이 메시지를 보낸다
      pendingTextRef.current = text;
      void start();
    }
  }

  async function start() {
    if (phase !== "idle") return;
    setError(null);
    setNotice(null);
    setLines([]);
    newLineRef.current = false;
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
          case "turnComplete":
            // 턴 경계 — 다음 손님 발화는 새 줄로
            newLineRef.current = true;
            break;
          case "error":
            setError(msg.message);
            stop();
            break;
          case "ended":
            setNotice(msg.message);
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

      startFrameStreaming(socket);
      setPhase("live");

      if (pendingTextRef.current) {
        const text = pendingTextRef.current;
        pendingTextRef.current = null;
        socket.send(JSON.stringify({ type: "text", text }));
        newLineRef.current = true;
        appendTranscript("user", text);
      }
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
          <span className="c">Model — gemini-live-2.5-flash</span>
        </div>
        <h1>Voice Studio</h1>
        <p>AI 관상가에게 얼굴을 보여주고 관상을 물어보세요</p>
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

      {notice && (
        <div className="banner banner-warn">
          {notice}
          <button
            type="button"
            className="banner-close"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      )}

      <section className="composer">
        <div className="voice-cam-wrap">
          <video ref={previewRef} className="voice-cam" autoPlay playsInline muted />
          {phase === "live" && <span className="voice-cam-badge">● 관상 보는 중</span>}
        </div>
        {camError && <p className="person-cam-error">{camError}</p>}

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
            {phase === "idle" && "눌러서 관상 보기 시작"}
            {phase === "connecting" && "연결 중…"}
            {phase === "live" &&
              "「안녕하세요」 하고 말을 걸어보세요 (또는 아래에 입력)"}
          </span>
          {phase === "idle" && (
            <span className="hint-note">
              버튼을 누르고, 연결되면 얼굴을 화면에 맞추고 인사를 건네세요
            </span>
          )}
          {phase === "live" && (
            <span className="hint-note">세션은 5분 후 자동 종료됩니다</span>
          )}
        </div>

        <form
          className="chat-row"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
        >
          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="채팅으로 물어보기 (예: 제 재물운은 어때요?)"
            disabled={phase === "connecting" || health?.ready === false}
          />
          <button
            type="submit"
            disabled={
              !chatText.trim() ||
              phase === "connecting" ||
              health?.ready === false
            }
          >
            보내기
          </button>
        </form>

        {lines.length > 0 && (
          <div className="transcript">
            {lines.map((line) => (
              <p key={line.id} className={`line ${line.role}`}>
                <span className="who">
                  {line.role === "user" ? "나" : "관상가"}
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
