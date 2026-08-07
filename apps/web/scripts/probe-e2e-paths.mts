// 저장까지 가는 경로들을 한 번에 태운다.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/probe-e2e-paths.mts
//
// 시나리오마다 격리된 테스트 유저를 만들어 processSession 을 돌리고 끝나면
// 지운다(CASCADE). 실유저 데이터는 안 건드린다. 시나리오당 LLM 1회.
import fs from 'node:fs';
import zlib from 'node:zlib';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { buildCompressedLog, normalizeEvent } from '../../extension/src/session/builder';
import type { RawEvent, SessionDraft } from '../../extension/src/session/types';

const env = fs.readFileSync('.env.local', 'utf8');
const g = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.ANTHROPIC_API_KEY ||= g('ANTHROPIC_API_KEY');
process.env.DATABASE_URL ||= g('DATABASE_URL');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'));
const sql = postgres(g('DATABASE_URL'), { prepare: false });
const { processSession, buildUserMessage } = await import('../src/lib/experience-engine');

/** 콜드 스토리지 원본 → 지금 압축기로 다시 만든 로그. */
async function logOf(prefix: string) {
  for (const u of (await sb.storage.from('na-raw').list('raw')).data ?? []) {
    for (const d of (await sb.storage.from('na-raw').list(`raw/${u.name}`)).data ?? []) {
      for (const f of (await sb.storage.from('na-raw').list(`raw/${u.name}/${d.name}`)).data ?? []) {
        if (!f.name.startsWith(prefix)) continue;
        const blob = await sb.storage.from('na-raw').download(`raw/${u.name}/${d.name}/${f.name}`);
        const txt = zlib.gunzipSync(Buffer.from(await blob.data!.arrayBuffer())).toString('utf8');
        const events = txt.trim().split('\n').map((l) => normalizeEvent(JSON.parse(l) as RawEvent));
        const draft: SessionDraft = {
          id: randomUUID(), startedAt: events[0].at, lastActivityAt: events.at(-1)!.at,
          primaryCategory: 'dev', events, switchCount: 0, tags: [], domains: {}, activityScore: 0,
        };
        const log = buildCompressedLog(draft);
        return { log: { ...log, segments: log.segments.map((s, i) => ({ i, ...s })) }, events };
      }
    }
  }
  throw new Error(`원본 없음: ${prefix}`);
}

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await sql`insert into users (id, extension_key) values (${id}, ${'na_test_' + id.slice(0, 8)})`;
  await sql`insert into characters (user_id) values (${id})`;
  return id;
}

async function insertSession(userId: string, log: unknown, events: { at: number; domain: string }[]) {
  const id = randomUUID();
  await sql`insert into sessions (id, user_id, started_at, ended_at, duration_min, close_reason,
              primary_category, activity_score, unique_domains, switch_count, tags, compressed_log, domains)
            values (${id}, ${userId}, ${new Date(events[0].at)}, ${new Date(events.at(-1)!.at)},
              ${Math.round((events.at(-1)!.at - events[0].at) / 60000)}, 'switch', 'dev', 3000,
              ${new Set(events.map((e) => e.domain)).size}, 2, ARRAY[]::text[],
              ${JSON.stringify(log)}::jsonb, '{}'::jsonb)`;
  return id;
}

const results: Record<string, unknown>[] = [];
const users: string[] = [];

// ── A. 분할 안 하는 세션 (구간 하나) ──
if (!process.argv.includes('--only-c'))
{
  const { log, events } = await logOf('fa86f523');
  const u = await makeUser(); users.push(u);
  const s = await insertSession(u, log, events);
  await processSession(s, u);
  const rows = await sql`select category, outcome, duration_min, segment_ids from experiences where session_id = ${s}`;
  results.push({ 시나리오: 'A 단일 경험', 경험: rows.length, 상세: rows.map((r) => `${r.category}/${r.outcome} ${r.duration_min ?? '-'}분`).join(' | ') });
}

