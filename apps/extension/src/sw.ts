import { API_BASE } from './config';
import { db, type RawEvent } from './db';
import { retryPendingRaw, uploadSessionRaw } from './raw';
import {
  close,
  continueDraft,
  hasScoringEvent,
  idleGapBefore,
  ingest,
  isBlockedDomain,
  redactPayload,
  sendSkipReason,
  shouldClose,
  timeUntilClose,
} from './session';
import type { SessionDraft, SessionPayloadLike } from './session';
import type { SessionSnapshot, SnapshotDraft, SnapshotPreview } from './snapshot';

// 서비스 워커: manifest 에서 "type": "module" 이므로 정적 import 사용 가능.
// 다만 이 파일은 vite 멀티 엔트리 빌드에서 content.ts 와 공유 청크를 만들지
// 않도록 db.ts / config.ts / session/* 를 이 파일에서만 참조한다 (vite.config.ts
// 참고 — content.ts 는 이 모듈들을 import 하지 않으므로 청크 공유가 생기지 않는다).
//
// 절대 금지: setInterval, 전역 변수에 상태 저장.
// 대체: chrome.alarms + IndexedDB(Dexie, db.ts). session/* 의 규칙 함수들도
// 전부 순수 함수라 여기서 다루는 진행 중 세션(SessionDraft)은 항상 meta 테이블에
// 저장된 값을 읽고 쓰는 식으로만 다룬다 — 서비스 워커가 도중에 죽어도 다음
// 알람에서 그대로 이어갈 수 있다.

const ALARM_SESSION_CHECK = 'sessionCheck';
const ALARM_RETRY = 'retry';

// handleRetry(10분 알람)에서 'sending' 상태가 이 시간 이상 멈춰 있으면 고아로
// 보고 재전송한다 (계획서 03장 "전송 안정성" — 응답 대기 중 상태를 메모리가
// 아니라 pending 레코드로 남겨야 서비스 워커가 죽어도 복구 가능).
const STALE_SENDING_MS = 5 * 60 * 1000;

// archive(닫힌 세션 로컬 사본) 보관 기간 — 3일 (사용자 결정).
// DB 의 LLM 출력과 대조해 세션 분할·필터 기준을 튜닝하는 용도라
// 초반 튜닝 기간에 특히 중요하다. retry 알람에서 기한 지난 것을 지운다.
const ARCHIVE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

// rawArchive(압축 전 원본 대기열) 보관 기간 — archive 와 같은 3일.
// 업로드가 끝나면 로컬에 둘 이유가 없고, 실패해도 retry 가 10분마다 재시도하니
// 3일이면 오프라인 복귀에 충분하다. 이 기한이 지나도 못 올린 원본은 버린다 —
// 확장 IndexedDB 를 무한히 키우는 것보다 원본 일부 결손이 낫다.
const RAW_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/** 아직 어느 세션에도 배정되지 않은 원본의 sessionId 값.
 *  null 이 아닌 빈 문자열인 이유는 db.ts 의 ArchivedRawEvent 주석 참고
 *  (IndexedDB 는 null 을 인덱싱하지 않는다). */
const RAW_UNASSIGNED = '';

/** 새 키 발급 사실을 담아두는 meta 키. 사용자가 확인하면 지운다.
 *  자세한 이유는 snapshot.ts 의 SnapshotKeyNotice 주석에 있다. */
const KEY_NOTICE = 'keyNotice';

async function loadKeyNotice(): Promise<{ issuedAt: number } | null> {
  const row = await db.meta.get(KEY_NOTICE);
  const v = row?.value as { issuedAt?: unknown } | undefined;
  return typeof v?.issuedAt === 'number' ? { issuedAt: v.issuedAt } : null;
}

/** 툴바 아이콘의 경고 표시. 배지는 브라우저를 재시작하면 사라지므로
 *  워커가 깨어날 때마다 meta 를 보고 다시 세운다. */
async function syncKeyNoticeBadge(): Promise<void> {
  try {
    const notice = await loadKeyNotice();
    await chrome.action.setBadgeText({ text: notice ? '!' : '' });
    if (notice) await chrome.action.setBadgeBackgroundColor({ color: '#a9600f' });
  } catch (err) {
    // 배지는 부가 표시다. 실패해도 수집·전송에는 영향이 없어야 한다.
    console.error('[NA] 배지 갱신 실패', err);
  }
}


function registerAlarms(): void {
  // 계획서 03장의 compress(5분) 알람은 없다.
  //
  // 주의: 예전 주석은 "2차 압축은 draft 흡수가 담당한다"고 적혀 있었는데
  // 사실이 아니다. ingest 는 normalizeEvent 로 1:1 변환하고 blocked 도메인만
  // 걸러 이어붙일 뿐, 양을 줄이지 않는다 — rawEvents 테이블에서
  // meta.currentSession 안으로 옮기는 이사일 뿐이다.
  // IndexedDB 안에서 실제로 줄어드는 곳은 buildCompressedLog(마감 시점) 하나다.
  // 그래서 긴 세션이면 meta.currentSession 이 수백 KB 까지 자라고 매 1분마다
  // 통째로 다시 직렬화된다 — 알려진 비용이다(계획서 11장 튜닝 대상).
  void chrome.alarms.clear('compress'); // 구버전이 등록해둔 잔재 정리
  void chrome.alarms.clear('diary'); // 일기는 서버 야간 배치 담당 — 확장 알람 불필요
  chrome.alarms.create(ALARM_SESSION_CHECK, { periodInMinutes: 1 });
  chrome.alarms.create(ALARM_RETRY, { periodInMinutes: 10 });
}

