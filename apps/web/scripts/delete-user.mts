// 유저 삭제 — Postgres 와 Storage 를 **둘 다** 지우는 유일한 정식 경로.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/delete-user.mts <user_id>
//
// users 행만 지우면 삭제가 반쪽이 된다. schema.ts 의 onDelete:'cascade' 는
// Postgres 안에서만 돌기 때문에 Storage 의 raw/{user_id}/ 는 그대로 남는다.
// 개인 관측 원본을 통째로 보관하는 경로라 이건 단순 누수가 아니라 사고다.
//
// 순서는 **Storage 먼저, DB 나중**이다. DB 를 먼저 지우고 중간에 죽으면 남은
// 객체를 어느 유저 것인지 되짚을 방법이 사라진다. 반대 순서면 중간에 죽어도
// 같은 명령을 다시 돌리면 된다(이미 빈 prefix 삭제는 0건으로 무해하다).
import fs from 'node:fs';
import postgres from 'postgres';

const userId = process.argv[2];
if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
  console.error('사용법: delete-user.mts <user_id(uuid)>');
  process.exit(1);
}

const env = fs.readFileSync('.env.local', 'utf8');
const pick = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= pick('NEXT_PUBLIC_SUPABASE_URL');
process.env.SUPABASE_SERVICE_ROLE_KEY ||= pick('SUPABASE_SERVICE_ROLE_KEY');

// server-only import 를 타므로 env 를 채운 뒤에 동적 import 한다.
const { deleteUserRawObjects } = await import('../src/lib/raw-storage');

const sql = postgres(pick('DATABASE_URL'), { prepare: false });

const [user] = await sql`select id from users where id = ${userId}`;
if (!user) {
  console.error(`users 에 ${userId} 가 없다. Storage 만 정리한다.`);
}

const removed = await deleteUserRawObjects(userId);
console.log(`Storage 원본 ${removed}건 삭제`);

const deleted = await sql`delete from users where id = ${userId} returning id`;
console.log(`users ${deleted.length}행 삭제 (cascade 로 하위 테이블 정리됨)`);

await sql.end();