// ── B. 활성 갈래에 attach ──
if (!process.argv.includes('--only-c'))
{
  const { log, events } = await logOf('fa86f523');
  const u = await makeUser(); users.push(u);
  const tid = randomUUID();
  const s0 = await insertSession(u, log, events);
  await sql`insert into threads (id, user_id, title, category, status, started_at, last_activity_at, experience_count)
            values (${tid}, ${u}, 'Project NA 기술 아키텍처 설계', 'dev', 'active', now() - interval '3 days', now() - interval '1 day', 5)`;
  await sql`insert into experiences (user_id, session_id, thread_id, occurred_at, summary, category, outcome, memory_score)
            values (${u}, ${s0}, ${tid}, now() - interval '1 day', 'Project NA 의 기술 아키텍처를 Claude 와 함께 설계했다', 'dev', 'partial', 20)`;
  const s = await insertSession(u, log, events);
  await processSession(s, u);
  const rows = await sql`select e.category, e.outcome, t.title, t.experience_count, t.status
                           from experiences e join threads t on t.id = e.thread_id where e.session_id = ${s}`;
  results.push({ 시나리오: 'B 활성 갈래 attach', 경험: rows.length,
    상세: rows.map((r) => `${r.title} (${r.experience_count}건)`).join(' | ') });
}

// ── C. 교정 반영: 같은 세션을 교정 있는 유저 / 없는 유저로 각각 태운다 ──
for (const withCorrection of [false, true]) {
  const { log, events } = await logOf('fa86f523');
  const u = await makeUser(); users.push(u);
  const s0 = await insertSession(u, log, events);
  // 최근 경험 3건 — 모델이 dev 로 판정했던 것들
  // **세션 시작보다 앞선 시각**이어야 프롬프트에 실린다 — 엔진은 모델이 미래를
  // 보지 못하게 occurred_at < session.started_at 으로 거른다(오프라인 버퍼링
  // 때문에 세션이 며칠 늦게 도착할 수 있다).
  const sessionStart = new Date(events[0].at);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const [r] = await sql<{ id: string }[]>`
      insert into experiences (user_id, session_id, occurred_at, summary, category, outcome, memory_score)
      values (${u}, ${s0}, ${new Date(sessionStart.getTime() - (i + 1) * 3600_000)},
              ${'ZEP 메타버스 행사 자료를 훑어봤다'}, 'study', 'explore', 10) returning id`;
    ids.push(r.id);
  }
  if (withCorrection) {
    // 사람이 셋 다 dev 로 고쳤다 — 모델이 study 로 흘리던 것을 바로잡은 이력.
    // 대조가 되려면 교정 방향이 모델의 기본 판정과 **반대**여야 한다.
    for (const id of ids) {
      await sql`insert into corrections (user_id, experience_id, field, model_value, human_value, source)
                values (${u}, ${id}, 'category', 'study', 'dev', 'diary')`;
    }
  }
  const s = await insertSession(u, log, events);
  await processSession(s, u);
  const rows = await sql`select category, outcome from experiences where session_id = ${s}`;
  results.push({ 시나리오: `C 교정 ${withCorrection ? '있음' : '없음'}`, 경험: rows.length,
    상세: rows.map((r) => `${r.category}/${r.outcome}`).join(' | ') });
}

// ── D. 멱등성: 같은 세션을 두 번 (LLM 은 안 불린다 — processed_at 가드) ──
if (!process.argv.includes('--only-c'))
{
  const { log, events } = await logOf('fa86f523');
  const u = await makeUser(); users.push(u);
  const s = await insertSession(u, log, events);
  await processSession(s, u);
  const before = await sql`select count(*)::int as n from experiences where session_id = ${s}`;
  await processSession(s, u); // 두 번째
  const after = await sql`select count(*)::int as n from experiences where session_id = ${s}`;
  results.push({ 시나리오: 'D 멱등성(2회 처리)', 경험: after[0].n,
    상세: `1회 후 ${before[0].n}건 → 2회 후 ${after[0].n}건 ${before[0].n === after[0].n ? '(같다)' : '(중복!)'}` });
}

console.table(results);

// ── 프롬프트에 교정이 실리는지 (LLM 0콜) ──
const msg = buildUserMessage(
  { primaryCategory: 'dev', durationMin: 30, closeReason: 'idle', activityScore: 300,
    domains: {}, compressedLog: { segments: [], tags: [], queries: [] } },
  [], [{ summary: 'GitHub 에서 코드를 읽었다', category: 'study', outcome: 'explore', isFirstTime: false, corrected: true }],
  [], [], [{ field: 'category', from: 'dev', to: 'study', count: 3 }],
);
console.log('\n프롬프트에 실리는가:');
console.log('  [사람이 고침] 표시:', msg.includes('[사람이 고침]') ? '있음' : '없음');
console.log('  교정 분포 절:', msg.includes('네가 바로잡힌 판정') ? '있음' : '없음');
console.log('  분포 내용:', msg.match(/- category: .*/)?.[0] ?? '(없음)');

for (const u of users) await sql`delete from users where id = ${u}`;
console.log('\n테스트 데이터 정리 완료');
await sql.end(); process.exit(0);