async function registerExtensionKey(): Promise<void> {
  try {
    // 이미 키가 있으면 절대 재발급하지 않는다 — onInstalled 는 확장 새로고침
    // 때마다 발화하므로, 이 가드가 없으면 새로고침마다 새 유저(=캐릭터 리셋)가 된다.
    const existing = await getExtensionKey();
    if (existing) {
      // 미러가 비어 있으면 채워둔다. 미러 코드가 붙기 전에 발급받은 키는
      // Dexie 에만 있어서, 정작 복구가 필요한 순간(IndexedDB 소실)에 폴백이
      // 빈손이다 — 백업은 필요해지기 전에 만들어져 있어야 쓸모가 있다.
      const { extensionKey } = await chrome.storage.local.get('extensionKey');
      if (extensionKey !== existing) {
        await chrome.storage.local.set({ extensionKey: existing });
      }
      return;
    }

    const res = await fetch(`${API_BASE}/api/register`, { method: 'POST' });
    if (!res.ok) return;
    const { extension_key } = (await res.json()) as { extension_key: string };
    await db.meta.put({ key: 'extensionKey', value: extension_key });
    // chrome.storage.local 에도 미러링 — 사이트 /connect 페이지의 수동 안내
    // (콘솔에서 키 확인)가 Dexie 보다 훨씬 쉬워서다. 진실은 meta 쪽이지만,
    // meta 가 비면 getExtensionKey 가 이 미러로 되돌린다.
    await chrome.storage.local.set({ extensionKey: extension_key });

    // **발급했다는 사실을 남긴다.** 첫 설치면 배너 한 줄이 스쳐갈 뿐이지만,
    // 스토리지를 잃은 재설치면 이게 유일한 경고다 — 확장은 둘을 구분할 수
    // 없으니 양쪽 모두에 알리고 판단은 사람이 한다.
    await db.meta.put({ key: KEY_NOTICE, value: { issuedAt: Date.now() } });
    await syncKeyNoticeBadge();
  } catch {
    // 실패해도 죽지 않는다 — retry 알람 핸들러(handleRetry)가 미등록 상태를
    // 감지해 재시도하는 것으로 커버된다는 전제.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void registerExtensionKey();
  registerAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  registerAlarms();
  void handleStartup().catch((err) => console.error('[NA] startup 실패', err));
});

// 워커가 깨어날 때마다 알람이 살아 있는지 확인한다.
//
// 예전에는 등록 지점이 onInstalled 하나뿐이었다. 어떤 이유로든 알람이 한 번
// 사라지면(확장 비활성화→재활성화처럼 onInstalled 도 onStartup 도 발화하지
// 않는 경로가 있다) 복구할 방법이 코드에 전혀 없었다 — rawEvents 만 무한히
// 쌓이고 세션은 영원히 마감·전송되지 않는다. 팝업은 "열린 세션 없음 + 활동
// 신호 N건 대기 중"만 계속 띄운다.
// alarms.create 는 같은 이름이면 덮어쓰기라 중복 걱정이 없다.
void (async () => {
  const existing = await chrome.alarms.get(ALARM_SESSION_CHECK);
  if (!existing) {
    console.warn('[NA] sessionCheck 알람이 없어 다시 등록한다');
    registerAlarms();
  }
  // 배지는 브라우저 재시작으로 사라진다. 경고는 사용자가 확인할 때까지
  // 살아 있어야 하므로 워커가 깨어날 때마다 meta 를 보고 다시 세운다.
  await syncKeyNoticeBadge();
})();

// ── meta 테이블 헬퍼 (currentSession draft, extensionKey) ──

async function loadCurrentSession(): Promise<SessionDraft | null> {
  const row = await db.meta.get('currentSession');
  return (row?.value as SessionDraft | undefined) ?? null;
}

async function saveCurrentSession(draft: SessionDraft | null): Promise<void> {
  if (draft) {
    await db.meta.put({ key: 'currentSession', value: draft });
  } else {
    await db.meta.delete('currentSession');
  }
}

/**
 * 확장 키 — **Dexie 가 진실이지만 유일한 사본은 아니다.**
 *
 * 예전에는 meta 한 곳만 봤다. 그런데 이 키가 곧 계정 전체다(비밀번호가 없다).
 * IndexedDB 가 비면 registerExtensionKey 의 `if (existing) return` 가드가
 * 무력해져 새 키를 발급받고, 그 순간 **캐릭터가 통째로 갈린다.**
 *
 * 실제로 났다 — 2026-08-08 14:48 에 유저가 둘로 쪼개졌고, 그 뒤 세션은 전부
 * 이름 없는 새 계정에 쌓였다(사이트 쿠키는 옛 키라 화면에는 안 보였다).
 * registerExtensionKey 는 처음부터 chrome.storage.local 에 미러를 써두고
 * 있었는데 **읽는 코드가 없었다.** 백업이 바로 옆에 있는데 안 쓴 셈이다.
 *
 * 미러가 살아 있으면 Dexie 쪽도 되돌려놓는다 — 다음 호출부터는 한 번에 끝난다.
 */
