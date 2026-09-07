import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadQr } from "../components/DownloadQr.tsx";
import { readAsAttachment, type Attachment } from "../lib/image.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import "../styles/studio.css";

type JobStatus = "queued" | "running" | "completed" | "error";

type Job = {
  id: string;
  status: JobStatus;
  stage: string;
  createdAt: number;
  completedAt?: number;
  videoUrl?: string;
  downloadUrl?: string;
  downloadError?: string;
  interactionId?: string;
  /** 장면 확장 체인 전체 길이(초). 서버가 계산해서 내려준다 */
  totalSeconds?: number;
  error?: string;
  errorDetail?: string;
};

/** 생성 결과 한 건 = 프롬프트 하나 + 그 결과 영상 */
type Turn = {
  interactionId: string;
  prompt: string;
  videoUrl: string;
  downloadUrl?: string;
  downloadError?: string;
  /** 이 영상까지의 누적 길이(초) */
  totalSeconds: number;
};

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
  /** 서버가 실제로 호출하는 모델 ID. Vertex 와 API 키가 서로 다르다 */
  model?: string;
};

const ASPECT_RATIOS = ["16:9", "9:16"] as const;
/** 입력 이미지 장수 상한 — server/api.ts 의 MAX_IMAGES 와 같은 값 */
const MAX_IMAGES = 10;
/**
 * 장면 확장 상한. Omni 1.1 은 previous_interaction_id 로 앞 영상에 이어 붙이는데
 * 한 체인의 누적 길이가 40초를 넘을 수 없다 (한 번에 3~10초씩).
 */
const MAX_TOTAL_SECONDS = 40;
const MIN_DURATION = 3;
const RESOLUTIONS = ["360p", "720p", "1080p"] as const;

/**
 * 해상도별 초당 단가(USD).
 *
 * 출력 토큰이 해상도마다 다르다 — 360p 1,931 / 720p 5,792 / 1080p 8,688 토큰/초.
 * 720p 실측가 $0.10/초를 기준으로 토큰 비율만큼 환산한 값이다.
 * 정확한 청구액은 콘솔에서 확인할 것. 4k(17,376 토큰/초, 약 $0.30)는 부스에서
 * 비용이 튀므로 선택지에 넣지 않았다.
 */
const PRICE_PER_SECOND: Record<string, number> = {
  "360p": 0.033,
  "720p": 0.1,
  "1080p": 0.15,
};

const priceFor = (resolution: string, seconds: number) =>
  seconds * (PRICE_PER_SECOND[resolution] ?? 0.1);

const EXAMPLE_PROMPTS = [
  "네온 사인이 비에 젖은 도로에 반사되는 밤의 도쿄 골목, 카메라가 천천히 전진",
  "유리병 안에서 작은 우주가 소용돌이치는 모습, 매크로 렌즈, 얕은 심도",
  "눈 덮인 산맥 위로 해가 떠오르는 타임랩스, 시네마틱 와이드샷",
];

/** 길이 슬라이더 라벨 — 확장 모드면 붙인 뒤 총 길이도 같이 보여준다 */
function extendSuffix(extendFrom: Turn | null, duration: number): string {
  if (!extendFrom) return `길이 ${duration}초`;
  return `길이 ${duration}초 (총 ${extendFrom.totalSeconds + duration}초)`;
}

