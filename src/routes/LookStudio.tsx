import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DownloadQr } from "../components/DownloadQr.tsx";
import {
  attachmentFromBase64,
  attachmentFromUrl,
  readAsAttachment,
  type Attachment,
} from "../lib/image.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import "../styles/studio.css";

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
};

type ResultImage = {
  data: string;
  mimeType: string;
  downloadUrl?: string;
  downloadError?: string;
};

const dataUrl = (img: ResultImage) => `data:${img.mimeType};base64,${img.data}`;

/** 샘플 인물 — 파일은 public/samples/<id>.png 에 둔다 (3열 × 2행) */
const SAMPLE_PEOPLE = [
  { id: "woman_1", label: "여성 1" },
  { id: "woman_2", label: "여성 2" },
  { id: "woman_3", label: "여성 3" },
  { id: "man_1", label: "남성 1" },
  { id: "man_2", label: "남성 2" },
  { id: "man_3", label: "남성 3" },
] as const;

const sampleSrc = (id: string) => `/samples/human/${id}.png`;

/** 샘플 인물을 3×2 그리드로 크게 보여주는 팝업 */
function SampleModal({
  onPick,
  onClose,
}: {
  onPick: (a: Attachment) => void;
  onClose: () => void;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function choose(id: string, label: string) {
    setErr(null);
    setLoadingId(id);
    try {
      onPick(await attachmentFromUrl(sampleSrc(id), `${label}.png`));
    } catch {
      setErr(`${label} 샘플을 불러오지 못했습니다 — public/samples/${id}.png 를 확인하세요`);
      setLoadingId(null);
    }
  }

  return createPortal(
    <div className="sample-modal" onClick={onClose}>
      <div
        className="sample-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="샘플 인물 선택"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sample-modal-head">
          <h2>샘플 인물 선택</h2>
          <button
            type="button"
            className="sample-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="sample-grid">
          {SAMPLE_PEOPLE.map((s) => (
            <button
              key={s.id}
              type="button"
              className="sample-cell"
              onClick={() => void choose(s.id, s.label)}
              disabled={loadingId !== null}
            >
              <img
                src={sampleSrc(s.id)}
                alt={s.label}
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
              <span>{loadingId === s.id ? "불러오는 중…" : s.label}</span>
            </button>
          ))}
        </div>
        {err && <p className="person-cam-error">{err}</p>}
      </div>
    </div>,
    document.body,
  );
}

/** 인물 입력 — [샘플에서 고르기] / [사진 찍기] / [파일 업로드] */
function PersonPicker({
  value,
  onPick,
  onClear,
  disabled,
}: {
  value: Attachment | null;
  onPick: (a: Attachment) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [view, setView] = useState<"idle" | "camera">("idle");
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(file: File) {
    setCamError(null);
    try {
      onPick(await readAsAttachment(file));
    } catch (err) {
      setCamError(err instanceof Error ? err.message : "사진을 읽지 못했습니다");
    }
  }

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // 언마운트 시 카메라 정리
  useEffect(() => stopCamera, [stopCamera]);

  // 카메라 뷰로 바뀌면 <video> 가 이제 마운트됐으니 스트림을 붙인다
  useEffect(() => {
    if (view !== "camera") return;
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => {});
    }
  }, [view]);

  async function openCamera() {
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError("이 브라우저에서는 카메라를 쓸 수 없습니다 (HTTPS 필요)");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      setView("camera");
    } catch (err) {
      setCamError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "카메라 권한이 거부되었습니다"
          : "카메라를 열지 못했습니다",
      );
    }
  }

  function closeCamera() {
    stopCamera();
    setView("idle");
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    onPick(
      attachmentFromBase64(url.slice(url.indexOf(",") + 1), "image/jpeg", "촬영.jpg"),
    );
    closeCamera();
  }

  if (value) {
    return (
      <div className="slot filled">
        <span className="slot-label">인물</span>
        <img src={value.preview} alt="선택한 인물" />
        <button
          type="button"
          className="slot-clear"
          onClick={onClear}
          disabled={disabled}
          aria-label="인물 제거"
        >
          ✕
        </button>
      </div>
    );
  }

  if (view === "camera") {
    return (
      <div className="slot">
        <span className="slot-label">인물 — 촬영</span>
        <video ref={videoRef} className="slot-cam" autoPlay playsInline muted />
        <div className="slot-cam-actions">
          <button type="button" className="shoot" onClick={capture}>
            촬영
          </button>
          <button type="button" onClick={closeCamera}>
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slot">
      <span className="slot-label">인물</span>
      <div className="person-choices">
        <button
          type="button"
          className="person-choice"
          onClick={() => setSamplesOpen(true)}
          disabled={disabled}
        >
          <span className="ico">👥</span>
          샘플에서 고르기
        </button>
        <button
          type="button"
          className="person-choice"
          onClick={() => void openCamera()}
          disabled={disabled}
        >
          <span className="ico">📷</span>
          사진 찍기
        </button>
        <button
          type="button"
          className="person-choice"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <span className="ico">＋</span>
          파일 업로드
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {camError && <p className="person-cam-error">{camError}</p>}
      {samplesOpen && (
        <SampleModal
          onClose={() => setSamplesOpen(false)}
          onPick={(a) => {
            onPick(a);
            setSamplesOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** 의상 사진을 하나 받는 업로드 슬롯 */
function Slot({
  label,
  hint,
  value,
  onPick,
  onClear,
  disabled,
}: {
  label: string;
  hint: string;
  value: Attachment | null;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={value ? "slot filled" : "slot"}>
      <span className="slot-label">{label}</span>

      {value ? (
        <>
          <img src={value.preview} alt={value.name} />
          <button
            type="button"
            className="slot-clear"
            onClick={onClear}
            disabled={disabled}
            aria-label={`${label} 제거`}
          >
            ✕
          </button>
        </>
      ) : (
        <button
          type="button"
          className="slot-pick"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          <span className="plus">＋</span>
          {hint}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function LookStudio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [person, setPerson] = useState<Attachment | null>(null);
  const [product, setProduct] = useState<Attachment | null>(null);
  const [results, setResults] = useState<ResultImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** 서버가 준 원본 에러 전문 — 새 탭에서 보여준다 */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const composerRef = useRef<HTMLElement>(null);

  const ready = Boolean(person && product) && !busy;

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

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [busy]);

  async function pickProduct(file: File) {
    try {
      setProduct(await readAsAttachment(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorDetail(err instanceof Error ? (err.stack ?? null) : String(err));
    }
  }

  /** 방금 만든 결과를 인물 사진으로 되돌려, 그 위에 다른 옷을 이어서 입힌다 */
  function continueFrom(img: ResultImage) {
    setPerson(attachmentFromBase64(img.data, img.mimeType, "직전 결과.png"));
    setProduct(null);
    setResults([]);
    setError(null);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit() {
    if (!person || !product || busy) return;
    setError(null);
    setElapsed(0);
    setBusy(true);

    try {
      // 01번과 달리 LRO 가 아니라 동기 호출이다 — 잡 폴링 없이 응답을 기다린다
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person: { data: person.data, mimeType: person.mimeType },
          products: [{ data: product.data, mimeType: product.mimeType }],
        }),
      });

      const data = (await res.json()) as {
        images?: ResultImage[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.images?.length) {
        setErrorDetail(data.detail ?? null);
        throw new Error(data.error ?? "요청이 거부되었습니다");
      }
      setResults(data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="studio image">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">02 — Image</span>
          <span className="c">Model — virtual-try-on-001</span>
        </div>
        <h1>Look Studio</h1>
        <p>샘플 인물이나 즉석 촬영 사진에 원하는 의상을 입혀보세요</p>
      </header>

      {health && !health.ready && (
        <div className="banner banner-warn">
          <strong>인증이 설정되지 않았습니다.</strong> {health.detail}
        </div>
      )}

      {error && (
        <ErrorBanner
          message={error}
          detail={errorDetail}
          context="02 Look Studio"
          onClose={() => {
            setError(null);
            setErrorDetail(null);
          }}
        />
      )}

      {results.length > 0 && (
        <section className="results">
          <p className="results-hint">
            완성된 착장이에요. 마음에 들면 이 결과에 다른 옷을 이어서 입혀볼 수 있어요.
          </p>
          {results.map((img, i) => (
            <article key={i} className="result">
              <img src={dataUrl(img)} alt={`합성 결과 ${i + 1}`} />
              <div className="turn-actions">
                <button
                  type="button"
                  className="continue-btn"
                  onClick={() => continueFrom(img)}
                >
                  ↩ 이 사진으로 계속하기
                </button>
                <a
                  className="result-dl"
                  href={dataUrl(img)}
                  download={`look-${i + 1}.png`}
                >
                  ⬇ 내 PC에 다운로드
                </a>
                <DownloadQr
                  url={img.downloadUrl}
                  error={img.downloadError}
                  context="02 Look Studio · QR"
                />
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="composer" ref={composerRef}>
        <div className="slots">
          <PersonPicker
            value={person}
            onPick={setPerson}
            onClear={() => setPerson(null)}
            disabled={busy}
          />
          <Slot
            label="의상"
            hint="의상 사진 올리기"
            value={product}
            onPick={(f) => void pickProduct(f)}
            onClear={() => setProduct(null)}
            disabled={busy}
          />
        </div>

        <div className="controls">
          {/* <span className="cost">단가 확인 전</span> */}
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={!ready}
          >
            {busy ? "합성 중…" : "입혀보기"}
          </button>
        </div>

        {busy && (
          <div className="progress">
            <span className="spinner" />
            <span>이미지 합성 중</span>
            <span className="elapsed">{elapsed}초 경과</span>
          </div>
        )}
      </section>
    </main>
  );
}
