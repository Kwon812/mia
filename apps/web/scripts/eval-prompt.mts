// 프롬프트 골든 테스트 — 정답이 설계상 명확한 세션을 손으로 짜고 전 필드를 검증한다.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/eval-prompt.mts [반복횟수]
//
// 실데이터로는 프롬프트를 못 고친다. 정답을 모르기 때문이다. 여기서는 정답을
// 먼저 정하고 세션을 그 정답이 나오도록 만든다 — 틀리면 프롬프트 문제다.
// temperature 0 이어도 실행마다 답이 갈리므로 여러 번 돌려 안정성도 함께 본다.
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, TOOL_NAME, RECORD_EXPERIENCE_TOOL, SYSTEM_PROMPT_V3, buildUserMessage } from '../src/lib/experience-engine';

const RUNS = Number(process.argv[2] ?? 3);
const env = fs.readFileSync('.env.local', 'utf8');
process.env.ANTHROPIC_API_KEY ||= env.match(/ANTHROPIC_API_KEY="?([^"\n]+)"?/)![1];
const client = new Anthropic();

// KST 오프셋 표기 — 실제 압축 로그와 같은 형식이어야 평가가 유효하다.
const T = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 7, 5, h, m)).toISOString().replace('Z', '+09:00');
const seg = (domain: string, category: string, title: string, h: number, m: number, dur: number, extra: object = {}) =>
  ({ domain, category, title, start: T(h, m), end: T(h, m + dur), ...extra });

const THREAD_A = { id: '11111111-1111-4111-8111-111111111111', title: '프로젝트 A 배포 파이프라인', category: 'dev', experienceCount: 4, lastSummary: 'GitHub Actions 워크플로에 빌드 캐시를 붙였다' };
const SKILLS = [
  { name: 'TypeScript', lastUsedAt: new Date(Date.UTC(2026, 7, 4)) },
  { name: 'GitHub Actions', lastUsedAt: new Date(Date.UTC(2026, 7, 4)) },
];

type Case = {
  name: string;
  검증: string;
  session: { primaryCategory: string; durationMin: number; closeReason?: string; activityScore?: number; domains: Record<string, number>; compressedLog: unknown };
  skills?: typeof SKILLS;
  recent?: { summary: string; category: string; outcome: string | null }[];
  threads?: (typeof THREAD_A)[];
  expect: Record<string, unknown>;
};

