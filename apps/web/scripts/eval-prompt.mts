// 프롬프트 골든 테스트 — 정답이 설계상 명확한 세션을 손으로 짜고 전 필드를 검증한다.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/eval-prompt.mts [반복횟수]
//
// 실데이터로는 프롬프트를 못 고친다. 정답을 모르기 때문이다. 여기서는 정답을
// 먼저 정하고 세션을 그 정답이 나오도록 만든다 — 틀리면 프롬프트 문제다.
// temperature 0 이어도 실행마다 답이 갈리므로 여러 번 돌려 안정성도 함께 본다.
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, TOOL_NAME, RECORD_EXPERIENCE_TOOL, SYSTEM_PROMPT_V9, buildUserMessage } from '../src/lib/experience-engine';

const RUNS = Number(process.argv[2] ?? 3);
/** 두 번째 인자로 케이스 이름 일부를 주면 그것만 돌린다 — 한 케이스를 파고들 때
 *  전체 68콜을 태울 이유가 없다. */
const ONLY = process.argv[3] ?? '';

// Haiku 4.5 가격 ($/1M 토큰) — daily-logs.ts 와 같은 값을 쓴다.
const IN_PRICE = 1.0;
const OUT_PRICE = 5.0;
const usage = { inTok: 0, outTok: 0, calls: 0 };
const env = fs.readFileSync('.env.local', 'utf8');
process.env.ANTHROPIC_API_KEY ||= env.match(/ANTHROPIC_API_KEY="?([^"\n]+)"?/)![1];
const client = new Anthropic();

// KST 오프셋 표기 — 실제 압축 로그와 같은 형식이어야 평가가 유효하다.
const T = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 7, 5, h, m)).toISOString().replace('Z', '+09:00');
// sec 은 실제 압축기가 싣는 귀속 체류 시간이다. 픽스처에도 넣어야 프롬프트가
// 보는 것이 프로덕션과 같아진다 — 없으면 모델이 시각으로 어림잡는 옛 경로를 탄다.
const seg = (domain: string, category: string, title: string, h: number, m: number, dur: number, extra: object = {}) =>
  ({ domain, category, title, start: T(h, m), end: T(h, m + dur), sec: dur * 60, ...extra });

const THREAD_A = { id: '11111111-1111-4111-8111-111111111111', title: '프로젝트 A 배포 파이프라인', category: 'dev', experienceCount: 4, lastSummary: 'GitHub Actions 워크플로에 빌드 캐시를 붙였다' };
/** 잠긴 갈래 픽스처. 제목이 비슷한 이웃을 하나 더 둔다 — 실제로 후보에 오르는
 *  것들은 어휘가 겹쳐서 뽑힌 것이라 서로 닮아 있다. 안 닮은 것만 놓고 재면
 *  어떤 방식이든 맞히므로 시험이 안 된다. */
const DORMANT_R = { id: '22222222-2222-4222-8222-222222222222', title: 'Redis 캐싱 도입', category: 'dev', experienceCount: 6, idleDays: 412, lastSummary: '캐시 무효화를 TTL 로 갈지 명시적 삭제로 갈지 정하다 말았다' };
const DORMANT_P = { id: '33333333-3333-4333-8333-333333333333', title: 'Redis Pub/Sub 실험', category: 'dev', experienceCount: 3, idleDays: 380, lastSummary: 'PSUBSCRIBE 패턴 구독 예제를 돌려보고 끝냈다' };

const SKILLS = [
  { name: 'TypeScript', lastUsedAt: new Date(Date.UTC(2026, 7, 4)) },
  { name: 'GitHub Actions', lastUsedAt: new Date(Date.UTC(2026, 7, 4)) },
];

type Case = {
  name: string;
  검증: string;
  session: { primaryCategory: string; durationMin: number; closeReason?: string; activityScore?: number; domains: Record<string, number>; compressedLog: unknown };
  skills?: typeof SKILLS;
  recent?: { summary: string; category: string; outcome: string | null; corrected?: boolean }[];
  threads?: (typeof THREAD_A)[];
  dormant?: (typeof DORMANT_R)[];
  expect: Record<string, unknown>;
};

