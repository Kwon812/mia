// 실데이터에서 대조축이 뽑히는지 본다. LLM 0회.
import fs from 'node:fs';
import postgres from 'postgres';
const url = fs.readFileSync('.env.local','utf8').match(/DATABASE_URL="?([^"\n]+)"?/)![1];
process.env.DATABASE_URL ||= url;
const { loadCorrectionPatterns } = await import('../src/lib/corrections');
const sql = postgres(url, { prepare: false });
const [u] = await sql`select id from users limit 1`;
const ps = await loadCorrectionPatterns((u as any).id);
console.log(`패턴 ${ps.length}줄`);
ps.forEach((p:any)=>console.log(`  ${String(p.count).padStart(2)}회  ${p.text ?? `${p.field}: ${p.from} → ${p.to}`}`));
await sql.end();