async function getExtensionKey(): Promise<string | undefined> {
  const row = await db.meta.get('extensionKey');
  if (typeof row?.value === 'string' && row.value.length > 0) return row.value;

  try {
    const { extensionKey } = await chrome.storage.local.get('extensionKey');
    if (typeof extensionKey === 'string' && extensionKey.length > 0) {
      console.warn('[NA] meta 에 키가 없어 storage.local 미러로 복구한다');
      await db.meta.put({ key: 'extensionKey', value: extensionKey });
      return extensionKey;
    }
  } catch (err) {
    // storage 접근 실패는 삼킨다 — 여기서 던지면 마감·전송 경로가 통째로 멈춘다.
    console.error('[NA] storage.local 미러 조회 실패', err);
  }
  return undefined;
}

/**
 * 세션 전송 — 계획서 03장 "전송 안정성" 패턴 그대로, 단 'done' 상태는 두지
 * 않는다(사용자 결정): pending 에 'sending' 기록 → fetch → 성공(202) 시
 * 레코드를 즉시 delete, 실패 시 'failed' 로 남겨 재시도 대상이 되게 한다.
 * 확장 IndexedDB 에는 실패/전송 대기 중인 것만 남는다.
 * 서버는 같은 session_id 를 두 번 받아도 안전해야 한다는 전제(PK + upsert)라
 * 여기서는 재시도를 두려워하지 않고 그냥 다시 부른다.
 */
async function flushSession(payload: SessionPayloadLike): Promise<void> {
  await db.pending.put({
    id: payload.id,
    status: 'sending',
    session: payload as unknown as Record<string, unknown>,
    updatedAt: Date.now(),
  });

  // 재시도해도 소용없는 실패인가. 4xx 는 페이로드가 문제라 몇 번을 보내도
  // 같은 답이 온다 — 그런데 서버는 받을 때마다 ingest_failures 에 행을 하나씩
  // 쌓는다. 확장 큐와 서버 테이블이 동시에 무한 증식하던 경로다.
  // 429(과부하)만은 시간이 지나면 풀리므로 재시도 대상으로 남긴다.
  let rejected: string | null = null;

  try {
    const extensionKey = await getExtensionKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (extensionKey) headers['X-Extension-Key'] = extensionKey;

    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      // 성공 — 'done' 으로 남기지 않고 바로 지운다. archive 사본에만 전송 확인 마킹.
      await db.pending.delete(payload.id);
      await db.archive.update(payload.id, { sent: true });
      return;
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      rejected = `HTTP ${res.status}`;
    }
  } catch {
    // 네트워크 오류 — 재시도 대상이다.
  }

  if (rejected) {
    await db.pending.delete(payload.id);
    await db.archive.update(payload.id, { skipReason: `rejected:${rejected}` });
    console.error('[NA] 서버가 거부해 재시도를 중단한다', payload.id, rejected);
    return;
  }

  // 실패 기록 — 다만 **이미 지워진 레코드를 되살리지 않는다.**
  // 같은 세션에 flush 가 둘 겹칠 수 있다(retry 가 5분 넘은 'sending' 을 고아로
  // 보고 재전송하는데 원래 fetch 가 아직 살아있을 수 있다). 늦게 끝난 쪽이
  // 무조건 put 하면, 먼저 성공해서 지운 레코드가 'failed' 로 부활해 10분마다
  // 다시 전송된다 — 서버에 이미 저장된 세션인데도.
  await db.transaction('rw', db.pending, async () => {
    const still = await db.pending.get(payload.id);
    if (!still) return;
    await db.pending.put({
      id: payload.id,
      status: 'failed',
      session: payload as unknown as Record<string, unknown>,
      updatedAt: Date.now(),
    });
  });
}

/**
 * 흡수가 끝난 rawEvents 를 **지우는 대신 rawArchive 로 옮긴다.**
 *
 * 예전에는 여기서 bulkDelete 였다. 그래서 원본은 세션 마감 시점이 아니라
 * **1분 틱마다** 사라졌고, 세션이 닫힐 때쯤이면 이미 수십 번 지워진 뒤라
 * "마감할 때 원본 한 벌 같이 보내기"가 성립하지 않았다.
 *
 * 순서는 이 파일의 다른 곳과 같은 원칙이다 — **저장 먼저, 삭제 나중.** 여기서는
 * 한 트랜잭션으로 묶어 둘이 갈라지지 않게 한다. 중간에 죽으면 통째로 롤백되고
 * rawEvents 가 남아 다음 틱에 다시 흡수된다(중복 흡수는 활동량이 살짝 부풀 뿐
 * 데이터가 사라지지 않는다 — 유실보다 중복을 택하는 기존 판단과 같다).
 */
