import { createContext, useContext } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "sm-theme";

/**
 * 저장값 → OS 설정 → 다크 순으로 결정한다.
 *
 * 모듈 최상단에서 한 번만 읽는다. 컴포넌트 렌더 중에 localStorage 를 읽으면
 * 렌더가 순수하지 않게 되고(react-hooks/purity), 이펙트에서 setState 하면
 * 캐스케이드 렌더가 된다. 둘 다 피하려면 여기가 맞다.
 *
 * index.html 의 인라인 스크립트가 같은 규칙으로 먼저 data-theme 을 칠하므로
 * 첫 페인트에 색이 번쩍이지 않는다.
 */
function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // 시크릿 모드 등에서 접근이 막힐 수 있다
  }
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    // matchMedia 미지원
  }
  return "dark";
}

export const INITIAL_THEME = readInitialTheme();

export type ThemeValue = { theme: Theme; toggle: () => void };

export const ThemeContext = createContext<ThemeValue | null>(null);

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme 은 ThemeProvider 안에서만 쓸 수 있습니다");
  return value;
}

/** 라이트 모드에서는 흰색 로고 대신 원본(어두운) 로고를 쓴다 */
export function useLogo(base: string): string {
  const { theme } = useTheme();
  return theme === "light" ? `${base}.svg` : `${base}_white.svg`;
}
