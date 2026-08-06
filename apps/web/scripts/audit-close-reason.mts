// 세션이 끝난 이유(close_reason)가 실제 로그와 맞는지 되짚는다.
//   실행: npx tsx scripts/audit-close-reason.mts
//
// 확장의 판정은 draft.events(원시 이벤트)로 돌지만, 서버에 남는 건 그걸 묶은
// compressed_log.segments 다. 세그먼트는 같은 도메인이 이어진 구간이라 원시
// 이벤트보다 거칠지만, "언제 어느 카테고리에 있었나"는 그대로 담고 있어
// 판정을 되짚기에 충분하다.
//
// 목적은 규칙을 다시 구현하는 게 아니라 **어긋난 것을 찾는 것**이다.
// 확장 코드가 진실이고, 여기 결과는 "이건 이상하니 코드를 다시 보라"는 신호다.
import fs from 'node:fs';
import postgres from 'postgres';

const env = fs.readFileSync('.env.local', 'utf8');
const sql = postgres(env.match(/DATABASE_URL="?([^"\n]+)"?/)?.[1] ?? '', { prepare: false });

// 확장의 상수·목록과 같은 값이어야 한다. 갈리면 이 감사가 거짓말을 한다.
const IDLE_MIN = 30;
const GRACE_MIN = 10;
const MAXLEN_MIN = 240;
const SCATTERED_MIN_SWITCHES = 3;
const SCATTERED_WINDOW_MIN = 60;
const COMPANION = [
  'google.com', 'stackoverflow.com', 'chatgpt.com', 'claude.ai', 'developer.mozilla.org',
  'bing.com', 'duckduckgo.com', 'perplexity.ai', 'openai.com', 'gemini.google.com',
];
// 아무 데도 안 간 이벤트 — 확장의 WAYPOINT_DOMAINS 와 같아야 한다.
const WAYPOINT = ['newtab', 'etc'];
const isCompanion = (h: string) => {
  const l = (h ?? '').split('.');
  for (let i = 0; i < l.length; i++) if (COMPANION.includes(l.slice(i).join('.'))) return true;
  return false;
};

type Seg = { start: string; end: string; domain: string; category: string; title?: string };

const rows = await sql<
  {
    startedAt: Date; endedAt: Date; durationMin: number; primaryCategory: string;
    closeReason: string; switchCount: number; tags: string[] | null; log: { segments?: Seg[] };
  }[]
>`
  select started_at as "startedAt", ended_at as "endedAt", duration_min as "durationMin",
         primary_category as "primaryCategory", close_reason as "closeReason",
         switch_count as "switchCount", tags, compressed_log as log
    from sessions order by started_at`;

const out: Record<string, unknown>[] = [];
let newtabWon = 0;
let companionHeavy = 0;

for (const s of rows) {
  const segs = (s.log?.segments ?? []).map((g) => ({
    ...g,
    s: new Date(g.start).getTime(),
    e: new Date(g.end).getTime(),
  }));
  const endT = s.endedAt.getTime();
  const rel = segs.filter((g) => !isCompanion(g.domain) && !WAYPOINT.includes(g.domain));

  // ① 마지막 활동 이후 공백 — idle 판정의 근거
  const lastAny = segs.length ? Math.max(...segs.map((g) => g.e)) : s.startedAt.getTime();
  const idleGapMin = (endT - lastAny) / 60000;

  // ② 끝나는 시점 기준 최근 10분 창의 우세 카테고리 — 머문 시간으로 가중
  const winFrom = endT - GRACE_MIN * 60000;
  const weight = new Map<string, number>();
  for (const g of rel) {
    const ov = Math.max(0, Math.min(g.e, endT) - Math.max(g.s, winFrom));
    // 길이 0 짜리 세그먼트(이벤트 하나)도 존재는 세야 한다.
    const w = ov > 0 ? ov : g.e >= winFrom && g.s <= endT ? 1 : 0;
    if (w > 0) weight.set(g.category, (weight.get(g.category) ?? 0) + w);
  }
  const dominant = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // ③ 그 카테고리가 끊김 없이 이어진 구간
  let runFrom = endT;
  for (let i = rel.length - 1; i >= 0; i--) {
    if (rel[i].category !== dominant) break;
    runFrom = rel[i].s;
  }
  const runMin = (endT - runFrom) / 60000;

  const scattered =
    s.switchCount >= SCATTERED_MIN_SWITCHES && s.durationMin < SCATTERED_WINDOW_MIN;

  // 확장의 우선순위 그대로: idle → switch → maxlen → day
  let expect: string;
  if (idleGapMin >= IDLE_MIN) expect = 'idle';
  else if (dominant && dominant !== s.primaryCategory && runMin >= GRACE_MIN && !scattered)
    expect = 'switch';
  else if (s.durationMin >= MAXLEN_MIN) expect = 'maxlen';
  else expect = '(안 끊김)';

  // 눈여겨볼 것 — 뜻 없는 경유지가 우세를 가져갔나
  if (dominant === 'etc') newtabWon += 1;
  const compMs = segs.filter((g) => isCompanion(g.domain)).reduce((a, g) => a + (g.e - g.s), 0);
  if (compMs > 10 * 60000) companionHeavy += 1;

  out.push({
    시작: s.startedAt.toISOString().slice(5, 16).replace('T', ' '),
    분: s.durationMin,
    분야: s.primaryCategory,
    실제: s.closeReason,
    되짚음: expect,
    맞나: expect === s.closeReason ? '○' : '✗',
    '끝 10분 우세': dominant ?? '—',
    '연속(분)': Math.round(runMin),
    '공백(분)': Math.round(idleGapMin),
    이탈: s.switchCount,
  });
}

console.table(out);
const bad = out.filter((o) => o.맞나 === '✗');
console.log(`\n일치 ${out.length - bad.length}/${out.length}`);
console.log(`끝 10분 우세가 'etc'(새 탭 등 뜻 없는 경유지)인 세션: ${newtabWon}`);
console.log(`COMPANION 에서 10분 넘게 머문 세션: ${companionHeavy}`);

await sql.end();
process.exit(0);
