import { useCallback, useEffect, useMemo, useState } from "react";
import { openErrorReport } from "../lib/errorReport.ts";
import "../styles/studio.css";

/**
 * Media Gallery (§4) — 부스에서 사람들이 만든 01·02 결과물이 슬라이드쇼로 넘어간다.
 * 좌하단 레일의 갤러리 아이콘 → 관리자 비밀번호(`AdminGate`) 통과 후 진입.
 *
 * 소스는 배포 버킷(`gs://.../output`). `GET /api/gallery` 가 서명 URL + 생성시각을
 * 최신순으로 준다. 부스 운영 중 새 결과가 쌓이므로 주기적으로 다시 불러온다.
 * 현재 보고 있는 항목은 인덱스가 아니라 오브젝트 경로로 추적한다 — 목록이
 * 갱신돼도(새 결과 추가·삭제) 화면이 튀지 않게.
 */
type GalleryItem = {
  object: string;
  type: "image" | "video";
  url: string;
  createdAt: number;
};

const POLL_MS = 45_000;
const IMAGE_MS = 5_000;
/** 영상은 onEnded 로 넘어가지만, 로드 실패 등으로 안 끝날 때를 위한 안전장치 */
const VIDEO_FALLBACK_MS = 40_000;
/** 마우스가 멈추면 하단 바를 숨기기까지 */
const BAR_HIDE_MS = 3_000;

export function Gallery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  /** 서버가 준 원본 에러 전문 — "오류 보기" 가 새 탭에 띄운다 */
  const [detail, setDetail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [currentObject, setCurrentObject] = useState<string | null>(null);
  const [barShown, setBarShown] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 진입 시 1회 + 부스 운영 중 쌓이는 새 결과를 위해 주기적으로 다시 불러온다
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/gallery")
        .then((r) => r.json())
        .then(
          (data: {
            items?: GalleryItem[];
            note?: string;
            detail?: string;
            error?: string;
          }) => {
            if (!alive) return;
            setItems(data.items ?? []);
            // 400 이면 { error, detail }, 정상인데 비었으면 { note, detail? }
            setNote(data.note ?? data.error ?? null);
            setDetail(data.detail ?? null);
            setLoaded(true);
          },
        )
        .catch((err: unknown) => {
          if (!alive) return;
          setNote("갤러리 목록을 불러오지 못했습니다.");
          setDetail(err instanceof Error ? (err.stack ?? err.message) : String(err));
          setLoaded(true);
        });
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // 저장해 둔 오브젝트가 목록에서 사라졌으면(삭제 등) 첫 항목으로 떨어진다.
  // 인덱스 동기화 effect 없이 렌더 시점에 계산한다.
  const current = useMemo(
    () =>
      (currentObject && items.find((i) => i.object === currentObject)) ||
      items[0] ||
      null,
    [items, currentObject],
  );
  const pos = current ? items.findIndex((i) => i.object === current.object) : -1;

  const next = useCallback(() => {
    if (items.length < 2) return;
    const at = current ? items.findIndex((i) => i.object === current.object) : -1;
    setCurrentObject(items[(at + 1) % items.length]?.object ?? null);
  }, [items, current]);

  // 자동 넘김 — 이미지 5초, 영상은 onEnded(+ 안전 타임아웃)
  useEffect(() => {
    if (items.length < 2 || !current) return;
    const ms = current.type === "image" ? IMAGE_MS : VIDEO_FALLBACK_MS;
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [current, items.length, next]);

  // 마우스를 움직이면 하단 바가 올라오고, 멈추면 다시 숨는다
  useEffect(() => {
    let t: number | undefined;
    const onMove = () => {
      setBarShown(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setBarShown(false), BAR_HIDE_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(t);
    };
  }, []);

  async function remove() {
    if (!current || deleting) return;
    const removed = current.object;
    const at = items.findIndex((i) => i.object === removed);
    setDeleting(true);
    try {
      await fetch(`/api/gallery?object=${encodeURIComponent(removed)}`, {
        method: "DELETE",
      });
      const rest = items.filter((i) => i.object !== removed);
      setItems(rest);
      setCurrentObject(rest[Math.min(at, rest.length - 1)]?.object ?? null);
    } catch {
      // 무시 — 다음 폴링에서 반영된다
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="studio gallery">
      {!loaded ? (
        <div className="gallery-msg">
          <p>불러오는 중…</p>
        </div>
      ) : !items.length ? (
        <div className="gallery-msg">
          <p>아직 전시할 사진·영상이 없습니다.</p>
          {note && <p className="gallery-note">{note}</p>}
          {detail && (
            <button
              type="button"
              className="banner-detail"
              onClick={() =>
                openErrorReport(
                  "Media Gallery",
                  note ?? "갤러리 로드 실패",
                  detail,
                )
              }
            >
              🔎 오류 보기
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="gallery-stage" key={current?.object ?? "empty"}>
            {current?.type === "video" ? (
              <video
                className="gallery-media"
                src={current.url}
                autoPlay
                muted
                playsInline
                onEnded={next}
                onError={next}
              />
            ) : (
              <img
                className="gallery-media"
                src={current?.url}
                alt=""
                onError={next}
              />
            )}
          </div>

          <div className={barShown ? "gallery-bar on" : "gallery-bar"}>
            <span className="gallery-count">
              {pos + 1} / {items.length}
            </span>
            <span className="gallery-kind">
              {current?.type === "video" ? "영상 · Motion" : "이미지 · Look"}
            </span>
            <span className="gallery-when">
              {current?.createdAt
                ? new Date(current.createdAt).toLocaleString("ko-KR")
                : ""}
            </span>
            <button
              type="button"
              className="gallery-del"
              onClick={() => void remove()}
              disabled={deleting}
            >
              {deleting ? "삭제 중…" : "삭제"}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
