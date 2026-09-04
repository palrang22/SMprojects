/**
 * 스튜디오 3종 공용 에러 배너.
 *
 * 화면에는 짧은 메시지만 띄우고, 원본 에러 전문은 "에러코드 확인하기" 로
 * 새 탭에 연다. 부스 화면에 스택 트레이스를 늘어놓지 않으면서도
 * 문제가 났을 때 바로 원인을 볼 수 있게 하려는 것이다.
 */

type Props = {
  /** 화면에 보여줄 한 줄 메시지 */
  message: string;
  /** 서버가 내려준 원본 에러 전문. 없으면 버튼을 숨긴다 */
  detail?: string | null;
  /** 어느 스튜디오에서 났는지 — 새 탭 제목에 쓴다 */
  context: string;
  onClose: () => void;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 에러 전문을 담은 페이지를 만들어 새 탭으로 연다 */
function openDetail(context: string, message: string, detail: string) {
  const body = [
    `발생 위치 : ${context}`,
    `발생 시각 : ${new Date().toLocaleString("ko-KR")}`,
    `페이지    : ${location.pathname}`,
    "",
    "--- 화면에 표시된 메시지 ---",
    message,
    "",
    "--- 원본 에러 ---",
    detail,
  ].join("\n");

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>에러 상세 — ${escapeHtml(context)}</title>
<style>
  body { margin:0; padding:24px; background:#0f0f0f; color:#e8e8e8;
         font:13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size:15px; margin:0 0 16px; color:#ea4335; }
  pre { white-space:pre-wrap; word-break:break-word; margin:0;
        padding:16px; background:#1a1a1a; border:1px solid #333; border-radius:8px; }
  button { margin-bottom:16px; padding:8px 14px; cursor:pointer; border-radius:6px;
           border:1px solid #444; background:#1a1a1a; color:#e8e8e8; font:inherit; }
  button:hover { border-color:#666; }
</style></head><body>
<h1>에러 상세 — ${escapeHtml(context)}</h1>
<button id="copy">📋 전체 복사</button>
<pre id="body">${escapeHtml(body)}</pre>
<script>
  document.getElementById('copy').addEventListener('click', function () {
    var t = document.getElementById('body').textContent;
    navigator.clipboard.writeText(t).then(function () {
      var b = document.getElementById('copy');
      b.textContent = '✅ 복사됨';
      setTimeout(function () { b.textContent = '📋 전체 복사'; }, 1500);
    });
  });
</script>
</body></html>`;

  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const tab = window.open(url, "_blank");
  if (!tab) {
    // 팝업 차단 — 최소한 원문은 볼 수 있게 알린다
    alert("팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.");
  }
  // 탭이 로드된 뒤 해제한다. 즉시 revoke 하면 빈 탭이 뜬다
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ErrorBanner({ message, detail, context, onClose }: Props) {
  return (
    <div className="banner banner-error">
      <strong>오류</strong> {message}
      {detail && (
        <button
          type="button"
          className="banner-detail"
          onClick={() => openDetail(context, message, detail)}
        >
          🔎 에러코드 확인하기
        </button>
      )}
      <button type="button" className="banner-close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