/** 프롬프트에 절을 하나 덧붙여 같은 골든셋을 돌린다 — 그 문장이 기존 판정
 *  분포를 미는지 재는 용도다. 환경변수로 켠다:
 *    EXTRA_RULE_FILE=/tmp/rule.txt npx tsx ... scripts/eval-prompt.mts 2
 *  기존 문장을 고칠 때도 이 방식으로 먼저 재고 나서 반영한다. */
const EXTRA_RULE = process.env.EXTRA_RULE_FILE
  ? fs.readFileSync(process.env.EXTRA_RULE_FILE, 'utf8')
  : '';
if (EXTRA_RULE) console.log(`덧붙인 규칙 ${EXTRA_RULE.trim().length}자\n`);

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
    // 1년 넘게 잠긴 갈래라도 그 일을 다시 집으면 이어져야 한다. 이걸 못 하면
    // 3년 뒤 재개가 매번 새 갈래가 되어 같은 일이 조각난다.
    name: '부활 — 잠긴 갈래를 다시 집었다',
    검증: 'thread.action',
    threads: [THREAD_A],
    dormant: [DORMANT_R, DORMANT_P],
    session: { primaryCategory: 'dev', durationMin: 47, domains: { 'redis.io': 1100, localhost: 1720 },
      compressedLog: { tags: [], queries: [{ q: 'redis 캐시 무효화 ttl', n: 3, first: '2026-08-06T02:00:00+09:00', last: '2026-08-06T02:30:00+09:00' }],
        segments: [ seg('redis.io','docs','Redis — Key eviction / TTL',13,0,18),
          seg('localhost','dev','Project NA — invalidateCache 붙이기',13,18,29) ] } },
    expect: { 'thread.action': 'attach', 'thread.existing_thread_id': DORMANT_R.id },
  },
  {
    // 잠긴 갈래가 눈앞에 있어도 무관하면 안 붙어야 한다. 후보를 보여주는 것이
    // 곧 붙일 구실이 되면 이 장치가 오히려 갈래를 오염시킨다.
    name: '부활 안 함 — 잠긴 갈래가 있어도 무관한 일',
    검증: 'thread.action',
    dormant: [DORMANT_R, DORMANT_P],
    session: { primaryCategory: 'docs', durationMin: 31, domains: { 'nextjs.org': 1860 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('nextjs.org','docs','Next.js — after() API',13,0,15),
          seg('nextjs.org','docs','Next.js — Partial Prerendering',13,15,16) ] } },
    expect: { 'thread.action': 'new' },
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
  {
    // v4 — 사람 판단(declared) 우선 규칙의 행동 검증.
    //
    // github.com 은 도메인 사전이 dev 로 찍는다. 그리고 이 세션은 실제로
    // 남의 코드를 읽기만 했다(편집·실행 흔적 없음) — 프롬프트 기준으로는 study 다.
    // 도메인 편향 때문에 모델이 dev 로 기울기 쉬운 자리인데, 최근 경험에
    // **같은 상황을 사람이 study 로 고친 선례**가 붙어 있다.
    // 이 선례를 따르면 study, 무시하면 dev 가 나온다.
    name: 'declared — 사람이 고친 선례를 따른다 (dev 편향 vs study)',
    검증: 'declared 우선',
    recent: [
      { summary: '오픈소스 저장소를 읽으며 구조를 파악했다', category: 'study', outcome: 'explore', corrected: true },
      { summary: 'Project NA 확장 빌드를 고쳤다', category: 'dev', outcome: 'success' },
      { summary: 'Drizzle 스키마 문서를 봤다', category: 'docs', outcome: 'success' },
    ],
    session: { primaryCategory: 'dev', durationMin: 53, domains: { 'github.com': 3180 },
      compressedLog: { tags: [], queries: [],
        segments: [ seg('github.com','dev','drizzle-team/drizzle-orm — src/pg-core',14,0,14),
          seg('github.com','dev','drizzle-team/drizzle-orm — dialect.ts',14,14,13),
          seg('github.com','dev','drizzle-team/drizzle-orm — Discussions',14,27,12),
          seg('github.com','dev','drizzle-team/drizzle-orm — src/relations.ts',14,39,14) ] } },
    expect: { category: 'study' },
  },
  {
    // v9 — 구간 번호(i) 배정의 정확도. **골든셋에 이걸 재는 자리가 없었다.**
    //
    // segment_ids 는 라벨이 아니라 **좌표**다. 여기가 틀리면 그 구간들의 sec 합이
    // 틀리고, 그게 곧 분할 문턱(MIN_SPLIT_SEC)·duration_min·occurred_at 이다.
    // 실측(세션 5dc6a1a0)에서 26분짜리 곁가지가 5분으로 잡혀 문턱을 못 넘었다 —
    // 나뉘어야 할 것이 안 나뉜 이유가 판단이 아니라 산수였다.
    //
    // **실제로 깨진 모양을 그대로 쓴다.** 처음엔 구간 5개로 짰는데 i 를 빼도
    // 3/3 으로 통과했다 — 다섯 개는 그냥 세어진다. 실제로 배정이 어긋난 세션은
    // segments 20 + earlier.top 8 = 28칸이었다. 세는 부담이 그만큼 있어야
    // 이 케이스가 무언가를 재게 된다.
    //
    // 대상은 둘이고 둘 다 문턱(10분)을 넉넉히 넘는다. 정답은 하나뿐이다:
    //   Army Sim  → 6, 13, 17   (11+12+13 = 36분)
    //   프로젝트 A → 나머지 전부
    // Army Sim 을 뒤쪽 흩어진 자리에 둔 것은, 앞머리에 몰아두면 세지 않고도
    // 맞기 때문이다. 나머지 칸은 1~4분짜리 잡동사니로 채워 "세어야만 닿는"
    // 자리를 만든다.
    //
    // 제목은 대상마다 통일한다. buildTargetTotals 가 `도메인 · 제목` 으로 묶어서,
    // 같은 프로젝트라도 페이지마다 제목이 다르면 "큰 대상이 둘"이라는 신호가
    // 잘게 흩어진다(그렇게 짰다가 모델이 아예 안 쪼갰다). 여기서 재려는 것은
    // 분할 여부가 아니라 **번호 정확도**라, 분할 신호는 뚜렷하게 준다.
    name: 'segment_ids — 구간 번호를 정확히 짚는다 (i 배정)',
    검증: 'segment_ids',
    session: { primaryCategory: 'dev', durationMin: 96, domains: { 'github.com': 2400, localhost: 2160, 'vercel.com': 900, 'platform.openai.com': 720 },
      compressedLog: { tags: [], queries: [],
        segments: [
          seg('github.com','dev','프로젝트 A — 배포 워크플로',13,0,4),
          seg('vercel.com','dev','프로젝트 A — 배포 워크플로',13,4,3),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',13,7,5),
          seg('platform.openai.com','dev','프로젝트 A — 배포 워크플로',13,12,2),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',13,14,4),
          seg('vercel.com','dev','프로젝트 A — 배포 워크플로',13,18,3),
          seg('localhost','dev','Army Sim — 유닛 밸런스',13,21,11),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',13,32,4),
          seg('platform.openai.com','dev','프로젝트 A — 배포 워크플로',13,36,3),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',13,39,2),
          seg('vercel.com','dev','프로젝트 A — 배포 워크플로',13,41,4),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',13,45,3),
          seg('platform.openai.com','dev','프로젝트 A — 배포 워크플로',13,48,2),
          seg('localhost','dev','Army Sim — 유닛 밸런스',13,50,12),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',14,2,4),
          seg('vercel.com','dev','프로젝트 A — 배포 워크플로',14,6,3),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',14,9,2),
          seg('localhost','dev','Army Sim — 유닛 밸런스',14,11,13),
          seg('github.com','dev','프로젝트 A — 배포 워크플로',14,24,4),
          seg('vercel.com','dev','프로젝트 A — 배포 워크플로',14,28,2),
        ] } },
    // 주 경험이 어느 쪽이든 상관없다 — 물어보는 것은 **두 덩어리를 번호로 정확히
    // 갈랐는가** 하나다. 채점은 아래 SEGMENT_CASE 블록이 따로 한다.
    expect: {},
  },
];

