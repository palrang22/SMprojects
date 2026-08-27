import { useEffect, useRef, useState } from "react";
import { readAsAttachment, type Attachment } from "../lib/image.ts";
import "../styles/studio.css";

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
};

type ResultImage = { data: string; mimeType: string };

const dataUrl = (img: ResultImage) => `data:${img.mimeType};base64,${img.data}`;

/** 인물/의상 사진을 하나씩 받는 업로드 슬롯 */
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

  async function pick(file: File, set: (a: Attachment) => void) {
    try {
      set(await readAsAttachment(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
      };
      if (!res.ok || !data.images?.length) {
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
        <p>
          인물 사진을 넣고 원하는 의상을 입혀보세요
        </p>
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

      {results.length > 0 && (
        <section className="results">
          {results.map((img, i) => (
            <article key={i} className="result">
              <img src={dataUrl(img)} alt={`합성 결과 ${i + 1}`} />
              <div className="turn-actions">
                <a href={dataUrl(img)} download={`look-${i + 1}.png`}>
                  ⬇ 다운로드
                </a>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="composer">
        <div className="slots">
          <Slot
            label="인물"
            hint="인물 사진 올리기"
            value={person}
            onPick={(f) => void pick(f, setPerson)}
            onClear={() => setPerson(null)}
            disabled={busy}
          />
          <Slot
            label="의상"
            hint="의상 사진 올리기"
            value={product}
            onPick={(f) => void pick(f, setProduct)}
            onClear={() => setProduct(null)}
            disabled={busy}
          />
        </div>

        <div className="controls">
          <span className="cost">단가 확인 전</span>
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
