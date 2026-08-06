// 카테고리 표에 없어서 etc 로 떨어진 도메인을 체류 시간 순으로 뽑는다.
//   실행: npx tsx scripts/unmapped-domains.mts
//
// 표를 손으로 채우면 끝이 없다. 실제로 가는 곳부터 채우면 몇 개로 대부분이 덮인다.
import fs from 'node:fs'; import postgres from 'postgres';
// 확장의 현재 규칙을 그대로 쓴다. 저장된 compressed_log 의 category 는 그때의
// 표로 매긴 값이라, 표를 고친 뒤에는 개선이 안 보인다.
import { categorize } from '../../extension/src/session/categories';
const env = fs.readFileSync('.env.local','utf8');
const sql = postgres(env.match(/DATABASE_URL="?([^"\n]+)"?/)?.[1] ?? '', { prepare: false });

const rows = await sql<{ domains: Record<string, number>; log: any }[]>`
  select domains, compressed_log as log from sessions`;

const dwell = new Map<string, number>();
for (const r of rows) for (const [d, sec] of Object.entries(r.domains ?? {})) {
  dwell.set(d, (dwell.get(d) ?? 0) + sec);
}
const unmapped = [...dwell.entries()]
  .filter(([d]) => categorize(d) === 'etc')
  .filter(([d]) => !['newtab', 'etc', 'extensions'].includes(d))
  .sort((a, b) => b[1] - a[1]);

const total = [...dwell.values()].reduce((a, b) => a + b, 0);
const lost = unmapped.reduce((a, [, s]) => a + s, 0);
console.log(`전체 체류 ${Math.round(total/60)}분 중 미분류 ${Math.round(lost/60)}분 (${(lost/total*100).toFixed(0)}%)\n`);
console.table(unmapped.map(([d, s]) => ({ 도메인: d, 체류분: +(s/60).toFixed(1) })));
await sql.end(); process.exit(0);