/** 위 케이스의 정답 배정. 두 집합 중 하나가 주(主), 나머지가 곁가지다.
 *  Army Sim 이 6·13·17, 프로젝트 A 가 나머지 열일곱 칸. */
const SEGMENT_CASE = {
  name: 'segment_ids — 구간 번호를 정확히 짚는다 (i 배정)',
  /** 곁가지로 갈라져 나와야 하는 집합. 주 경험 쪽은 나머지라 굳이 안 적는다 —
   *  모델이 주에 "세션 전체"(빈 배열)를 적을 수도 있고 그게 틀린 것도 아니다. */
  branch: [6, 13, 17],
};

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
    (c.dormant ?? []) as any,
  );
  const res = await client.messages.create({
    // **프로덕션과 같은 값이어야 한다.** 1024 였는데 엔진은 2048 이다 —
    // 그 차이가 정확히 `also` 가 잘리는 지점이라(출력 끝에 오고 optional 이라
    // 잘려도 검증을 통과한다), 분할을 재는 케이스가 프롬프트 탓이 아니라
    // 상한 탓에 떨어진다. 골든셋이 프로덕션과 다른 조건을 재면 안 된다.
    model: MODEL, max_tokens: 2048, temperature: 0,
    system: SYSTEM_PROMPT_V9 + EXTRA_RULE, tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content }],
  });
  usage.calls += 1;
  usage.inTok += res.usage?.input_tokens ?? 0;
  usage.outTok += res.usage?.output_tokens ?? 0;
  const tu: any = res.content.find((b: any) => b.type === 'tool_use');
  return tu?.input ?? {};
}

