import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { openErrorReport } from "../lib/errorReport.ts";

/**
 * 결과물의 GCS 서명 URL을 버튼 뒤에 숨겨뒀다가, 누르면 QR로 보여준다.
 * 우리 앱(IAP 뒤)을 거치지 않는 링크라 로그인 없는 부스 방문자도
 * 자기 폰으로 스캔해서 바로 받아갈 수 있다.
 *
 * url 이 없을 때:
 *  - error 가 있으면 "오류 보기" 로 서버가 준 원본 에러를 새 탭에 띄운다
 *  - error 도 없으면(API 키 모드 등) "준비 중" 안내만
 */
export function DownloadQr({
  url,
  error,
  context = "QR 다운로드",
}: {
  url?: string;
  error?: string | null;
  context?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { width: 160, margin: 1 })
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  return (
    <div className="download-qr">
      <button
        type="button"
        className="qr-toggle result-dl"
        onClick={() => setOpen((o) => !o)}
      >
        📱 QR로 다운로드
      </button>

      {open && (
        <div className="qr-popover">
          {url ? (
            dataUrl ? (
              <>
                <img
                  src={dataUrl}
                  alt="QR 코드로 다운로드"
                  width={140}
                  height={140}
                />
                <span>폰으로 스캔해서 저장</span>
              </>
            ) : (
              <span className="qr-loading">QR 생성 중…</span>
            )
          ) : error ? (
            <div className="qr-fail">
              <span>QR 링크를 만들지 못했어요</span>
              <button
                type="button"
                className="banner-detail"
                onClick={() =>
                  openErrorReport(context, "QR 서명 URL 생성 실패", error)
                }
              >
                🔎 오류 보기
              </button>
            </div>
          ) : (
            <span className="qr-loading">QR 다운로드는 준비 중이에요</span>
          )}
        </div>
      )}
    </div>
  );
}
