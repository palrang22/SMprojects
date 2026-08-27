import { useCallback, useEffect, useRef, useState } from "react";
import { readAsAttachment, type Attachment } from "../lib/image.ts";
import "../styles/studio.css";

type JobStatus = "queued" | "running" | "completed" | "error";

type Job = {
  id: string;
  status: JobStatus;
  stage: string;
  createdAt: number;
  completedAt?: number;
  videoUrl?: string;
  interactionId?: string;
  error?: string;
};

/** 생성 결과 한 건 = 프롬프트 하나 + 그 결과 영상 */
type Turn = {
  interactionId: string;
  prompt: string;
  videoUrl: string;
};

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
};

const ASPECT_RATIOS = ["16:9", "9:16"] as const;
const RESOLUTIONS = ["720p", "1080p"] as const;
const PRICE_PER_SECOND = 0.1; // USD, 2026-08 기준 preview 가격

const EXAMPLE_PROMPTS = [
  "네온 사인이 비에 젖은 도로에 반사되는 밤의 도쿄 골목, 카메라가 천천히 전진",
  "유리병 안에서 작은 우주가 소용돌이치는 모습, 매크로 렌즈, 얕은 심도",
  "눈 덮인 산맥 위로 해가 떠오르는 타임랩스, 시네마틱 와이드샷",
];

export function MotionStudio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [resolution, setResolution] = useState<string>("720p");
  const [duration, setDuration] = useState(5);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = job?.status === "queued" || job?.status === "running";

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

  // 진행 중일 때만 경과 시간을 센다. job.createdAt 은 폴링 사이에도 안 바뀌므로
  // 의존성으로 써도 인터벌이 매번 재생성되지 않는다.
  const startedAt = job?.createdAt;
  useEffect(() => {
    if (!busy || !startedAt) return;
    const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000));
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [busy, startedAt]);

  // 잡 상태 폴링 — 완료/실패면 멈춘다
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`);
        const next = (await res.json()) as Job;
        if (cancelled) return;

        setJob(next);

        if (
          next.status === "completed" &&
          next.videoUrl &&
          next.interactionId
        ) {
          setHistory((prev) => [
            ...prev,
            {
              interactionId: next.interactionId!,
              prompt,
              videoUrl: next.videoUrl!,
            },
          ]);
          setPrompt("");
          setAttachments([]);
        } else if (next.status === "error") {
          setError(next.error ?? "알 수 없는 오류");
        }
      } catch {
        if (!cancelled) setError("서버와 통신하지 못했습니다");
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job, prompt]);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const next = await Promise.all(
        Array.from(files)
          .filter((f) => f.type.startsWith("image/"))
          .map(readAsAttachment),
      );
      setAttachments((prev) => [...prev, ...next].slice(0, 3));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  async function submit() {
    if (!prompt.trim() || busy) return;
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          images: attachments.map(({ data, mimeType }) => ({ data, mimeType })),
          aspectRatio,
          resolution,
          durationSeconds: duration,
        }),
      });

      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId)
        throw new Error(data.error ?? "요청이 거부되었습니다");

      setJob({
        id: data.jobId,
        status: "queued",
        stage: "대기 중",
        createdAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="studio video">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">01 — Video</span>
          <span className="c">Model — gemini-omni-flash-preview</span>
        </div>
        <h1>Motion Studio</h1>
        <p>
          텍스트나 사진을 넣고 10초 이내의 영상을 만들어보세요
        </p>
      </header>

      {health && !health.ready && (
        <div className="banner banner-warn">
          <strong>인증이 설정되지 않았습니다.</strong> {health.detail}
          <br />
          <code>.env.example</code> 를 참고해 <code>.env.local</code> 을 만든 뒤{" "}
          <code>pnpm dev</code> 를 재시작하세요.
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

      {history.length > 0 && (
        <section className="timeline">
          {history.map((turn, i) => (
            <article key={turn.interactionId} className="turn">
              <div className="turn-meta">
                <span className="turn-index">#{i + 1}</span>
                <p>{turn.prompt}</p>
              </div>
              <video
                src={turn.videoUrl}
                controls
                playsInline
                className="turn-video"
              />
              <div className="turn-actions">
                <a href={turn.videoUrl} download>
                  ⬇ 다운로드
                </a>
                <code>{turn.interactionId}</code>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="composer">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="만들고 싶은 영상을 설명하세요. (⌘+Enter 로 생성)"
          rows={3}
          disabled={busy}
        />

        {!prompt && (
          <div className="examples">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button key={ex} type="button" onClick={() => setPrompt(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a) => (
              <div key={a.id} className="attachment">
                <img src={a.preview} alt={a.name} />
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((p) => p.filter((x) => x.id !== a.id))
                  }
                  aria-label={`${a.name} 제거`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="controls">
          <label>
            <span>비율</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              disabled={busy}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>해상도</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              disabled={busy}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="duration">
            <span>길이 {duration}초</span>
            <input
              type="range"
              min={3}
              max={10}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={busy}
            />
          </label>

          <button
            type="button"
            className="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || attachments.length >= 3}
          >
            🖼 이미지 {attachments.length > 0 && `(${attachments.length}/3)`}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <span className="cost">
            ≈ ${(duration * PRICE_PER_SECOND).toFixed(2)}
          </span>

          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !prompt.trim()}
          >
            {busy ? "생성 중…" : "생성"}
          </button>
        </div>

        {busy && (
          <div className="progress">
            <span className="spinner" />
            <span>{job?.stage}</span>
            <span className="elapsed">{elapsed}초 경과</span>
          </div>
        )}
      </section>
    </main>
  );
}
