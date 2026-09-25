/** Wrought-iron corner brackets with rivets, drawn as SVG and placed on the four corners of a panel. */
const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

function Bracket() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
      <path
        d="M4 60 V14 Q4 4 14 4 H60 V12 H16 Q12 12 12 16 V60 Z"
        fill="#3c3f44"
        stroke="#1d1f22"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 26 Q24 26 28 14" fill="none" stroke="#6b7078" strokeWidth="2" strokeLinecap="round" />
      <path d="M26 12 Q26 22 14 28" fill="none" stroke="#1d1f22" strokeWidth="1" opacity="0.6" />
      <circle cx="8" cy="8" r="2.6" fill="#8a8f98" stroke="#1d1f22" />
      <circle cx="8" cy="40" r="2.2" fill="#8a8f98" stroke="#1d1f22" />
      <circle cx="40" cy="8" r="2.2" fill="#8a8f98" stroke="#1d1f22" />
    </svg>
  );
}

export function IronFrame() {
  return (
    <>
      {CORNERS.map((corner) => (
        <span key={corner} className={`iron-corner iron-corner--${corner}`}>
          <Bracket />
        </span>
      ))}
    </>
  );
}