async function absorbRawEvents(events: readonly RawEvent[], sessionId: string): Promise<void> {
  const stored = events.filter((e) => e.id !== undefined);
  if (stored.length === 0) return;

  await db.transaction('rw', db.rawEvents, db.rawArchive, async () => {
    await db.rawArchive.bulkAdd(
      stored.map((e) => ({
        sessionId,
        at: e.at,
        kind: e.kind,
        domain: e.domain,
        payload: e.payload,
        uploaded: 0 as const,
      })),
    );
    await db.rawEvents.bulkDelete(stored.map((e) => e.id as number));
  });
}

/**
 * 아직 어느 세션에도 안 붙은 원본을 이 세션 몫으로 편입한다.
 *
 * 세션이 열리기 전에 들어온 이벤트(점수 0 짜리 배경 탭 갱신 등)는 draft 에
 * 흡수되지 않고 버려지던 것들이다. 원본 보존 관점에서는 그것도 관측이라 남기는데,
 * 세션에 안 붙으면 업로드 트리거가 영영 없어 3일 뒤 보관 기한에 조용히 사라진다.
 * 마감 시점에 직전 미배정분을 쓸어담아 이 세션 파일에 함께 싣는다.
 */
async function claimUnassignedRaw(sessionId: string): Promise<void> {
  await db.rawArchive.where('sessionId').equals(RAW_UNASSIGNED).modify({ sessionId });
}

/**
 * 마감된 세션의 원본을 콜드 스토리지로 올린다.
 *
 * **전송 필터(skipReason)와 무관하게 항상 올린다.** 그 필터는 LLM 호출 비용
 * 때문에 있는 것이고, 원본 보존은 비용과 상관이 없다 — 10분짜리 짧은 세션도
 * "그 시간에 내가 뭘 했나"의 일부다.
 */
async function uploadClosedSessionRaw(sessionId: string): Promise<void> {
  const extensionKey = await getExtensionKey();
  if (!extensionKey) return; // 미등록 — retry 알람이 키를 받은 뒤 다시 집어간다
  await uploadSessionRaw(sessionId, extensionKey);
}

/** 마감된 세션의 로컬 사본을 남긴다. 이게 유일한 내구성 기록이므로 반드시
 *  draft 정리보다 **먼저** 성공해야 한다 — 순서가 뒤면 draft 와 rawEvents 는
 *  지워졌는데 사본이 없어 세션이 통째로 사라진다(복구 경로 없음).
 *  같은 id 로 다시 불려도 put 이라 덮어쓸 뿐 중복이 안 생긴다. */
async function archiveClosed(payload: SessionPayloadLike): Promise<string | null> {
  const skipReason = sendSkipReason(payload);
  await db.archive.put({
    id: payload.id,
    closedAt: Date.now(),
    sent: false,
    skipReason,
    session: payload as unknown as Record<string, unknown>,
  });
  return skipReason;
}

async function dispatchClosedSession(payload: SessionPayloadLike): Promise<void> {
  const skipReason = sendSkipReason(payload);

  await db.archive.put({
    id: payload.id,
    closedAt: Date.now(),
    sent: false,
    skipReason,
    session: payload as unknown as Record<string, unknown>,
  });

  // 이 경로(idle 갭 마감·브라우저 재시작 마감)의 원본도 마감 시 올린다.
  // 여기 없으면 retry 알람이 10분 뒤 줍긴 하지만, 마감과 업로드가 멀어질수록
  // 그 사이 확장이 제거되거나 보관 기한에 걸릴 창이 넓어진다.
  // 이 시점의 db.rawEvents 는 아직 흡수 전이라(다음 세션 몫) 쓸려가지 않는다.
  await claimUnassignedRaw(payload.id);
  void uploadClosedSessionRaw(payload.id);

  if (skipReason === null) {
    void flushSession(payload);
  } else {
    console.debug('[NA] 세션 미전송 (전송 기준 미달):', payload.id, {
      skipReason,
      duration_min: payload.duration_min,
      activity_score: payload.activity_score,
      primary_category: payload.primary_category,
    });
  }
}

/**
 * sessionCheck 알람(1분) — 계획서 02장 아키텍처 다이어그램의 "Session builder".
 * meta.currentSession 을 읽어 새 rawEvents 를 반영하고, shouldClose() 로 종료
 * 여부를 판단한다. 종료면 확정→전송 판단, maxlen 이면 continued_from 으로 이어
 * 붙인 새 draft 를 곧바로 시작한다. 그 외에는 갱신된 draft 만 저장해둔다.
 */
