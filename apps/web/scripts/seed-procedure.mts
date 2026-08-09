// 절차 후보를 하나 심는다 — 승인 **직전**까지.
//
// procedures 표(사람이 답한 것)에 넣지 않는다. 세션의 조작 열에 심어서
// 추출기가 스스로 찾아내게 한다 — 그래야 실제와 같은 길을 지난다.
// 승인·이름 짓기·읽을 자리 집기는 사람이 화면에서 한다.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/seed-procedure.mts [--remove]
//
// 심는 세션은 processed_at 을 채워 둔다. 해석 경로(경험·갈래·기억)를 타지
// 않게 하기 위해서다 — 이건 절차 시험용이지 관측 기록이 아니다.
import fs from 'node:fs';
import postgres from 'postgres';

const REMOVE = process.argv.includes('--remove');
const url = fs.readFileSync('.env.local', 'utf8').match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const sql = postgres(url, { prepare: false });

// 고정 uuid — 지울 때 정확히 이것만 지운다.
const IDS = [
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000002',
];

if (REMOVE) {
  await sql`delete from sessions where id = any(${IDS})`;
  console.log('심은 세션을 지웠다');
  await sql.end();
  process.exit(0);
}

const [u] = await sql`select id from users order by created_at limit 1`;
if (!u) { console.log('사용자가 없다'); await sql.end(); process.exit(1); }

// **셀렉터를 지어내지 않는다.**
//
// 단계는 관측에서 온다 — 사람이 실제로 누른 것을 확장이 기록한다. 여기서는
// 그 관측을 위조하는 것이라 셀렉터도 위조해야 하는데, 없는 셀렉터를 넣으면
// 실행기가 그걸 몇 초씩 기다렸다가 라벨로 넘어간다. 낭비이고, 무엇보다
// 실패의 원인이 "이 절차가 안 맞다"인지 "내가 지어낸 값이 틀렸다"인지
// 구별이 안 된다.
//
// 라벨만 남긴다. 실행기는 셀렉터가 없으면 보이는 텍스트로 찾는다 —
// 실제 사이트에서 그게 통하는지 보는 것이 이 시험의 목적이기도 하다.
const act = (label: string, dt: number) => ({ t: 'a', label, dt });

/** GPT 콘솔에서 사용량을 보고 Render 배포를 확인하는 흐름. */
const segments = () => [
  {
    domain: 'platform.openai.com',
    category: 'dev',
    start: '2026-08-07T09:00:00+09:00',
    end: '2026-08-07T09:04:00+09:00',
    sec: 240,
    title: 'Usage — OpenAI API',
    // 단계는 **관측에서 온다** — 사람이 실제로 누른 것이다. 여기서는 그
    // 관측을 위조하는 것이라, 있는지도 모르는 조작을 상상해서 채우면 안 된다.
    // 실제로 그랬다가 없는 'Cost' 탭을 클릭하려다 절차가 그 자리에서 멈췄고,
    // 정작 사람이 집어둔 값들이 완주를 못 했다.
    //
    // 페이지를 여는 것 하나면 후보가 성립한다. 확인할 값은 사람이 집는다.
    acts: [act('Usage', 3)],
  },
  {
    domain: 'dashboard.render.com',
    category: 'dev',
    start: '2026-08-07T09:04:00+09:00',
    end: '2026-08-07T09:07:00+09:00',
    sec: 180,
    title: 'Render Dashboard',
    acts: [act('na-nightly-batch', 6)],
  },
];

for (const [i, id] of IDS.entries()) {
  const day = 7 + i; // 8/7 과 8/8 — 이틀에 걸쳐 되풀이한 모양
  const segs = segments().map((s) => ({
    ...s,
    start: s.start.replace('-07T', `-0${day}T`),
    end: s.end.replace('-07T', `-0${day}T`),
  }));
  await sql`
    insert into sessions (id, user_id, started_at, ended_at, duration_min, close_reason,
                          primary_category, activity_score, unique_domains, switch_count,
                          tags, compressed_log, domains, processed_at)
    values (${id}, ${u.id},
            ${`2026-08-0${day}T00:00:00Z`}, ${`2026-08-0${day}T00:07:00Z`}, 7, 'idle',
            'dev', 84, 2, 1, ${sql.array([])},
            ${sql.json({ tags: [], queries: [], segments: segs })},
            ${sql.json({ 'platform.openai.com': 240, 'dashboard.render.com': 180 })},
            now())
    on conflict (id) do update set compressed_log = excluded.compressed_log`;
}

console.log(`세션 ${IDS.length}개를 심었다 — /procedures 에서 후보로 뜬다`);
console.log('  1. platform.openai.com · Usage');
console.log('  2. platform.openai.com · Cost');
console.log('  3. dashboard.render.com · na-nightly-batch');
console.log('\n지우려면 --remove');
await sql.end();
