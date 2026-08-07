// 저장까지 간다 — 분할된 경험이 갈래에 제대로 붙는지, 잠긴 갈래가 되살아나는지.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/probe-e2e-split.mts
//
// planItems 까지는 probe-split 이 본다. 여기서는 processSession 을 실제로 태워
// experiences·threads·memories·characters 가 어떻게 쓰이는지 확인한다.
//
// **격리된 테스트 유저**를 만들어 쓰고 끝나면 지운다(CASCADE). 실유저 데이터는
// 건드리지 않는다. LLM 을 세션당 1회 부른다.
import fs from 'node:fs';
import zlib from 'node:zlib';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { buildCompressedLog, normalizeEvent } from '../../extension/src/session/builder';
import type { RawEvent, SessionDraft } from '../../extension/src/session/types';

const env = fs.readFileSync('.env.local', 'utf8');
const g = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.ANTHROPIC_API_KEY ||= g('ANTHROPIC_API_KEY');
process.env.DATABASE_URL ||= g('DATABASE_URL');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'));
const sql = postgres(g('DATABASE_URL'), { prepare: false });
// 엔진은 임포트 시점에 커넥션을 만든다 — 환경변수를 먼저 넣고 늦게 불러온다.
const { processSession } = await import('../src/lib/experience-engine');

const SESSION_SRC = process.argv[2] ?? '5f645169';
/** 심어둘 잠긴 갈래의 제목. 이번 세션과 어휘가 겹쳐야 후보로 뽑힌다. */
const DORMANT_TITLE = process.argv[3] ?? 'SOLDIER : A DAY 게임 개발';
const DORMANT_LAST = process.argv[4] ?? 'SOLDIER : A DAY 게임의 플레이 화면을 다듬다 말았다';
const userId = randomUUID();
const keep = process.argv.includes('--keep');

// ── 원본에서 압축 로그를 다시 만든다 ──
const users = (await sb.storage.from('na-raw').list('raw')).data ?? [];
let path = '';
for (const u of users) {
  for (const d of (await sb.storage.from('na-raw').list(`raw/${u.name}`)).data ?? []) {
    for (const f of (await sb.storage.from('na-raw').list(`raw/${u.name}/${d.name}`)).data ?? []) {
      if (f.name.startsWith(SESSION_SRC)) path = `raw/${u.name}/${d.name}/${f.name}`;
    }
  }
}
if (!path) { console.error('원본을 못 찾음'); process.exit(1); }

const blob = await sb.storage.from('na-raw').download(path);
const text = zlib.gunzipSync(Buffer.from(await blob.data!.arrayBuffer())).toString('utf8');
const events = text.trim().split('\n').map((l) => normalizeEvent(JSON.parse(l) as RawEvent));
const draft: SessionDraft = {
  id: randomUUID(), startedAt: events[0].at, lastActivityAt: events.at(-1)!.at,
  primaryCategory: 'dev', events, switchCount: 0, tags: [], domains: {}, activityScore: 0,
};
const log = buildCompressedLog(draft);
const numbered = { ...log, segments: log.segments.map((s, i) => ({ i, ...s })) };

// ── 테스트 유저와 잠긴 갈래를 심는다 ──
const sessionId = randomUUID();
const dormantId = randomUUID();
await sql.begin(async (t) => {
  await t`insert into users (id, extension_key) values (${userId}, ${'na_test_' + userId.slice(0, 8)})`;
  await t`insert into characters (user_id) values (${userId})`;
  // 이번 세션과 어휘가 겹치는 잠긴 갈래 — 부활 경로를 밟게 하려는 미끼다.
  await t`insert into threads (id, user_id, title, category, status, started_at, last_activity_at, experience_count)
          values (${dormantId}, ${userId}, ${DORMANT_TITLE}, 'dev', 'abandoned',
                  now() - interval '400 days', now() - interval '380 days', 3)`;
  // 그 갈래에 경험이 있어야 FTS 후보로 뽑힌다.
  await t`insert into experiences (user_id, session_id, thread_id, occurred_at, summary, category, outcome, memory_score)
          select ${userId}, ${sessionId}, ${dormantId}, now() - interval '380 days',
                 ${DORMANT_LAST}, 'dev', 'partial', 10
          where false`; // 세션이 아직 없으므로 아래에서 넣는다
  await t`insert into sessions (id, user_id, started_at, ended_at, duration_min, close_reason,
                                primary_category, activity_score, unique_domains, switch_count, tags,
                                compressed_log, domains)
          values (${sessionId}, ${userId}, ${new Date(events[0].at)}, ${new Date(events.at(-1)!.at)},
                  ${Math.round((events.at(-1)!.at - events[0].at) / 60000)}, 'switch', 'dev', 3000,
                  ${new Set(events.map((e) => e.domain)).size}, 2, ARRAY[]::text[],
                  ${JSON.stringify(numbered)}::jsonb, '{}'::jsonb)`;
  await t`insert into experiences (user_id, session_id, thread_id, occurred_at, summary, category, outcome, memory_score)
          values (${userId}, ${sessionId}, ${dormantId}, now() - interval '380 days',
                  ${DORMANT_LAST}, 'dev', 'partial', 10)`;
});

console.log(`테스트 유저 ${userId.slice(0, 8)} · 세션 ${sessionId.slice(0, 8)} · 잠긴 갈래 "${DORMANT_TITLE}" (400일 방치)`);
console.log(`구간 ${log.segments.length}개${log.earlier ? ` (+앞부분 ${Math.round(log.earlier.sec / 60)}분)` : ''}\n`);

// ── 실제로 태운다 ──
await processSession(sessionId, userId);

// ── 결과 ──
const exps = await sql`
  select e.summary, e.category, e.outcome, e.duration_min, e.segment_ids, e.memory_score, e.is_first_time,
         t.title as thread, t.status, t.experience_count, (t.id = ${dormantId}) as is_dormant_thread
    from experiences e left join threads t on t.id = e.thread_id
   where e.session_id = ${sessionId} order by e.occurred_at`;
console.log(`경험 ${exps.length}개`);
for (const e of exps) {
  console.log(`  · [${e.category}/${e.outcome}] ${String(e.duration_min).padStart(3)}분 · 구간 ${JSON.stringify(e.segment_ids)} · M${e.memory_score}${e.is_first_time ? ' · 처음' : ''}`);
  console.log(`    ${e.summary}`);
  console.log(`    갈래: "${e.thread}" (${e.status}, 경험 ${e.experience_count}건)${e.is_dormant_thread ? '  ← 잠긴 갈래 부활!' : ''}`);
}
console.log('\n갈래:', await sql`select title, status, experience_count from threads where user_id = ${userId}`);
console.log('기억:', await sql`select title, trigger, triggers, importance from memories where user_id = ${userId}`);
console.log('캐릭터:', await sql`select level, experience_count, skill_count, memory_count from characters where user_id = ${userId}`);
console.log('실패기록:', await sql`select reason from ingest_failures where user_id = ${userId}`);

if (!keep) {
  await sql`delete from users where id = ${userId}`; // CASCADE
  console.log('\n테스트 데이터 정리 완료');
}
await sql.end(); process.exit(0);