async function handleSessionCheck(): Promise<void> {
  const now = Date.now();
  const [loaded, rawEvents] = await Promise.all([loadCurrentSession(), db.rawEvents.toArray()]);
  let draft = loaded;

  if (!draft && rawEvents.length === 0) return; // 아무 일도 없었다

  // 이벤트 **사이에** 숨은 유휴 구간을 흡수 전에 먼저 끊는다.
  // 알람이 돌지 않은 구간(노트북 절전, 워커가 오래 깨지 않음)은 now 기준
  // 판정으로는 안 보인다 — 깨어나자마자 들어온 이벤트가 lastActivityAt 을
  // 갱신해버리기 때문이다. 그러면 밤 10시와 아침 9시가 한 세션이 된다.
  if (draft && rawEvents.length > 0) {
    // 이미 흡수된 잔재는 빼고 본다. "저장 먼저, 삭제 나중" 순서 때문에
    // 흡수는 됐지만 아직 안 지워진 rawEvent 가 남을 수 있는데, 그 옛 시각이
    // 최소값으로 잡히면 공백이 0 으로 보여 감지가 통째로 무력화된다.
    // lastActivityAt 이후의 이벤트만이 새 활동이다.
    const fresh = rawEvents.filter((e) => e.at > draft!.lastActivityAt);
    const firstAt = fresh.length > 0 ? Math.min(...fresh.map((e) => e.at)) : null;
    if (firstAt !== null && idleGapBefore(draft, firstAt)) {
      const stale = draft;
      draft = null;
      await saveCurrentSession(null);
      // 마감 시각은 now 가 아니라 마지막 활동 시각이다. 자는 동안을 세션에
      // 넣으면 duration_min 이 통째로 거짓말이 된다.
      await dispatchClosedSession(close(stale, 'idle', stale.lastActivityAt));
    }
  }

  // 점수 0 짜리(tab_updated)만으로는 세션을 새로 시작하지 않는다. 자동
  // 새로고침 배경 탭이 30분마다 duration_min=0 짜리 빈 세션을 만들어 archive 를
  // 채우기 때문이다. 이미 열려 있는 세션에는 문맥으로 흡수된다.
  if (!draft && !hasScoringEvent(rawEvents)) {
    // 세션은 안 만들지만 관측 자체는 버리지 않는다 — 미배정으로 보관해두면
    // 다음 세션이 마감될 때 claimUnassignedRaw 가 쓸어담는다.
    await absorbRawEvents(rawEvents, RAW_UNASSIGNED);
    return;
  }

  const updated = ingest(draft, rawEvents, now);

  const reason = shouldClose(updated, now);

  // 순서가 중요하다: 반드시 **저장 먼저, 삭제 나중**이다.
  //
  // 예전에는 bulkDelete 가 먼저였다. 그 사이(브라우저 강제 종료, quota 초과로
  // archive.put 이 throw) 에 죽으면 rawEvents 는 이미 사라졌는데 draft 는
  // 갱신 전이라 그 1분치 활동이 영구 유실됐다. 마감 경로에서는 더 나빴다 —
  // dispatch 는 끝났는데 saveCurrentSession(null) 전에 죽으면 같은 draft 가
  // 다음 틱에 **같은 id 로 다시 마감**되고, 서버는 onConflictDoNothing 이라
  // 먼저 도착한(덜 완전한) 판본만 남기고 두 번째를 조용히 버렸다.
  //
  // 지금 순서에서 최악은 "같은 rawEvent 를 한 번 더 흡수"다. ingest 는 이벤트를
  // 이어붙일 뿐이라 중복 흡수는 활동량이 살짝 부풀 뿐 데이터가 사라지지 않는다.
  // 유실과 중복 중 중복을 택한다.
  if (!reason) {
    await saveCurrentSession(updated);
    await absorbRawEvents(rawEvents, updated.id);
    return;
  }

  // 마감 순서: **archive 먼저, draft 정리 나중, 전송 맨 마지막.**
  //
  // archive 가 유일한 내구성 기록이다. draft 를 먼저 지우고 archive 에서 죽으면
  // (quota 초과 등) 그 세션은 archive 에도 pending 에도 없고 draft 와 rawEvents
  // 까지 사라져 복구 경로가 하나도 없다. maxlen 이면 더 나쁘다 — 이어받은
  // draft 의 continued_from 이 존재하지 않는 세션을 가리킨다.
  // archive 가 먼저면 여기서 죽어도 draft 가 살아 있어 다음 틱에 다시 마감되고,
  // archive.put 은 같은 id 를 덮어쓸 뿐이라 중복이 안 생긴다.
  const payload = close(updated, reason, now);
  const skipReason = await archiveClosed(payload);

  if (reason === 'maxlen') {
    // 4시간 절단 — 곧바로 다음 draft 를 이어 시작한다 (continued_from).
    await saveCurrentSession(continueDraft(updated, now));
  } else {
    // idle / switch / day — 다음 활동이 도착할 때 handleSessionCheck 가
    // draft=null 로 ingest() 를 호출해 새 세션을 새로 시작한다.
    await saveCurrentSession(null);
  }
  await absorbRawEvents(rawEvents, updated.id);
  // 이 세션 앞에 떠돌던 미배정 원본까지 이 파일 몫으로 편입한 뒤 올린다.
  await claimUnassignedRaw(updated.id);

  // 전송은 기다리지 않는다. 실패해도 archive 에 남아 있고 retry 알람이 맡는다.
  if (skipReason === null) void flushSession(payload);
  // 원본은 전송 필터와 무관하게 올린다 (uploadClosedSessionRaw 주석 참고).
  void uploadClosedSessionRaw(updated.id);
}

