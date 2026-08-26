import { useState, type FormEvent } from "react";
import { LockIcon } from "../components/Icons.tsx";
import "../styles/studio.css";

/**
 * 관리자 화면.
 *
 * ⚠️ 이 비밀번호는 브라우저에서만 검사한다. 번들을 열면 그대로 보이므로
 * 보안 장치가 아니라 "실수로 들어가는 것"을 막는 덮개다.
 * 진짜 접근 제어는 IAP(도메인 제한) + 서버 쪽 검사가 맡는다.
 * 킬 스위치를 붙일 때는 반드시 서버에서 신원을 다시 확인할 것.
 */
const ADMIN_PASSWORD = "aprk12!";
const SESSION_KEY = "sm-admin";

/** 렌더 중 sessionStorage 를 읽지 않으려고 모듈 최상단에서 한 번만 확인한다 */
function readUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

const INITIAL_UNLOCKED = readUnlocked();

function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (input === ADMIN_PASSWORD) {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // 저장 실패해도 이번 화면은 열어준다
      }
      onUnlock();
      return;
    }
    setError(true);
    setInput("");
  }

  return (
    <form className="gate" onSubmit={submit}>
      <span className="gate-icon">
        <LockIcon />
      </span>
      <h2>관리자 확인</h2>
      <p>운영용 화면입니다. 비밀번호를 입력하세요.</p>

      <input
        type="password"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setError(false);
        }}
        placeholder="비밀번호"
        aria-label="관리자 비밀번호"
        autoFocus
      />

      {error && <p className="gate-error">비밀번호가 맞지 않습니다.</p>}

      <button type="submit" className="primary" disabled={!input}>
        확인
      </button>
    </form>
  );
}

export function Settings() {
  const [unlocked, setUnlocked] = useState(INITIAL_UNLOCKED);

  return (
    <main className="studio admin">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">Admin</span>
          <span className="c">{unlocked ? "잠금 해제됨" : "잠김"}</span>
        </div>
        <h1>관리자</h1>
      </header>

      {unlocked ? (
        <section className="composer">
          <p className="panel-sub">
            기능 on/off 킬 스위치와 사용량 확인이 여기 들어갑니다.
          </p>
          <p className="hint-note">
            아직 구현 전입니다. 킬 스위치는 서버 쪽 검사와 함께 붙습니다.
          </p>
        </section>
      ) : (
        <Gate onUnlock={() => setUnlocked(true)} />
      )}
    </main>
  );
}