const CASES: Case[] = [
  {
    name: 'stuck — 같은 검색어 반복, 해결 신호 없음',
    검증: 'outcome',
    session: { primaryCategory: 'dev', durationMin: 52, domains: { 'www.google.com': 900, 'stackoverflow.com': 1400, 'github.com': 820 },
      compressedLog: { tags: [], queries: [ { q: 'next.js hydration mismatch', n: 3, first: '2026-08-05T19:00:00+09:00', last: '2026-08-05T19:27:00+09:00' },
                   { q: 'hydration mismatch 해결', n: 2, first: '2026-08-05T19:13:00+09:00', last: '2026-08-05T19:31:00+09:00' },
                   { q: 'hydration error nextjs 15', n: 1, first: '2026-08-05T19:41:00+09:00', last: '2026-08-05T19:41:00+09:00' } ],
        segments: [ seg('www.google.com','search','next.js hydration mismatch - Google 검색',10,0,4,{query:'next.js hydration mismatch'}),
          seg('stackoverflow.com','dev','Next.js hydration mismatch',10,4,9),
          seg('www.google.com','search','hydration mismatch 해결 - Google 검색',10,13,3,{query:'hydration mismatch 해결'}),
          seg('github.com','dev','vercel/next.js · Issue #12345 hydration',10,16,11),
          seg('www.google.com','search','next.js hydration mismatch server client - Google 검색',10,27,4,{query:'next.js hydration mismatch server client'}),
          seg('stackoverflow.com','dev','Next.js hydration mismatch',10,31,10),
          seg('www.google.com','search','hydration error nextjs 15 - Google 검색',10,41,5,{query:'hydration error nextjs 15'}),
          seg('stackoverflow.com','dev','Why does hydration fail',10,46,6) ] } },
    expect: { outcome: 'stuck' },
  },
  {
    name: 'success — 검색 → 문서 → 적용, 주제가 후반에 사라짐',
    검증: 'outcome',
    session: { primaryCategory: 'dev', durationMin: 41, domains: { 'www.google.com': 200, 'vercel.com': 700, 'localhost': 1560 },
      compressedLog: { tags: [], queries: [{ q: 'vercel cron 설정', n: 1, first: '2026-08-05T22:00:00+09:00', last: '2026-08-05T22:00:00+09:00' }],
        segments: [ seg('www.google.com','search','vercel cron 설정 - Google 검색',13,0,3,{query:'vercel cron 설정'}),
          seg('vercel.com','docs','Cron Jobs – Vercel Docs',13,3,11),
          seg('localhost','dev','Project NA — vercel.json',13,14,9),
          seg('localhost','dev','Project NA — 대시보드',13,23,8),
          seg('localhost','dev','Project NA — 대시보드',13,31,10) ] } },
    expect: { outcome: 'success' },
  },
  {
    name: 'partial — 두 주제, 하나만 해결',
    검증: 'outcome',
    session: { primaryCategory: 'dev', durationMin: 63, domains: { 'vercel.com': 600, 'localhost': 1200, 'stackoverflow.com': 1980 },
      compressedLog: { tags: [], queries: [ { q: 'vercel 환경변수 설정', n: 1, first: '2026-08-05T18:00:00+09:00', last: '2026-08-05T18:00:00+09:00' },
                   { q: 'postgres connection pool timeout', n: 4, first: '2026-08-05T18:18:00+09:00', last: '2026-08-05T18:55:00+09:00' } ],
        segments: [ seg('vercel.com','docs','Environment Variables – Vercel',9,0,10),
          seg('localhost','dev','Project NA — 설정 완료',9,10,8),
          seg('www.google.com','search','postgres connection pool timeout - Google 검색',9,18,4,{query:'postgres connection pool timeout'}),
          seg('stackoverflow.com','dev','pool timeout on supabase',9,22,18),
          seg('stackoverflow.com','dev','pgbouncer transaction mode',9,40,23) ] } },
    expect: { outcome: 'partial' },
  },
  {
    name: 'explore — 넓고 얕음',
    검증: 'outcome',
    session: { primaryCategory: 'community', durationMin: 34, domains: { 'news.ycombinator.com': 800, 'www.reddit.com': 700, 'twitter.com': 540 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('news.ycombinator.com','community','Hacker News',15,0,6),
          seg('www.reddit.com','community','r/programming',15,6,5),
          seg('twitter.com','community','홈 / X',15,11,4),
          seg('news.ycombinator.com','community','Show HN: 어떤 도구',15,15,5),
          seg('www.reddit.com','community','r/webdev',15,20,6),
          seg('twitter.com','community','홈 / X',15,26,8) ] } },
    expect: { outcome: 'explore' },
  },
  {
    name: 'category 재판정 — 세션은 etc 인데 내용은 개발',
    검증: 'category',
    session: { primaryCategory: 'etc', durationMin: 48, domains: { 'my-internal-tool.example.com': 2880 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('my-internal-tool.example.com','etc','사내 배포 콘솔 — 빌드 로그',11,0,16),
          seg('my-internal-tool.example.com','etc','사내 배포 콘솔 — 롤백 실행',11,16,15),
          seg('my-internal-tool.example.com','etc','사내 배포 콘솔 — 빌드 성공',11,31,17) ] } },
    expect: { category: 'dev' },
  },
  {
    name: 'category — 같은 github 이라도 읽기만 했으면 study',
    검증: 'category',
    session: { primaryCategory: 'dev', durationMin: 55, domains: { 'github.com': 3300 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('github.com','dev','tanstack/query — 소스 읽기 src/core',14,0,18),
          seg('github.com','dev','tanstack/query — src/query.ts',14,18,20),
          seg('github.com','dev','tanstack/query — CONTRIBUTING.md',14,38,17) ] } },
    expect: { category: 'study' },
  },
  {
    name: 'is_first_time true — 보유 스킬에 없는 도구를 처음',
    검증: 'is_first_time',
    session: { primaryCategory: 'dev', durationMin: 46, domains: { 'redis.io': 1400, 'localhost': 1360 },
      compressedLog: { tags: [], queries: [{ q: 'redis 시작하기', n: 1, first: '2026-08-06T01:00:00+09:00', last: '2026-08-06T01:00:00+09:00' }],
        segments: [ seg('redis.io','docs','Redis Quick Start',16,0,14),
          seg('redis.io','docs','Redis — SETEX',16,14,9),
          seg('localhost','dev','Project NA — 캐시 붙이기',16,23,23) ] } },
    expect: { is_first_time: true },
  },
  {
    name: 'is_first_time false — 늘 하던 스킬만',
    검증: 'is_first_time',
    session: { primaryCategory: 'dev', durationMin: 38, domains: { 'localhost': 2280 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('localhost','dev','Project NA — 타입 정리',10,0,19),
          seg('localhost','dev','Project NA — 타입 정리',10,19,19) ] } },
    expect: { is_first_time: false },
  },
  {
    name: 'thread new — 같은 dev 지만 다른 대상(프로젝트 B)',
    검증: 'thread.action',
    threads: [THREAD_A],
    session: { primaryCategory: 'dev', durationMin: 44, domains: { 'localhost': 2640 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('localhost','dev','Army Sim — 전투 밸런스 수치 조정',12,0,22),
          seg('localhost','dev','Army Sim — 유닛 스탯 테이블',12,22,22) ] } },
    expect: { 'thread.action': 'new' },
  },
  {
    name: 'thread attach — 그 작업의 다음 단계',
    검증: 'thread.action',
    threads: [THREAD_A],
    session: { primaryCategory: 'dev', durationMin: 39, domains: { 'github.com': 2340 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('github.com','dev','프로젝트 A — Actions 워크플로 편집',17,0,20),
          seg('github.com','dev','프로젝트 A — 배포 워크플로 실행 성공',17,20,19) ] } },
    expect: { 'thread.action': 'attach', 'thread.existing_thread_id': THREAD_A.id },
  },
  {
    name: 'completed false — 작업이 계속 진행 중',
    검증: 'thread.completed',
    threads: [THREAD_A],
    session: { primaryCategory: 'dev', durationMin: 42, domains: { 'github.com': 2520 },
      compressedLog: { tags: [], queries: [{ q: 'actions matrix build', n: 2, first: '2026-08-06T02:00:00+09:00', last: '2026-08-06T02:20:00+09:00' }],
        segments: [ seg('github.com','dev','프로젝트 A — 워크플로에 matrix 추가 중',17,0,21),
          seg('github.com','dev','프로젝트 A — 빌드 실패 로그 확인',17,21,21) ] } },
    expect: { 'thread.completed': false },
  },
  {
    name: 'completed — 단일 세션 문서 정독 (작업 완결로 볼 것인가)',
    검증: 'thread.completed',
    session: { primaryCategory: 'docs', durationMin: 31, domains: { 'redis.io': 1860 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('redis.io','docs','Redis Persistence',13,0,15),
          seg('redis.io','docs','Redis Replication',13,15,16) ] } },
    expect: { 'thread.completed': false },
  },
  // ── 여기부터는 정답이 하나가 아닌 세션들. 실사용의 대부분이 이 모양이다.
  //    검증 기준은 "정확히 맞혔나"가 아니라 "말이 되는 범위 안인가" 이다.
  {
    name: '애매 — 개발 중간에 쇼핑·카페가 섞인 긴 세션',
    검증: '잡음 내성',
    threads: [THREAD_A],
    session: { primaryCategory: 'search', durationMin: 187,
      domains: { localhost: 3353, 'supabase.com': 2058, 'claude.ai': 981, 'cafe.naver.com': 420, 'm.bunjang.co.kr': 260, 'www.google.com': 120, etc: 168 },
      compressedLog: { tags: [], queries: [ { q: 'supabase transaction pooler', n: 2, first: '2026-08-05T21:22:00+09:00', last: '2026-08-05T21:40:00+09:00' },
                   { q: '중고 모니터', n: 1, first: '2026-08-05T22:05:00+09:00', last: '2026-08-05T22:05:00+09:00' } ],
        segments: [ seg('localhost','dev','Project NA — 대시보드',12,0,22),
          seg('supabase.com','dev','Supabase — SQL Editor',12,22,18),
          seg('claude.ai','ai','Claude',12,40,16),
          seg('cafe.naver.com','community','개발자 카페 — 자유게시판',12,56,9),
          seg('m.bunjang.co.kr','shopping','번개장터 — 중고 모니터',13,5,7,{query:'중고 모니터'}),
          seg('localhost','dev','Project NA — 대시보드',13,12,25),
          seg('supabase.com','dev','Supabase — 로그',13,37,16),
          seg('localhost','dev','Project NA — 배포 확인',13,53,14) ] } },
    // 개발이 압도적이므로 dev 여야 한다. 쇼핑·커뮤니티로 새면 잡음에 진 것이다.
    expect: { category: ['dev', 'ai'], outcome: ['partial', 'success', 'explore'] },
  },
  {
    name: '애매 — 활동은 많은데 주제가 없다',
    검증: '잡음 내성',
    session: { primaryCategory: 'etc', durationMin: 44,
      domains: { 'mail.google.com': 700, 'calendar.google.com': 500, 'www.notion.so': 900, 'slack.com': 540 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('mail.google.com','productivity','받은편지함',9,0,8),
          seg('www.notion.so','productivity','주간 계획',9,8,10),
          seg('calendar.google.com','productivity','8월 5일',9,18,6),
          seg('slack.com','community','팀 채널',9,24,9),
          seg('www.notion.so','productivity','주간 계획',9,33,11) ] } },
    expect: { category: ['productivity', 'etc', 'community'], outcome: ['explore', 'partial', 'success'] },
  },
  {
    name: '애매 — 영상 틀어두고 개발 (예외 C)',
    검증: '잡음 내성',
    session: { primaryCategory: 'dev', durationMin: 96,
      domains: { localhost: 4200, 'www.youtube.com': 1560 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('www.youtube.com','entertainment','로파이 재생목록',20,0,10),
          seg('localhost','dev','Project NA — 리팩터링',20,10,30),
          seg('localhost','dev','Project NA — 테스트 통과',20,40,26),
          seg('www.youtube.com','entertainment','로파이 재생목록',21,6,30) ] } },
    expect: { category: ['dev'], outcome: ['success', 'partial'] },
  },
  {
    name: '애매 — 두 작업을 오간다 (어느 thread 에 붙을까)',
    검증: '잡음 내성',
    threads: [THREAD_A],
    session: { primaryCategory: 'dev', durationMin: 71, domains: { 'github.com': 2100, localhost: 2160 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('github.com','dev','프로젝트 A — Actions 로그',15,0,15),
          seg('localhost','dev','Army Sim — 유닛 스탯',15,15,20),
          seg('github.com','dev','프로젝트 A — 워크플로 수정',15,35,16),
          seg('localhost','dev','Army Sim — 밸런스',15,51,20) ] } },
    // 정답이 하나가 아니다. 다만 존재하지 않는 id 를 만들어내면 안 된다.
    expect: { 'thread.action': ['attach', 'new'] },
  },
];