// ── 프롬프트 조립 검증 (LLM 호출 없음) ──
// declared 우선 규칙은 [사람이 고침] 표시가 프롬프트에 실제로 실려야만 걸린다.
// 아래 LLM 케이스는 확률적이라 표시가 통째로 빠져도 우연히 통과할 수 있어,
// 이 결정적 검증이 진짜 회귀 방어선이다.
{
  const msg = buildUserMessage(
    { primaryCategory: 'dev', durationMin: 30, closeReason: 'idle', activityScore: 360,
      domains: { 'github.com': 1800 }, compressedLog: { tags: [], queries: [], segments: [] } } as any,
    SKILLS as any,
    [
      { summary: '고친 것', category: 'study', outcome: 'explore', isFirstTime: true, corrected: true },
      { summary: '안 고친 것', category: 'dev', outcome: 'success', isFirstTime: false },
    ] as any,
    [] as any,
  );
  const problems: string[] = [];
  if (!msg.includes('[study/explore/처음] [사람이 고침] 고친 것')) {
    problems.push('교정된 경험에 [사람이 고침] 표시 또는 is_first_time 이 없다');
  }
  if (msg.includes('[dev/success/해봄] [사람이 고침]')) {
    problems.push('교정되지 않은 경험에 표시가 잘못 붙었다');
  }

  // 교정 패턴 집계 — 최근 3건 창에 갇히지 않는 유일한 경로라, 빠지면
  // 사흘 전 교정이 모델에게 영영 안 보인다.
  const withPatterns = buildUserMessage(
    { primaryCategory: 'dev', durationMin: 30, closeReason: 'idle', activityScore: 360,
      domains: { 'github.com': 1800 }, compressedLog: { tags: [], queries: [], segments: [] } } as any,
    SKILLS as any, [] as any, [] as any,
    // 5번째가 잠긴 갈래, 6번째가 교정 패턴이다. v6 에서 인자가 하나 늘 때
    // 이 호출을 안 고쳐 검증이 걸렸다 — 이 검사가 있으라고 만든 자리다.
    [] as any,
    [{ field: 'outcome', from: 'explore', to: 'stuck', count: 3 }] as any,
  );
  if (!withPatterns.includes('### 네가 바로잡힌 판정')) {
    problems.push('교정 패턴 섹션이 없다');
  }
  if (!withPatterns.includes('outcome: explore → stuck (3회)')) {
    problems.push('교정 패턴 줄 형식이 어긋났다');
  }
  if (msg.includes('### 네가 바로잡힌 판정')) {
    problems.push('교정이 없는데 패턴 섹션이 붙었다');
  }
  if (problems.length > 0) {
    console.error('✗ 프롬프트 조립 검증 실패');
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }
  console.log('✓ 프롬프트 조립 — [사람이 고침] 표시가 최근 경험 목록에 실린다\n');
}

