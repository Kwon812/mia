// 콜드 스토리지의 원본 rawEvents 를 지금 압축기에 그대로 태워본다.
//   실행: npx tsx scripts/replay-raw.mts
//
// 압축기(builder.ts)를 고치면 저장된 compressed_log 로는 검증이 안 된다 —
// 그건 옛 압축기의 결과물이라 무엇이 달라졌는지 알 수 없다. 원본을 다시 태워야
// "이 세션이 새 규칙에서는 어떻게 보이나"를 실제로 볼 수 있다.
// LLM 은 안 부른다.
import fs from 'node:fs';
import zlib from 'node:zlib';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { buildCompressedLog, normalizeEvent, MAX_SEGMENTS } from '../../extension/src/session/builder';
import type { RawEvent, SessionDraft } from '../../extension/src/session/types';

const env = fs.readFileSync('.env.local', 'utf8');
const g = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'));
const sql = postgres(g('DATABASE_URL'), { prepare: false });

const users = (await sb.storage.from('na-raw').list('raw')).data ?? [];
let checked = 0;
for (const u of users) {
  const days = (await sb.storage.from('na-raw').list(`raw/${u.name}`)).data ?? [];
  for (const d of days) {
    const files = (await sb.storage.from('na-raw').list(`raw/${u.name}/${d.name}`)).data ?? [];
    for (const f of files) {
      const sessionId = f.name.replace('.jsonl.gz', '');
      const [row] = await sql<{ durationMin: number; log: { segments?: unknown[] } }[]>`
        select duration_min as "durationMin", compressed_log as log from sessions where id = ${sessionId}`;
      if (!row) continue;
      const blob = await sb.storage.from('na-raw').download(`raw/${u.name}/${d.name}/${f.name}`);
      if (!blob.data) continue;
      const text = zlib.gunzipSync(Buffer.from(await blob.data.arrayBuffer())).toString('utf8');
      const raws: RawEvent[] = text.trim().split('\n').map((l) => JSON.parse(l));
      const events = raws.map(normalizeEvent);
      const draft: SessionDraft = {
        id: sessionId, startedAt: events[0]?.at ?? 0, lastActivityAt: events.at(-1)?.at ?? 0,
        primaryCategory: 'dev', events, switchCount: 0, tags: [], domains: {}, activityScore: 0,
      };
      // 절단 전 개수를 보려고 상한을 임시로 크게 잡아 한 번 더 돌린다.
      const next = buildCompressedLog(draft);
      // 상한을 안 건 결과도 같이 본다 — 접기가 얼마나 줄였는지 보려면 필요하다.
      const unlimited = buildCompressedLog(draft, Number.MAX_SAFE_INTEGER);
      void MAX_SEGMENTS;
      const e = next.earlier;
      const oldCount = row.log?.segments?.length ?? 0;
      const covered = Math.round(next.segments.reduce((a, s) => a + s.sec, 0) / 60);
      console.log(
        `${sessionId.slice(0, 8)}  ${String(row.durationMin).padStart(4)}분  이벤트 ${String(raws.length).padStart(4)}  ` +
        `구간 ${String(oldCount).padStart(2)} → ${String(next.segments.length).padStart(2)}  ` +
        `접은 뒤 ${String(unlimited.segments.length).padStart(3)}  상세 ${String(covered).padStart(3)}분` +
        (e ? ` + 앞부분요약 ${Math.round(e.sec / 60)}분(${e.segments}구간)  →  ${e.top.slice(0, 3).join(' / ')}` : ''),
      );
      checked += 1;
    }
  }
}
console.log(`\n검증한 세션 ${checked}개`);
await sql.end(); process.exit(0);