const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o);
/** 기대값은 단일 값이거나 허용 집합이다. 애매한 세션은 정답이 하나가 아니다 —
 *  거기서 물어야 할 것은 "정확히 이 값인가"가 아니라 "말이 되는 범위 안인가"다. */
const matches = (got: unknown, want: unknown) =>
  Array.isArray(want) ? want.includes(got as never) : got === want;

async function run(c: Case) {
  // 픽스처가 안 정했으면 가장 흔한 경우로 채운다 — 활동량은 길이에 비례.
  const sess = {
    closeReason: 'idle',
    activityScore: Math.round(c.session.durationMin * 12),
    ...c.session,
  };
  const content = buildUserMessage(
    sess as any,
    (c.skills ?? SKILLS) as any,
    (c.recent ?? []) as any,
    (c.threads ?? []) as any,
  );
  const res = await client.messages.create({
    model: MODEL, max_tokens: 1024, temperature: 0,
    system: SYSTEM_PROMPT_V3, tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content }],
  });
  const tu: any = res.content.find((b: any) => b.type === 'tool_use');
  return tu?.input ?? {};
}

const summary: any[] = [];
for (const c of CASES) {
  const outs = [];
  for (let i = 0; i < RUNS; i++) outs.push(await run(c));

  const row: any = { '케이스': c.name.slice(0, 34), '검증': c.검증 };
  let allPass = true;
  for (const [path, want] of Object.entries(c.expect)) {
    const got = outs.map((o) => get(o, path));
    const hit = got.filter((g) => matches(g, want)).length;
    if (hit !== RUNS) allPass = false;
    row['기대'] = String(want).slice(0, 12);
    row['실제'] = got.map((g) => String(g).slice(0, 12)).join('/');
    row['일치'] = `${hit}/${RUNS}`;
  }
  row['판정'] = allPass ? 'PASS' : 'FAIL';
  // 참고용 부가 정보
  row['category'] = outs[0].category;
  row['outcome'] = outs[0].outcome;
  row['first'] = outs[0].is_first_time;
  row['완결'] = outs[0].thread?.completed;
  row['스킬'] = (outs[0].skills ?? []).length;
  row['대사'] = (outs[0].dialogues ?? []).length;
  summary.push(row);
  console.log(`${allPass ? '✓' : '✗'} ${c.name}`);
}
console.log('');
console.table(summary);
const fail = summary.filter((r) => r.판정 === 'FAIL');
console.log(`\n${summary.length - fail.length}/${summary.length} 통과 · 호출 ${CASES.length * RUNS}회`);