/**
 * retry 알람(10분) — 'failed' 상태 전부와, 5분 이상 멈춰있는 'sending'(응답을
 * 못 받고 서비스 워커가 죽은 경우) 을 재전송한다.
 */
async function handleRetry(): Promise<void> {
  const now = Date.now();

  // archive 보관 기한(3일) 지난 세션 사본 정리.
  await db.archive.where('closedAt').below(now - ARCHIVE_RETENTION_MS).delete();
  // rawArchive 도 같은 기한. 세션 최대 길이가 4시간(maxlen)이라 진행 중인
  // 세션의 원본이 여기 걸릴 일은 없다.
  await db.rawArchive.where('at').below(now - RAW_RETENTION_MS).delete();

  const extensionKey = await getExtensionKey();
  if (!extensionKey) {
    void registerExtensionKey();
  } else {
    // 못 올린 원본 재시도. 마감 경로와 달리 여기서는 여러 세션이 밀려 있을 수
    // 있어(오프라인 복귀) 순차로 소수만 집는다.
    void retryPendingRaw(extensionKey);
  }

  const pendings = await db.pending.toArray();
  for (const p of pendings) {
    const staleSending = p.status === 'sending' && now - p.updatedAt > STALE_SENDING_MS;
    if (p.status === 'failed' || staleSending) {
      void flushSession(p.session as unknown as SessionPayloadLike);
    }
  }
}

/**
 * onStartup — 브라우저 재시작 시:
 * 1) 'sending' 으로 멈춰있던 고아 pending 을 'failed' 로 강등 (retry 알람이
 *    다음에 집어간다 — 응답 대기 중 상태를 메모리가 아니라 여기 남겨두는
 *    이유가 바로 이 복구다).
 * 2) 열린 draft(currentSession) 가 있으면 'shutdown' 사유로 즉시 마감한다
 *    (브라우저 종료로 마지막 세션이 유실되는 것 방지 — 계획서 03장).
 */
async function handleStartup(): Promise<void> {
  const pendings = await db.pending.toArray();
  await Promise.all(
    pendings
      .filter((p) => p.status === 'sending')
      .map((p) => db.pending.put({ ...p, status: 'failed', updatedAt: Date.now() })),
  );

  const draft = await loadCurrentSession();
  if (draft) {
    const now = Date.now();
    // 마지막 활동에서 30분(idle 기준)이 안 지났으면 세션을 끊지 않고 이어간다 —
    // 크롬 업데이트·실수 종료 후 바로 다시 켜는 경우, 하나의 작업이 둘로
    // 쪼개져 뒤쪽 조각이 10분 필터에 버려지는 것을 막는다. 30분 이상 지났으면
    // idle 과 같은 논리로 shutdown 마감한다.
    if (now - draft.lastActivityAt < 30 * 60 * 1000) {
      return; // draft 유지 — 다음 sessionCheck 가 자연스럽게 이어붙인다
    }
    await dispatchClosedSession(close(draft, 'shutdown', now));
    await saveCurrentSession(null);
  }
}

/**
 * 팝업(popup.ts)이 읽는 "지금 이 순간" 스냅샷.
 *
 * 팝업이 IndexedDB 를 직접 열지 않고 서비스 워커에게 물어보는 이유는 두 가지다.
 * 1) 팝업이 db.ts / session/* 를 import 하면 sw.js 와 공유 청크가 생긴다
 *    (vite.config.ts 의 공유 청크 금지 원칙).
 * 2) 더 중요하게 — "지금 마감되면 전송될까"는 실제 close()·sendSkipReason() 을
 *    그대로 태워야 맞는다. 팝업에 규칙을 복제하면 그 미리보기가 언젠가 거짓말을 한다.
 */
