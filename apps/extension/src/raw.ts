// ============================================================
// 원본 이벤트 업로드 — 압축 전 관측을 서버 콜드 스토리지로 올린다.
//
// sessions.compressed_log 와 목적이 정반대다.
//   compressed_log : Haiku 프롬프트 입력. 소비자가 모델이라 **작을수록** 좋다.
//   여기(원본)     : 1년 뒤의 재압축기가 소비자라 **클수록** 좋다.
// 하나로 겸하게 하면 둘 다 나빠진다. 그래서 경로를 따로 낸다 — 압축 상한
// (MAX_QUERIES 등)은 손대지 않고, 원본은 무손실로 따로 보낸다.
//
// 단 리댁션(session/redact.ts)은 예외로 원본에도 이미 걸려 있다. 그건 비용
// 상한이 아니라 "애초에 안 본 것으로 한다"는 정책이라, 원본에서도 빠져야 한다.
// (적용은 sw.ts 의 rawEvents.add 직전 — 여기 오기 훨씬 전이다.)
// ============================================================

import { API_BASE } from './config';
import { db, type ArchivedRawEvent } from './db';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 스토리지 경로의 날짜 폴더 — KST 달력일.
 *
 *  일기의 하루 경계(새벽 4시, session/rules.ts)와는 일부러 다르다. 이건 판정에
 *  쓰이는 값이 아니라 객체를 기간으로 잘라 읽기 위한 폴더 이름이다. 새벽 4시
 *  경계를 여기까지 끌고 오면 "8월 5일 폴더에 8월 6일 02시 세션이 들어있다"가
 *  되어 나중에 읽는 쪽이 더 헷갈린다. */
function kstDate(epochMs: number): string {
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * JSONL 한 줄 = 이벤트 하나. 봉투 필드는 packages/shared/src/assertion.ts 의
 * RawEnvelope 가 정본이다 — 확장은 @na/shared 를 의존하지 않으므로(번들 크기)
 * 여기서는 리터럴로 적는다. 저쪽을 바꾸면 여기도 바꾼다.
 *
 * class 는 항상 'observed' 다. 이 스토어에는 센서가 본 것만 들어간다 —
 * 사람이 선언한 값(declared)은 corrections 로, 모델이 추론한 값(inferred)은
 * Postgres 로 간다. 셋을 섞으면 1년 뒤 학습 데이터를 뽑을 때 모델 출력을
 * 다시 학습시키게 된다.
 */
function toEnvelope(row: ArchivedRawEvent): string {
  return JSON.stringify({
    v: 1, // RAW_ENVELOPE_VERSION
    class: 'observed',
    source: 'browser',
    at: row.at,
    session_id: row.sessionId,
    kind: row.kind,
    domain: row.domain,
    payload: row.payload,
  });
}

export function buildJsonl(rows: readonly ArchivedRawEvent[]): string {
  // 시간순으로 고정한다. IndexedDB 반환 순서에 맡기면 파일마다 순서가 달라져
  // 나중에 재압축할 때 구간 계산이 어긋난다.
  return [...rows]
    .sort((a, b) => a.at - b.at)
    .map(toEnvelope)
    .join('\n');
}

/** MV3 서비스 워커에서 쓸 수 있는 CompressionStream 으로 gzip 한다.
 *  전송량이 1/10 로 줄고, 서버는 받은 바이트를 그대로 저장만 하면 된다
 *  (서버에서 압축하면 함수 CPU 를 쓰고 저장 포맷도 서버 구현에 묶인다). */
async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/**
 * 한 세션의 원본을 묶어 올린다.
 *
 * best effort 다 — 실패해도 rawArchive 에 uploaded=0 으로 남고 retry 알람이
 * 10분마다 다시 집어간다. 세션 전송(flushSession)과 같은 수준의 신뢰도를
 * 요구하지 않는 이유는, 원본이 조금 빠지는 것보다 마감 경로가 느려지거나
 * 실패하는 쪽이 훨씬 나쁘기 때문이다.
 *
 * @returns 업로드 성공 여부
 */
export async function uploadSessionRaw(sessionId: string, extensionKey: string): Promise<boolean> {
  const rows = await db.rawArchive.where('sessionId').equals(sessionId).toArray();
  const pendingRows = rows.filter((r) => r.uploaded === 0);
  if (pendingRows.length === 0) return true; // 올릴 게 없으면 성공으로 친다

  // 부분 업로드를 만들지 않는다 — 객체는 세션 단위로 통째로 덮어쓴다(upsert).
  // uploaded=1 인 게 섞여 있어도 전량을 다시 싣는다. 그래야 재시도가 멱등하다.
  const jsonl = buildJsonl(rows);
  const date = kstDate(Math.min(...rows.map((r) => r.at)));

  try {
    const body = await gzip(jsonl);
    const url = `${API_BASE}/api/raw?session_id=${encodeURIComponent(sessionId)}&date=${date}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip', 'X-Extension-Key': extensionKey },
      body,
    });

    if (res.ok) {
      await db.rawArchive.where('sessionId').equals(sessionId).modify({ uploaded: 1 });
      return true;
    }

    // 4xx 는 몇 번을 보내도 같은 답이다(429 제외 — 과부하는 시간이 풀어준다).
    // 재시도 대상에서 빼려면 uploaded 를 1 로 올려야 하는데, 그러면 "올라갔다"는
    // 거짓말이 된다. 대신 그대로 두고 3일 뒤 보관 기한에 정리되게 둔다 —
    // 원본은 없어도 되는 데이터이지 거짓으로 표시할 데이터가 아니다.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      console.error('[NA] 원본 업로드를 서버가 거부했다', sessionId, res.status);
    }
    return false;
  } catch {
    return false; // 네트워크 오류 — retry 알람이 맡는다
  }
}

/**
 * 아직 못 올린 세션들을 모아 재시도한다 (retry 알람에서 호출).
 * 세션 하나씩 순차로 — 동시에 던지면 오프라인 복귀 직후 수십 개가 한꺼번에
 * 나가 서버와 브라우저 양쪽에 부담이 된다.
 */
export async function retryPendingRaw(extensionKey: string, limit = 5): Promise<void> {
  const stuck = await db.rawArchive.where('uploaded').equals(0).toArray();
  const sessionIds = [...new Set(stuck.map((r) => r.sessionId))].filter((id) => id !== '');
  for (const id of sessionIds.slice(0, limit)) {
    await uploadSessionRaw(id, extensionKey);
  }
}
