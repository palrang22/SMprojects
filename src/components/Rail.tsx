import { NavLink } from "react-router-dom";
import {
  AudioIcon,
  HomeIcon,
  ImageIcon,
  SettingsIcon,
  VideoIcon,
} from "./Icons.tsx";

const ITEMS = [
  { to: "/", label: "홈", Icon: HomeIcon, end: true },
  { to: "/video", label: "비디오", Icon: VideoIcon, end: false },
  { to: "/image", label: "이미지", Icon: ImageIcon, end: false },
  { to: "/audio", label: "오디오", Icon: AudioIcon, end: false },
];

export function Rail() {
  return (
    <aside className="rail">
      <img className="mark" src="/SM_CI_wordmark_white.svg" alt="SM" />

      {ITEMS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={label}
          aria-label={label}
          className={({ isActive }) => (isActive ? "ritem on" : "ritem")}
        >
          <Icon />
        </NavLink>
      ))}

      <div className="spacer" />

      <NavLink
        to="/settings"
        title="설정"
        aria-label="설정"
        className={({ isActive }) => (isActive ? "ritem on" : "ritem")}
      >
        <SettingsIcon />
      </NavLink>

      <img
        className="gc"
        src="/Google_Cloud_icon.svg"
        alt="Google Cloud"
        title="Powered by Google Cloud"
      />
    </aside>
  );
}
