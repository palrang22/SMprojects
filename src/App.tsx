import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Rail } from "./components/Rail.tsx";
import { ThemeProvider } from "./lib/ThemeProvider.tsx";
import { Hub } from "./routes/Hub.tsx";
import { LookStudio } from "./routes/LookStudio.tsx";
import { MotionStudio } from "./routes/MotionStudio.tsx";
import { Settings } from "./routes/Settings.tsx";
import { VoiceStudio } from "./routes/VoiceStudio.tsx";
import "./styles/hub.css";

/** 허브만 2열 분할 레이아웃을 쓴다. 스튜디오 페이지는 전체 폭. */
function Shell() {
  const { pathname } = useLocation();
  const isHub = pathname === "/";

  return (
    <div className="shell">
      <Rail />
      <div className={isHub ? "main main-split" : "main"}>
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/video" element={<MotionStudio />} />
          <Route path="/image" element={<LookStudio />} />
          <Route path="/audio" element={<VoiceStudio />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Hub />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </ThemeProvider>
  );
}
