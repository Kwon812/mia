#!/usr/bin/env node
// ============================================================
// 갈래와 기억을 직접 채운다. **LLM 을 부르지 않는다.**
//
// experience-engine 이 만든 것 위에, 지도가 허전하지 않을 만큼 갈래를 세우고
// 갈래마다 기억을 하나씩 붙인다. 데모용이라 문장은 손으로 쓴 것이다 —
// 실제 서비스에서 이 자리는 모델이 쓴다(memory-resummary).
//
// 두 번 돌려도 안전하다. 이미 있는 갈래·기억은 건드리지 않는다.
//
//   DATABASE_URL=postgres://... node scripts/seed-threads-memories.mjs --key na_...
// ============================================================

import postgres from 'postgres';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const KEY = opt('key', process.env.NA_DEMO_KEY ?? '');
const URL_ = process.env.DATABASE_URL ?? '';
const DRY = args.includes('--dry');

if (!URL_) { console.error('DATABASE_URL 이 없다.'); process.exit(1); }
if (!KEY) { console.error('--key na_... 가 필요하다.'); process.exit(1); }

// 카테고리 → 갈래 제목 · 기억. 시드한 시나리오에 맞춰 손으로 썼다.
const PLAN = [
  ['design',        '포트폴리오 리뉴얼',   '시안을 세 번 갈아엎었다',
   '처음 잡은 레이아웃이 계속 답답했는데, 여백을 늘리고 나서야 이유를 알았다. 글자를 줄이는 게 아니라 사이를 벌리는 문제였다.'],
  ['study',         '일본어 공부',         '유닛 하나를 3일 만에 끝냈다',
   '매일 밤 조금씩 붙잡았더니 12에서 14까지 갔다. 한자는 여전히 헷갈리지만 문장이 눈에 들어오기 시작했다.'],
  ['shopping',      '러닝화 고르기',       '발볼 때문에 이틀을 뒤졌다',
   '후기를 아무리 읽어도 결국 발볼이 문제였다. 모델 이름보다 그 한 가지를 먼저 봤어야 했다.'],
  ['finance',       '가계부 정리',         '주말마다 같은 순서로 맞춘다',
   '지출을 카테고리로 나누고 메모를 남기는 것까지가 한 묶음이 됐다. 두 번째부터는 15분이면 끝났다.'],
  ['productivity',  '아침에 여는 세 군데', '메일, 캘린더, 노션 순서가 굳었다',
   '어느 날부터 순서가 정해졌다. 먼저 오늘 뭐가 오는지 보고, 그다음에 뭘 할지 정한다.'],
  ['search',        '오사카 계획',         '가고 싶은 곳을 먼저 적었다',
   '일정부터 짜려니 막혔는데, 가고 싶은 데를 먼저 늘어놓으니 순서는 저절로 잡혔다.'],
  ['ai',            'AI 로 만들어보기',     '물어보는 방식을 바꿨다',
   '한 번에 다 시키면 엉뚱한 게 나왔다. 쪼개서 묻고 중간을 확인하니 훨씬 나았다.'],
  ['dev',           'Project NA 만들기',   '키가 계정이던 걸 기기로 낮췄다',
   '브라우저를 지우면 캐릭터가 사라지는 게 계속 걸렸다. 키를 기기로 내리고 계정을 따로 두니 그 문제가 통째로 없어졌다.'],
  ['community',     '읽을거리 훑기',       '남의 실패담이 제일 남는다',
   '새 기술 소개보다 삽질 기록이 더 오래 기억에 남았다.'],
  ['news',          '뉴스 훑기',           null, null],
  ['music',         '작업할 때 듣는 것',    null, null],
  ['entertainment', '쉬는 시간',           null, null],
  ['docs',          '문서 읽기',           null, null],
];

const sql = postgres(URL_, { max: 1 });

try {
  const [me] = await sql`select user_id from devices where extension_key = ${KEY}`;
  if (!me) throw new Error('그 키로 등록된 기기가 없다');
  const uid = me.user_id;
  console.log('데모 계정:', uid, DRY ? '(DRY RUN)' : '');

  for (const [cat, title, memTitle, memBody] of PLAN) {
    const [{ count: n }] = await sql`
      select count(*)::int as count from experiences where user_id = ${uid} and category = ${cat}`;
    if (n === 0) { console.log(`  -    ${cat}: 경험 없음`); continue; }

    let [thread] = await sql`
      select id from threads where user_id = ${uid} and category = ${cat} order by started_at limit 1`;

    if (!thread) {
      if (DRY) { console.log(`  [dry] ${cat}: 갈래 생성 "${title}" (경험 ${n})`); continue; }
      [thread] = await sql`
        insert into threads (user_id, title, category, status, started_at, last_activity_at, experience_count)
        select ${uid}, ${title}, ${cat}, 'active',
               min(occurred_at), max(occurred_at), count(*)::int
        from experiences where user_id = ${uid} and category = ${cat}
        returning id`;
    }

    if (DRY) { console.log(`  [dry] ${cat}: 갈래 있음, 경험 ${n} 부착 예정`); continue; }

    // 아직 어느 갈래에도 안 붙은 경험을 이 갈래에 붙인다.
    const attached = await sql`
      update experiences set thread_id = ${thread.id}
      where user_id = ${uid} and category = ${cat} and thread_id is null
      returning id`;

    await sql`
      update threads set
        experience_count = (select count(*)::int from experiences where thread_id = ${thread.id}),
        last_activity_at = (select max(occurred_at) from experiences where thread_id = ${thread.id})
      where id = ${thread.id}`;

    let memo = '';
    if (memTitle) {
      const [has] = await sql`select 1 as x from memories where thread_id = ${thread.id} limit 1`;
      if (!has) {
        const ev = await sql`
          select id, occurred_at, memory_score from experiences
          where thread_id = ${thread.id} order by memory_score desc, occurred_at desc limit 3`;
        // importance 는 1~10 (memory-score.ts 의 memoryImportance 와 같은 범위).
        const importance = Math.min(10, Math.max(4, Math.round(4 + ev.length + n / 6)));
        await sql`
          insert into memories (user_id, thread_id, experience_id, experience_ids, occurred_at,
                                title, body, importance, trigger, triggers)
          values (${uid}, ${thread.id}, ${ev[0].id}, ${ev.map((e) => e.id)}, ${ev[0].occurred_at},
                  ${memTitle}, ${memBody}, ${importance}, 'new_skill', ${['new_skill']})`;
        memo = ` · 기억 +1`;
      }
    }
    console.log(`  ok   ${cat}: 갈래 "${title}" · 경험 ${n}(새로 부착 ${attached.length})${memo}`);
  }

  const [sum] = await sql`
    select (select count(*)::int from threads  where user_id = ${uid}) as threads,
           (select count(*)::int from memories where user_id = ${uid}) as memories,
           (select count(*)::int from experiences where user_id = ${uid} and thread_id is null) as orphan`;
  console.log(`\n갈래 ${sum.threads} · 기억 ${sum.memories} · 갈래 없는 경험 ${sum.orphan}`);
} catch (err) {
  console.error('실패:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
