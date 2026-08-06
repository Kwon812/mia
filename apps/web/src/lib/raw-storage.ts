import 'server-only';

import { createAdminClient } from './supabase/admin';

// ============================================================
// 원본 관측의 콜드 스토리지 (Supabase Storage)
//
// Postgres 가 아니라 오브젝트 스토리지인 이유: 이 데이터는 **절대 조인하지
// 않는다.** 1년 뒤 배치가 기간으로 잘라 전량 스캔할 뿐이다. 행으로 넣으면
// 연 수백만 행이 되고 인덱스·백업 비용만 붙는다.
//
// Supabase 를 고른 이유는 이미 있어서다 — 새 벤더는 Render(render.yaml)와
// Vercel 양쪽에 시크릿을 하나씩 더 요구한다. 연 45MB 짜리 데이터 때문에
// 실패 지점을 둘 늘릴 이유가 없다. 커지면 그때 옮기면 되고, S3 호환
// 엔드포인트가 있어 경로 규약만 지키면 이전 비용이 거의 없다.
// ============================================================

/** private 버킷. supabase/migrations 에서 생성한다.
 *  public 이면 경로만 알아도 남의 원본이 열린다 — 반드시 private. */
export const RAW_BUCKET = 'na-raw';

/**
 * 객체 경로. 날짜를 중간에 두는 건 1년 뒤 재압축기가 **기간으로 잘라** 읽기
 * 위해서다 — 전량을 한 번에 받는 게 불가능해지는 시점이 반드시 온다.
 * user_id 를 최상위에 두면 유저 삭제 시 prefix 하나로 정리된다.
 */
export function rawObjectPath(userId: string, date: string, sessionId: string): string {
  return `raw/${userId}/${date}/${sessionId}.jsonl.gz`;
}

/** date 폴더는 KST 달력일(YYYY-MM-DD). 경로 조작(../)을 막는 역할도 겸한다. */
export const RAW_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * gzip 바이트를 그대로 저장한다. 압축은 확장이 이미 했다 —
 * 서버에서 다시 하면 함수 CPU 를 쓰고 저장 포맷이 서버 구현에 묶인다.
 *
 * upsert 인 이유: 확장의 재시도가 멱등해야 한다. 같은 세션을 두 번 올리면
 * 덮어쓸 뿐이고, 확장은 항상 그 세션의 **전량**을 다시 싣기 때문에
 * 덮어쓴 쪽이 언제나 더 완전하거나 같다.
 */
export async function putRawObject(
  userId: string,
  date: string,
  sessionId: string,
  body: ArrayBuffer,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(RAW_BUCKET)
    .upload(rawObjectPath(userId, date, sessionId), body, {
      contentType: 'application/gzip',
      upsert: true,
    });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 한 유저의 원본을 전부 지운다.
 *
 * ⚠️ 이 함수가 없으면 유저 삭제가 반쪽이 된다. schema.ts 의
 * `onDelete: 'cascade'` 는 **Postgres 안에서만** 돈다 — users 행을 지워도
 * Storage 의 raw/{user_id}/ 는 그대로 남는다. 개인 관측을 통째로 보관하는
 * 경로라 이건 단순 누수가 아니라 사고다.
 *
 * 호출처: apps/web/scripts/delete-user.mts (유저 삭제의 유일한 정식 경로).
 */
export async function deleteUserRawObjects(userId: string): Promise<number> {
  const admin = createAdminClient();
  const prefix = `raw/${userId}`;
  let removed = 0;

  // Storage 의 list 는 한 계층씩만 본다 — 날짜 폴더를 먼저 훑고 그 안을 지운다.
  const { data: dateDirs, error: dirErr } = await admin.storage.from(RAW_BUCKET).list(prefix);
  if (dirErr) throw new Error(`raw prefix 조회 실패: ${dirErr.message}`);

  for (const dir of dateDirs ?? []) {
    // list 는 페이지네이션이 있다(기본 100). 하루 세션이 100 개를 넘을 수 있어
    // 빈 페이지가 나올 때까지 돈다 — 안 그러면 조용히 일부만 지운다.
    for (;;) {
      const { data: objects, error } = await admin.storage
        .from(RAW_BUCKET)
        .list(`${prefix}/${dir.name}`, { limit: 100 });
      if (error) throw new Error(`raw 객체 조회 실패: ${error.message}`);
      if (!objects || objects.length === 0) break;

      const paths = objects.map((o) => `${prefix}/${dir.name}/${o.name}`);
      const { error: rmErr } = await admin.storage.from(RAW_BUCKET).remove(paths);
      if (rmErr) throw new Error(`raw 객체 삭제 실패: ${rmErr.message}`);
      removed += paths.length;
    }
  }

  return removed;
}
