// 한 세션이 실제로 나뉘는지 본다 — 원본에서 압축 로그를 다시 만들어 LLM 에 태운다.
//   실행: npx tsx scripts/probe-split.mts [세션id...]
//
// 저장된 compressed_log 로는 시험이 안 된다. 그건 옛 압축기의 결과라 sec 도
// via 도 없고, 앞부분이 잘려 있어 애초에 다른 대상이 안 보인다.
// LLM 을 세션당 1회 부른다. DB 는 건드리지 않는다.
import fs from 'node:fs';
import zlib from 'node:zlib';
import Anthropic from '@anthropic-ai/sdk';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { buildCompressedLog, normalizeEvent } from '../../extension/src/session/builder';
import type { RawEvent, SessionDraft } from '../../extension/src/session/types';
import {
  MODEL, TOOL_NAME, RECORD_EXPERIENCE_TOOL, SYSTEM_PROMPT_V7, buildUserMessage, planItems, segmentsOf,
} from '../src/lib/experience-engine';
import { experienceOutputSchema } from '../../../packages/shared/src/experience';

const env = fs.readFileSync('.env.local', 'utf8');
const g = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.ANTHROPIC_API_KEY ||= g('ANTHROPIC_API_KEY');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'));
const sql = postgres(g('DATABASE_URL'), { prepare: false });
const client = new Anthropic();

const wanted = process.argv.slice(2);
const users = (await sb.storage.from('na-raw').list('raw')).data ?? [];
const targets: { sessionId: string; path: string }[] = [];
for (const u of users) {
  for (const d of (await sb.storage.from('na-raw').list(`raw/${u.name}`)).data ?? []) {
    for (const f of (await sb.storage.from('na-raw').list(`raw/${u.name}/${d.name}`)).data ?? []) {
      const id = f.name.replace('.jsonl.gz', '');
      if (wanted.length === 0 || wanted.some((w) => id.startsWith(w))) {
        targets.push({ sessionId: id, path: `raw/${u.name}/${d.name}/${f.name}` });
      }
    }
  }
}

for (const t of targets) {
  const [row] = await sql<{ primaryCategory: string; durationMin: number; closeReason: string; activityScore: number; domains: Record<string, number>; startedAt: Date }[]>`
    select primary_category as "primaryCategory", duration_min as "durationMin", close_reason as "closeReason",
           activity_score as "activityScore", domains, started_at as "startedAt"
      from sessions where id = ${t.sessionId}`;
  if (!row) continue;

  const blob = await sb.storage.from('na-raw').download(t.path);
  if (!blob.data) continue;
  const text = zlib.gunzipSync(Buffer.from(await blob.data.arrayBuffer())).toString('utf8');
  const events = text.trim().split('\n').map((l) => normalizeEvent(JSON.parse(l) as RawEvent));
  const draft: SessionDraft = {
    id: t.sessionId, startedAt: events[0]?.at ?? 0, lastActivityAt: events.at(-1)?.at ?? 0,
    primaryCategory: row.primaryCategory, events, switchCount: 0, tags: [], domains: {}, activityScore: 0,
  };
  const log = buildCompressedLog(draft);
  // 구간에 번호를 박아 넘긴다 — 모델이 세다가 틀리면 배정이 통째로 무효가 된다.
  const numbered = { ...log, segments: log.segments.map((s2, i) => ({ i, ...s2 })) };

  const res = await client.messages.create({
    model: MODEL, max_tokens: 2048, temperature: 0, system: SYSTEM_PROMPT_V7,
    tools: [RECORD_EXPERIENCE_TOOL], tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: buildUserMessage(
      { primaryCategory: row.primaryCategory, durationMin: row.durationMin, closeReason: row.closeReason,
        activityScore: row.activityScore, domains: row.domains, compressedLog: numbered },
      [], [], [], [], [],
    ) }],
  });
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const parsed = experienceOutputSchema.safeParse(tu?.input);
  // 그 세션으로 예전에 무엇이 나왔나 — 새 압축기·새 프롬프트와 나란히 본다.
  const olds = await sql<{ summary: string; category: string; outcome: string; memoryScore: number }[]>`
    select summary, category, outcome, memory_score as "memoryScore"
      from experiences where session_id = ${t.sessionId} order by occurred_at`;
  console.log(`\n══ ${t.sessionId.slice(0, 8)} · ${row.durationMin}분 · 구간 ${log.segments.length}개${log.earlier ? ` (+앞부분 ${Math.round(log.earlier.sec / 60)}분)` : ''}`);
  for (const o of olds) {
    console.log(`  옛: "${o.summary.slice(0, 60)}" [${o.category}/${o.outcome}] M${o.memoryScore}`);
  }
  if (!parsed.success) { console.log('  검증 실패:', parsed.error.issues.slice(0, 2)); continue; }

  const out = parsed.data;
  console.log(`  모델: "${out.summary}" [${out.category}/${out.outcome}] 구간 ${JSON.stringify(out.segment_ids ?? [])}`);
  for (const a of out.also ?? []) console.log(`  also: "${a.summary}" [${a.category}/${a.outcome}] 구간 ${JSON.stringify(a.segment_ids ?? [])}`);

  const items = planItems(out, segmentsOf(numbered), row.durationMin);
  console.log(`  → 경험 ${items.length}개`);
  for (const it of items) {
    const at = Number.isNaN(it.occurredAt.getTime()) ? row.startedAt : it.occurredAt;
    console.log(`     ${String(it.durationMin).padStart(3)}분 · ${at.toISOString().slice(11, 16)} · ${it.category}/${it.outcome} · ${it.summary.slice(0, 46)}`);
  }
}
await sql.end(); process.exit(0);
