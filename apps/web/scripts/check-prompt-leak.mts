// compressed_log 의 새 필드가 프롬프트로 새는지 점검한다.
//   npx tsx --tsconfig scripts/tsconfig.json scripts/check-prompt-leak.mts
//
// 왜 이게 필요한가: buildUserMessage 는 compressed_log 를 **통째로**
// JSON.stringify 해서 프롬프트에 붓는다. 그래서 확장이 새 필드를 담기
// 시작하면 아무도 그러라고 하지 않았는데 프롬프트가 바뀐다 — 실제로
// 조작 기록(acts)을 넣었을 때 그럴 뻔했다.
//
// 그게 왜 위험한가: 신호를 늘리면 좋아질 것 같지만 측정은 반대를 말한다.
// 갈래에 「주로 다룬 것」을 더 실어준 실험이 쌍 F1 을 56.3 → 47.7 로
// 떨어뜨렸다. 겹치는 면적이 넓어져 틀리게 맞을 자리가 늘어난다.
// (docs/HANDOFF-attach.md)
//
// 새 필드를 **일부러** 프롬프트에 넣는다면 ALLOWED 에 추가하면 된다.
// 다만 그 전에 시험대로 재라 — 오늘 기각한 가설 여섯 개가 전부
// "재보지 않고 좋아 보여서" 넣으려던 것들이었다.
import { buildUserMessage } from '../src/lib/experience-engine';

/** 프롬프트에 들어가도 되는 구간 필드. i 는 withSegmentIndex 가 붙인다. */
const ALLOWED = new Set(['i', 'domain', 'category', 'start', 'end', 'sec', 'title', 'paths', 'via']);

/** 프롬프트에서 빠져야 하는 것 — 이유를 함께 적는다. */
const FORBIDDEN: Record<string, string> = {
  acts: '조작 열은 절차 추출용이다. 프롬프트에 넣으면 겹치는 면적이 넓어지고 토큰이 두 배가 된다.',
};

const MARKER = '자리표시_들키면_샌다';
const segment: Record<string, unknown> = {
  domain: 'supabase.com',
  category: 'dev',
  title: 'experiences | Table Editor',
  start: '2026-08-09T10:00:00+09:00',
  end: '2026-08-09T10:40:00+09:00',
  sec: 2400,
  paths: ['/project/x/editor'],
  via: ['github.com · PR'],
  // 금지 필드에 표식을 심는다 — 새면 프롬프트에서 발견된다
  acts: [{ t: 'button', label: MARKER, sel: '#export', mut: true, dt: 3.2 }],
  // 아직 존재하지 않는 필드도 하나 — 앞으로 뭘 추가하든 걸리게
  미래필드: MARKER,
};

const msg = buildUserMessage(
  {
    primaryCategory: 'dev',
    durationMin: 40,
    closeReason: 'idle',
    activityScore: 480,
    domains: { 'supabase.com': 2400 },
    compressedLog: { tags: [], queries: [], segments: [segment] },
  } as never,
  [],
  [],
  [],
);

const problems: string[] = [];

// 1) 금지 필드가 이름으로든 값으로든 새는가
for (const [name, why] of Object.entries(FORBIDDEN)) {
  if (msg.includes(`"${name}"`)) problems.push(`${name} 이(가) 프롬프트에 있다 — ${why}`);
}
if (msg.includes(MARKER)) problems.push(`표식이 프롬프트에서 발견됐다 — 알 수 없는 필드가 샌다`);

// 2) 허용 필드는 반대로 살아 있어야 한다 — 과잉 삭제도 버그다
for (const name of ['domain', 'title', 'sec']) {
  if (!msg.includes(`"${name}"`)) problems.push(`${name} 이(가) 프롬프트에서 사라졌다 (과잉 삭제)`);
}

// 3) 허용 목록에 없는 필드가 통째로 실리고 있지는 않은가
const seen = [...msg.matchAll(/"([A-Za-z가-힣_]+)"\s*:/g)].map((m) => m[1]);
const unknown = [...new Set(seen)].filter(
  (n) => !ALLOWED.has(n) && !['tags', 'queries', 'segments', 'earlier', 'top'].includes(n),
);
if (unknown.length > 0) problems.push(`허용 목록에 없는 필드: ${unknown.join(', ')}`);

if (problems.length > 0) {
  console.error('✗ 프롬프트 누출\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ 누출 없음 · 허용 필드만 실림 · 프롬프트 ${msg.length}자`);