export function MotionStudio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [resolution, setResolution] = useState<string>("720p");
  const [duration, setDuration] = useState(5);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 서버가 준 원본 에러 전문 — 새 탭에서 보여준다 */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  /** 값이 있으면 새 영상이 아니라 그 영상을 이어서 늘리는 모드다 */
  const [extendFrom, setExtendFrom] = useState<Turn | null>(null);
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
              downloadUrl: next.downloadUrl,
              downloadError: next.downloadError,
              totalSeconds: next.totalSeconds ?? 0,
            },
          ]);
          setPrompt("");
          setAttachments([]);
          setExtendFrom(null);
        } else if (next.status === "error") {
          setError(next.error ?? "알 수 없는 오류");
          setErrorDetail(next.errorDetail ?? null);
        }
      } catch {
        if (!cancelled) {
          setError("서버와 통신하지 못했습니다");
          setErrorDetail("폴링 요청이 실패했습니다. dev 서버가 떠 있는지 확인하세요.");
        }
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
      setAttachments((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorDetail(err instanceof Error ? (err.stack ?? null) : String(err));
    }
  }, []);

  /** 확장 모드에서 이번 호출에 쓸 수 있는 최대 길이(초) */
  const remainingSeconds = extendFrom
    ? MAX_TOTAL_SECONDS - extendFrom.totalSeconds
    : 10;
  const maxDuration = Math.min(10, remainingSeconds);

  /** 그 영상을 이어서 늘리는 모드로 전환한다 */
  function startExtend(turn: Turn) {
    setExtendFrom(turn);
    // 앞 장면에 쓴 사진은 비운다. 확장에서 넣는 사진은 "새로 등장시킬 대상"이라
    // 역할이 다르다 (문서 「Extending with reference media」).
    setAttachments([]);
    setPrompt("");
    // 남은 길이보다 긴 값이 슬라이더에 남아 있으면 서버가 거부한다
    setDuration((d) =>
      Math.min(d, Math.min(10, MAX_TOTAL_SECONDS - turn.totalSeconds)),
    );
  }

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
          // 확장 모드면 앞 영상 뒤에 이어 붙인다
          previousInteractionId: extendFrom?.interactionId,
        }),
      });

      const data = (await res.json()) as {
        jobId?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.jobId) {
        setErrorDetail(data.detail ?? null);
        throw new Error(data.error ?? "요청이 거부되었습니다");
      }

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
          <span className="c">Model — {health?.model ?? "gemini-omni-1.1-flash"}</span>
        </div>
        <h1>Motion Studio</h1>
        <p>
          텍스트나 사진을 넣으면 움직이는 영상이 됩니다.{' '}
          <code>{health?.model ?? "gemini-omni-1.1-flash-preview"}</code>
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
        <ErrorBanner
          message={error}
          detail={errorDetail}
          context="01 Motion Studio"
          onClose={() => {
            setError(null);
            setErrorDetail(null);
          }}
        />
      )}

      {history.length > 0 && (
        <section className="timeline">
          {history.map((turn, i) => (
            <article key={turn.interactionId} className="turn">
              <div className="turn-meta">
                <span className="turn-index">#{i + 1}</span>
                <p>{turn.prompt}</p>
                {turn.totalSeconds > 0 && (
                  <span className="turn-length">
                    {turn.totalSeconds}초 / {MAX_TOTAL_SECONDS}초
                  </span>
                )}
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
                {MAX_TOTAL_SECONDS - turn.totalSeconds >= MIN_DURATION ? (
                  <button
                    type="button"
                    className="extend-cta"
                    onClick={() => startExtend(turn)}
                    disabled={busy}
                  >
                    ⏵ 이어서 늘리기
                  </button>
                ) : (
                  <span className="turn-maxed">최대 길이 도달</span>
                )}
                <code>{turn.interactionId}</code>
                <DownloadQr
                  url={turn.downloadUrl}
                  error={turn.downloadError}
                  context="01 Motion Studio · QR"
                />
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="composer">
        {extendFrom && (
          <div className="extend-bar">
            <span>
              <strong>이어서 늘리기</strong> — {extendFrom.totalSeconds}초 영상
              뒤에 붙입니다 (남은 길이 {remainingSeconds}초)
            </span>
            <button type="button" onClick={() => setExtendFrom(null)}>
              ✕ 새 영상으로
            </button>
          </div>
        )}

        <div className="composer-attach">
          <span className="hint">
            {extendFrom
              ? "이어질 장면을 설명하세요. 사진을 넣으면 새 인물·사물을 등장시킬 수 있습니다"
              : "텍스트만 입력하거나, 사진을 함께 올려보세요"}
          </span>
          <button
            type="button"
            className="attach-cta"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || attachments.length >= MAX_IMAGES}
          >
            🖼 사진 추가{" "}
            {attachments.length > 0 && `(${attachments.length}/${MAX_IMAGES})`}
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
        </div>

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

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder={extendFrom ? "이어서 어떤 장면이 나올지 설명하세요." : "만들고 싶은 영상을 설명하세요."}
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

        <div className="controls">
          <label>
            <span>비율</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              /* 확장은 원본 화면비를 따라가므로 고를 수 없다 */
              disabled={busy || Boolean(extendFrom)}
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
            <span>
              {extendSuffix(extendFrom, duration)}
            </span>
            <input
              type="range"
              min={MIN_DURATION}
              max={maxDuration}
              value={Math.min(duration, maxDuration)}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={busy}
            />
          </label>

          <span className="cost">
            ≈ ${priceFor(resolution, duration).toFixed(2)}
          </span>

          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !prompt.trim()}
          >
            {busy ? "생성 중…" : extendFrom ? "이어 붙이기" : "생성"}
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
