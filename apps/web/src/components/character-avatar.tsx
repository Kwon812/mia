// 캐릭터 본체. 이 사이트에서 빛이 나오는 유일한 곳이다 —
// 나머지 UI 는 전부 이 빛 앞에 떠 있는 유리라는 전제로 만들어졌다.
// 감정별 표정 분화는 이후 작업 — 지금은 기본 표정 하나.
export function CharacterAvatar({ size = 160 }: { size?: number }) {
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size * 1.9, height: size * 1.9 }}
    >
      {/* 광휘 — 몸통보다 훨씬 크게 퍼져 뒤 배경을 물들인다 */}
      <span
        className="na-glow"
        style={{ width: size * 1.85, height: size * 1.85 }}
        aria-hidden="true"
      />

      <div className="na-float relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 160 160" width={size} height={size} aria-label="캐릭터">
          <defs>
            {/* 몸통 — 왼쪽 위가 광원이고 아래로 갈수록 식는다 */}
            <radialGradient id="na-body" cx="36%" cy="26%" r="82%">
              <stop offset="0%" stopColor="#fffaf2" />
              <stop offset="46%" stopColor="#f6e3c8" />
              <stop offset="100%" stopColor="#dcae7d" />
            </radialGradient>

            {/* 림 라이트 — 오른쪽 아래 가장자리에 차가운 반사가 걸린다(분산광) */}
            <linearGradient id="na-rim" x1="18%" y1="8%" x2="88%" y2="96%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="52%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="100%" stopColor="#3e8f9c" stopOpacity="0.55" />
            </linearGradient>

            {/* 몸 안쪽 아래를 살짝 어둡게 — 부피감 */}
            <radialGradient id="na-shade" cx="62%" cy="86%" r="58%">
              <stop offset="0%" stopColor="#b4671f" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#b4671f" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* 몸통 — 말랑한 블롭. 검은 외곽선을 걷어내고 빛으로 형태를 잡는다 */}
          <path
            id="na-blob"
            d="M80 12
               C 122 12 148 40 148 78
               C 148 118 120 146 80 146
               C 40 146 12 118 12 78
               C 12 40 38 12 80 12 Z"
            fill="url(#na-body)"
          />
          <use href="#na-blob" fill="url(#na-shade)" />
          <use href="#na-blob" fill="none" stroke="url(#na-rim)" strokeWidth="2.5" />

          {/* 표면 반사 — 유리 세계의 일원이라는 표시 */}
          <ellipse
            cx="56"
            cy="44"
            rx="21"
            ry="13"
            fill="#ffffff"
            opacity="0.5"
            transform="rotate(-24 56 44)"
          />

          {/* 눈 */}
          <g className="na-blink">
            <ellipse cx="58" cy="78" rx="6.5" ry="9" fill="#101a2b" />
            <ellipse cx="102" cy="78" rx="6.5" ry="9" fill="#101a2b" />
            <circle cx="60.5" cy="74.5" r="2.2" fill="#fff" />
            <circle cx="104.5" cy="74.5" r="2.2" fill="#fff" />
          </g>

          {/* 입 */}
          <path
            d="M72 101 Q 80 107 88 101"
            fill="none"
            stroke="#101a2b"
            strokeWidth="2.8"
            strokeLinecap="round"
          />

          {/* 볼 */}
          <circle cx="44" cy="95" r="7.5" fill="#b4671f" opacity="0.18" />
          <circle cx="116" cy="95" r="7.5" fill="#b4671f" opacity="0.18" />
        </svg>
      </div>
    </div>
  );
}
