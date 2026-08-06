// ============================================================
// POST /api/raw?session_id=<uuid>&date=<YYYY-MM-DD>
//
// 확장이 세션 마감 시 보내는 **압축 전 원본 관측**을 받아 콜드 스토리지에
// 그대로 얹는다. body 는 gzip 된 JSONL 바이트다.
//
// /api/sessions 와 의도적으로 분리했다.
//   /api/sessions : compressed_log(모델 입력) → Postgres → Experience Engine
//   /api/raw      : 원본(1년 뒤 재압축용) → Storage. LLM 도 Postgres 도 안 탄다.
// 하나로 합치면 sessionPayloadSchema 가 무거워지고, 원본 업로드 실패가
// 세션 저장 실패로 번진다.
//
// 확장이 Storage 에 직접 쓰지 않는 이유: 확장은 익명 extension_key 로만
// 우리 API 와 말한다. 여기에 Storage 자격을 넣으면 그게 그대로 유출 지점이 된다.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByExtensionKey } from '@/lib/api-auth';
import { RAW_DATE_RE, putRawObject } from '@/lib/raw-storage';

/** 업로드 상한. 확장은 세션당 gzip 후 수 KB 규모지만, 상한이 없으면 잘못된
 *  클라이언트 하나가 스토리지를 채운다. Vercel 함수 body 한도(4.5MB)보다
 *  넉넉히 아래로 잡는다 — 여기 걸릴 정도면 확장 쪽 버그다. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const user = await getUserByExtensionKey(req);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id') ?? '';
    const date = url.searchParams.get('date') ?? '';

    // 둘 다 그대로 객체 경로가 된다. uuid·날짜 형식 검증이 곧 경로 조작 방어다.
    if (!z.uuid().safeParse(sessionId).success) {
      return NextResponse.json({ error: 'invalid_session_id' }, { status: 400 });
    }
    if (!RAW_DATE_RE.test(date)) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
    }

    const body = await req.arrayBuffer();
    if (body.byteLength === 0) {
      return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    }
    if (body.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }

    const result = await putRawObject(user.id, date, sessionId, body);
    if (!result.ok) {
      // 스토리지 장애는 5xx 다 — 확장이 재시도 대상으로 남겨야 한다.
      // 4xx 로 답하면 확장이 "재시도해도 소용없는 실패"로 보고 포기한다.
      console.error('[POST /api/raw] storage 실패', result.error);
      return NextResponse.json({ error: 'storage_error' }, { status: 503 });
    }

    // ingest_failures 에 남기지 않는다 — 그 테이블은 "경험이 될 수 있었는데
    // 못 된 것"을 추적한다. 원본은 LLM 경로를 타지 않아 성격이 다르고,
    // 실패는 확장의 rawArchive(uploaded=0)에 그대로 남아 재시도된다.
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (err) {
    console.error('[POST /api/raw] failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