async function buildSessionSnapshot(now: number): Promise<SessionSnapshot> {
  const [draft, pendings, archived, rawEventCount, extensionKey, keyNotice] = await Promise.all([
    loadCurrentSession(),
    db.pending.toArray(),
    db.archive.toArray(), // 3일치라 수십 건 규모 — 전량을 읽어도 부담이 없다
    db.rawEvents.count(),
    getExtensionKey(),
    loadKeyNotice(),
  ]);

  let snapshotDraft: SnapshotDraft | null = null;
  let preview: SnapshotPreview | null = null;
  let countdown = null;

  if (draft) {
    // close_reason 은 전송 필터(sendSkipReason)가 보지 않는 필드라 미리보기에서는
    // 'idle' 을 놓는다. 나머지 값(길이·도메인 수·점수)은 실제 마감과 똑같이 나온다.
    const final = close(draft, 'idle', now);

    snapshotDraft = {
      id: draft.id,
      startedAt: draft.startedAt,
      lastActivityAt: draft.lastActivityAt,
      primaryCategory: draft.primaryCategory,
      activityScore: Math.round(draft.activityScore),
      switchCount: draft.switchCount,
      tags: draft.tags,
      domains: draft.domains,
      eventCount: draft.events.length,
      continuedFrom: draft.continuedFrom ?? null,
      excursionCategory: draft.activeExcursionCategory ?? null,
    };
    preview = {
      durationMin: final.duration_min,
      uniqueDomains: final.unique_domains,
      skipReason: sendSkipReason(final),
    };
    countdown = timeUntilClose(draft, now);
  }

  return {
    now,
    draft: snapshotDraft,
    preview,
    countdown,
    queue: {
      sending: pendings.filter((p) => p.status === 'sending').length,
      failed: pendings.filter((p) => p.status === 'failed').length,
      archived: archived.length,
      skipped: archived.filter((a) => a.skipReason !== null).length,
      skipReasons: archived.reduce<Record<string, number>>((acc, a) => {
        if (a.skipReason) acc[a.skipReason] = (acc[a.skipReason] ?? 0) + 1;
        return acc;
      }, {}),
      skippedItems: archived
        .filter((a) => a.skipReason !== null)
        .sort((a, b) => b.closedAt - a.closedAt)
        .slice(0, 5)
        .map((a) => ({
          at: a.closedAt,
          durationMin: Number(a.session?.duration_min ?? 0),
          closeReason: String(a.session?.close_reason ?? '-'),
          skipReason: a.skipReason as string,
        })),
    },
    rawEvents: rawEventCount,
    connected: Boolean(extensionKey),
    keyNotice,
  };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  // 실패를 반드시 남긴다. void 로만 던지면 unhandled rejection 이라 워커 콘솔에
  // 스택만 찍히고 어느 단계에서 죽었는지 알 수 없다 — handleSessionCheck 은
  // archive.put(quota 초과 가능)까지 await 하므로 조용히 죽을 수 있다.
  // 다음 알람이 1분 뒤 다시 돌아 자체 복구되지만, 반복되면 알아야 한다.
  // err 를 그대로 넘기면 콘솔에 "[object Object]" 로만 찍힌다 — Dexie 의
  // DexieError 도 DOMException 도 Error 를 상속하지 않아서 기본 표시가 그렇다.
  // 정작 원인은 name(QuotaExceededError·DatabaseClosedError 등)에 있으므로
  // 먼저 풀어서 한 줄로 남기고, 원본은 뒤에 붙여 펼쳐볼 수 있게 둔다.
  const report = (name: string) => (err: unknown) => {
    const e = err as { name?: string; message?: string; inner?: unknown };
    const inner = e?.inner as { name?: string; message?: string } | undefined;
    console.error(
      `[NA] ${name} 실패: ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}` +
        (inner ? ` (inner: ${inner.name}: ${inner.message})` : ''),
      err,
    );
  };
  switch (alarm.name) {
    case ALARM_SESSION_CHECK:
      void handleSessionCheck().catch(report('sessionCheck'));
      break;
    case ALARM_RETRY:
      void handleRetry().catch(report('retry'));
      break;
  }
});

/** 브라우저 내부 페이지인가. chrome://new-tab-page 같은 URL 은 hostname 이
 *  'new-tab-page' 로 잡혀 어엿한 도메인처럼 기록된다 — 새 탭을 한 번 열었을
 *  뿐인데 unique_domains 가 2 가 되어 단일 도메인 영상 필터가 통째로 우회된다.
 *  남의 확장 ID(chrome-extension://)도 마찬가지로 도메인 자리에 들어간다. */
function isInternalUrl(url: string | undefined): boolean {
  if (!url) return true;
  return !/^https?:\/\//i.test(url);
}

/** 기록용 도메인. **포트를 살린다** — localhost 하나에 여러 프로젝트가 물려
 *  있어서(실측 넷) 포트가 없으면 구분이 페이지 제목 하나에만 매달린다.
 *  사전 조회는 categories.ts 의 stripPort 가 매칭 직전에 포트를 뗀다. */
function domainOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 사이트 자동 연결 — connect-content.ts(사이트의 /connect 페이지에만 주입)가
  // 키를 요청하면 넘겨준다. 키는 Dexie meta 에 있어 content script 가 직접 못
  // 읽는다(IndexedDB 는 오리진 격리). 받은 쪽은 same-origin POST /api/connect 로
  // httpOnly 쿠키를 세팅한다 — localStorage 에 키를 두지 않는 이유는 XSS 방어.
  if (message?.type === 'GET_EXTENSION_KEY') {
    void getExtensionKey().then((key) => sendResponse({ key: key ?? null }));
    return true; // 비동기 sendResponse 유지
  }

  // 팝업 전용 — 읽기만 하고 아무것도 바꾸지 않는다. 세션 판정을 앞당기지도 않는다
  // (알람이 도는 시점은 그대로다). 팝업을 열어보는 행위가 데이터에 영향을 주면 안 된다.
  if (message?.type === 'GET_SESSION_SNAPSHOT') {
    void buildSessionSnapshot(Date.now()).then(sendResponse);
    return true;
  }

  // 팝업에서 "이걸 봤다" — 새 키 발급 경고를 내린다. 배지도 함께 끈다.
  // 여기서만 지운다: 시간이 지났다고 자동으로 사라지면 경고가 아니다.
  if (message?.type === 'ACK_KEY_NOTICE') {
    void db.meta
      .delete(KEY_NOTICE)
      .then(() => syncKeyNoticeBadge())
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[NA] 키 경고 해제 실패', err);
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message?.type !== 'ACTIVITY') return;

  // ?? 는 빈 문자열을 안 걸러낸다. content.ts 는 location.hostname 을 보내는데
  // file:// 같은 페이지에서는 '' 이고, 그러면 builder 의 `raw.domain || 'etc'`
  // 를 타 'etc' 도메인으로 둔갑해 unique_domains 를 부풀린다.
  const domain = message.url || domainOf(sender.tab?.url);
  if (!domain) return;
  // 방어적 필터 — content script 가 blocked 도메인이면 이미 신호 자체를 보내지
  // 않지만, 혹시 모를 우회(구버전 content script, 수동 메시지 등)에 대비해
  // 서비스 워커에서도 한 번 더 걸러 rawEvents 에 아예 남기지 않는다.
  if (isBlockedDomain(domain)) return;

  // sendResponse 를 걸어 쓰기가 끝날 때까지 워커를 붙잡는다(return true).
  // void 로 던져두면 리스너가 즉시 끝나고, 크롬이 그 사이 워커를 종료하면
  // 진행 중이던 쓰기가 사라진다 — 그 10초치 활동이 통째로 없어진다.
  // content.ts 는 응답을 기다리지 않지만, 응답을 "약속"하는 것만으로 수명이
  // 연장된다. GET_EXTENSION_KEY / GET_SESSION_SNAPSHOT 과 같은 방식이다.
  void db.rawEvents
    .add({
      at: Date.now(),
      kind: 'activity',
      domain,
      // ⚠️ 리댁션은 **저장 직전**에 건다 (session/redact.ts). 여기가 원본(rawArchive)과
      // 압축본(compressed_log)의 공통 상류라, 이 한 곳만 막으면 양쪽에 다 걸린다.
      // GitHub 시크릿 편집 URL 처럼 허용 도메인 안에서 새어나오는 비밀 문자열이
      // 대상이다 — 그게 실제로 경험 detail 을 거쳐 일기까지 올라간 적이 있다.
      payload: redactPayload({
        scrolls: message.scrolls,
        clicks: message.clicks,
        keys: message.keys,
        // 보이는 탭에서 미디어 재생 중 — 입력 0 이어도 시청을 활동으로 인정
        playing: message.playing,
        // content.ts 의 document.visibilityState 기반 플래그 — 예외 C
        // (백그라운드 재생) 판정의 isActiveTab 근거가 된다 (session/builder.ts
        // normalizeEvent 참고).
        visible: message.visible,
        // 의도 컨텍스트 — session/builder.ts normalizeEvent 에서 ActivityEvent 로 매핑된다.
        title: message.title,
        path: message.path,
        query: message.query,
        // 조작 열 — 라벨에 비밀이 박힐 수 있어 redactPayload 를 통과시킨다.
        actions: message.actions,
      }),
    })
    .then(
      () => sendResponse({ ok: true }),
      (err) => {
        console.error('[NA] rawEvent 기록 실패', err);
        sendResponse({ ok: false });
      },
    );
  return true;
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs.get(activeInfo.tabId, (tab) => {
    // 빠른 전환 뒤 탭이 이미 닫혔으면 tab 이 undefined 로 온다. lastError 를
    // 읽지 않으면 콘솔에 Unchecked runtime.lastError 가 쌓이고, domainOf 가
    // '' 를 돌려줘 builder 에서 'etc' 도메인으로 둔갑해 기록된다.
    if (chrome.runtime.lastError || !tab) return;
    if (isInternalUrl(tab.url)) return; // chrome:// · about: · file:// 은 도메인이 아니다
    const domain = domainOf(tab.url);
    if (!domain) return;
    if (isBlockedDomain(domain)) return; // 방어적 필터 — blocked 도메인은 tabs 이벤트도 기록하지 않는다

    void db.rawEvents.add({
      at: Date.now(),
      kind: 'tab_activated',
      domain,
      // tabs 권한으로 얻는 tab.title 도 의도 컨텍스트로 함께 저장한다.
      payload: redactPayload({
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
        title: tab.title,
      }),
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  if (isInternalUrl(tab.url)) return; // chrome:// · about: · file:// 은 도메인이 아니다
  const domain = domainOf(tab.url);
  if (!domain) return;
  if (isBlockedDomain(domain)) return; // 방어적 필터

  void db.rawEvents.add({
    at: Date.now(),
    kind: 'tab_updated',
    domain,
    // tab.active 를 그대로 실어보낸다 — 예외 C(백그라운드 재생) 판정에 쓰인다.
    // tab.title 도 함께 저장 — normalizeEvent 가 title 로 매핑한다.
    // url 은 전체 주소라 경로·쿼리가 통째로 들어있다 — redactPayload 가 그 안까지 지운다.
    payload: redactPayload({ tabId, url: tab.url, active: tab.active, title: tab.title }),
  });
});