const summary: any[] = [];
for (const c of CASES.filter((c) => !ONLY || c.name.includes(ONLY))) {
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
  // ── segment_ids 는 값 비교로 못 잰다 ──
  //
  // 주 경험이 어느 덩어리를 맡을지는 자유다. 물어보는 것은 **두 덩어리를 번호로
  // 정확히 갈랐는가** 하나라, 주/곁가지를 합친 집합이 정답 분할과 같은지를 본다.
  // 순서도 어느 쪽이 주인지도 안 따진다.
  if (c.name === SEGMENT_CASE.name) {
    const key = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
    const want = key(SEGMENT_CASE.branch);
    // 갈라져 나온 것 중 **정답 집합과 정확히 같은 게 하나라도 있는가.**
    // 주 경험이 나머지를 어떻게 적든(전체를 뜻하는 빈 배열이어도) 상관없다 —
    // 재려는 것은 "그 대상의 구간을 정확히 짚었는가" 하나다.
    const gots = outs.map((o) => (o.also ?? []).map((a: any) => key(a.segment_ids ?? [])));
    const hit = gots.filter((g) => g.includes(want)).length;
    if (hit !== RUNS) allPass = false;
    row['기대'] = want;
    row['실제'] = gots.map((g) => (g.length ? g.join('+') : '분할없음')).join(' // ');
    row['일치'] = `${hit}/${RUNS}`;
  }

  row['판정'] = allPass ? 'PASS' : 'FAIL';
  // 참고용 부가 정보
  row['category'] = outs[0].category;
  row['outcome'] = outs[0].outcome;
  row['first'] = outs[0].is_first_time;
  row['스킬'] = (outs[0].skills ?? []).length;
  row['대사'] = (outs[0].dialogues ?? []).length;
  summary.push(row);
  console.log(`${allPass ? '✓' : '✗'} ${c.name}`);
}
console.log('');
console.table(summary);
const fail = summary.filter((r) => r.판정 === 'FAIL');
const cost = (usage.inTok / 1e6) * IN_PRICE + (usage.outTok / 1e6) * OUT_PRICE;
console.log(`\n${summary.length - fail.length}/${summary.length} 통과 · 호출 ${usage.calls}회`);
console.log(
  `토큰 입력 ${usage.inTok.toLocaleString()} · 출력 ${usage.outTok.toLocaleString()} · ` +
  `비용 $${cost.toFixed(3)} (약 ${Math.round(cost * 1400).toLocaleString()}원)`,
);
// 판정 분포도 함께 본다 — 통과율만 보면 안 된다는 게 이 골든셋의 교훈이다.
// 1회차 15/16 이 '잘 된다'처럼 보였지만 실사용이었다면 거의 모든 세션이
// success 로 찍히는 상태였다(같은 통과율의 4회차와 분포가 완전히 달랐다).
const dist = (key: string) => {
  const m = new Map<string, number>();
  for (const r of summary) m.set(String(r[key] ?? '-'), (m.get(String(r[key] ?? '-')) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
};
console.log(`분포 outcome: ${dist('outcome')}`);
console.log(`분포 category: ${dist('category')}`);
