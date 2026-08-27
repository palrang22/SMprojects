import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * 결과물의 GCS 서명 URL을 버튼 뒤에 숨겨뒀다가, 누르면 QR로 보여준다.
 * 우리 앱(IAP 뒤)을 거치지 않는 링크라 로그인 없는 부스 방문자도
 * 자기 폰으로 스캔해서 바로 받아갈 수 있다.
 *
 * url 이 없으면(서명 실패/로컬 dev/API 키 모드) 아무것도 렌더링하지 않는다 —
 * 기존 인앱 재생·다운로드 링크는 이 컴포넌트와 무관하게 항상 동작한다.
 */
export function DownloadQr({ url }: { url?: string }) {
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

  if (!url) return null;

  return (
    <div className="download-qr">
      <button
        type="button"
        className="qr-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        📱 QR로 저장
      </button>

      {open && (
        <div className="qr-popover">
          {dataUrl ? (
            <img src={dataUrl} alt="QR 코드로 다운로드" width={140} height={140} />
          ) : (
            <span className="qr-loading">QR 생성 중…</span>
          )}
          <span>폰으로 스캔해서 저장</span>
        </div>
      )}
    </div>
  );
}
