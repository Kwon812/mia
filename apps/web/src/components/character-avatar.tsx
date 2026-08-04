// 캐릭터 본체. 말랑한 블롭 + 깜빡이는 눈.
// 감정별 표정 분화는 이후 작업 — 지금은 기본 표정 하나.
export function CharacterAvatar({ size = 160 }: { size?: number }) {
  return (
    <div className="na-float inline-block" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" width={size} height={size} aria-label="캐릭터">
        <defs>
          <radialGradient id="na-body" cx="38%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#fdf6ec" />
            <stop offset="55%" stopColor="#f2dfc4" />
            <stop offset="100%" stopColor="#e2b88a" />
          </radialGradient>
        </defs>
        {/* 몸통 — 살짝 눌린 블롭 */}
        <path
          d="M80 12
             C 122 12 148 40 148 78
             C 148 118 120 146 80 146
             C 40 146 12 118 12 78
             C 12 40 38 12 80 12 Z"
          fill="url(#na-body)"
          stroke="#141f28"
          strokeWidth="3"
        />
        {/* 눈 */}
        <g className="na-blink">
          <ellipse cx="58" cy="76" rx="6.5" ry="9" fill="#141f28" />
          <ellipse cx="102" cy="76" rx="6.5" ry="9" fill="#141f28" />
          <circle cx="60.5" cy="72.5" r="2.2" fill="#fff" />
          <circle cx="104.5" cy="72.5" r="2.2" fill="#fff" />
        </g>
        {/* 입 */}
        <path
          d="M72 100 Q 80 106 88 100"
          fill="none"
          stroke="#141f28"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* 볼 */}
        <circle cx="44" cy="94" r="7" fill="#b4671f" opacity="0.22" />
        <circle cx="116" cy="94" r="7" fill="#b4671f" opacity="0.22" />
      </svg>
    </div>
  );
}
