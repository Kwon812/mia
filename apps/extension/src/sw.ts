import { API_BASE } from './config';
import { db } from './db';
import {
  close,
  continueDraft,
  idleGapBefore,
  ingest,
  isBlockedDomain,
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
    if (existing) return;

    const res = await fetch(`${API_BASE}/api/register`, { method: 'POST' });
    if (!res.ok) return;
    const { extension_key } = (await res.json()) as { extension_key: string };
    await db.meta.put({ key: 'extensionKey', value: extension_key });
    // chrome.storage.local 에도 미러링 — 사이트 /connect 페이지의 수동 안내
    // (콘솔에서 키 확인)가 Dexie 보다 훨씬 쉬워서다. 진실은 meta 쪽.
    await chrome.storage.local.set({ extensionKey: extension_key });
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
  void handleStartup();
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

async function getExtensionKey(): Promise<string | undefined> {
  const row = await db.meta.get('extensionKey');
  return row?.value as string | undefined;
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

  try {
    const extensionKey = await getExtensionKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (extensionKey) headers['X-Extension-Key'] = extensionKey;

    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`전송 실패: HTTP ${res.status}`);

    // 성공 — 'done' 으로 남기지 않고 바로 지운다. archive 사본에만 전송 확인 마킹.
    await db.pending.delete(payload.id);
    await db.archive.update(payload.id, { sent: true });
  } catch {
    await db.pending.put({
      id: payload.id,
      status: 'failed',
      session: payload as unknown as Record<string, unknown>,
      updatedAt: Date.now(),
    });
  }
}

/**
 * 확정된(닫힌) 세션 처리.
 * 1) 전송 여부와 무관하게 archive 에 3일 보관 — 필터에 걸러진 세션까지 남겨야
 *    LLM 출력과 대조하며 분할·필터 기준을 튜닝할 수 있다 (사용자 결정).
 * 2) 전송 필터(계획서 04장) 통과 시에만 서버로 flush.
 */
async function dispatchClosedSession(payload: SessionPayloadLike): Promise<void> {
  const skipReason = sendSkipReason(payload);

  await db.archive.put({
    id: payload.id,
    closedAt: Date.now(),
    sent: false,
    skipReason,
    session: payload as unknown as Record<string, unknown>,
  });

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
    const firstAt = Math.min(...rawEvents.map((e) => e.at));
    if (idleGapBefore(draft, firstAt)) {
      const stale = draft;
      draft = null;
      await saveCurrentSession(null);
      // 마감 시각은 now 가 아니라 마지막 활동 시각이다. 자는 동안을 세션에
      // 넣으면 duration_min 이 통째로 거짓말이 된다.
      await dispatchClosedSession(close(stale, 'idle', stale.lastActivityAt));
    }
  }

  const updated = ingest(draft, rawEvents, now);
  const processedIds = rawEvents.map((e) => e.id).filter((id): id is number => id !== undefined);

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
    if (processedIds.length > 0) await db.rawEvents.bulkDelete(processedIds);
    return;
  }

  if (reason === 'maxlen') {
    // 4시간 절단 — 곧바로 다음 draft 를 이어 시작한다 (continued_from).
    await saveCurrentSession(continueDraft(updated, now));
  } else {
    // idle / switch / day — 다음 활동이 도착할 때 handleSessionCheck 가
    // draft=null 로 ingest() 를 호출해 새 세션을 새로 시작한다.
    await saveCurrentSession(null);
  }
  if (processedIds.length > 0) await db.rawEvents.bulkDelete(processedIds);

  // 마감 전송은 draft 정리가 끝난 뒤에. 여기서 죽어도 draft 는 이미 비워졌고
  // 마감된 세션만 잃는다 — 살아있는 세션이 두 번 마감되는 것보다 낫다.
  await dispatchClosedSession(close(updated, reason, now));
}

/**
 * retry 알람(10분) — 'failed' 상태 전부와, 5분 이상 멈춰있는 'sending'(응답을
 * 못 받고 서비스 워커가 죽은 경우) 을 재전송한다.
 */
async function handleRetry(): Promise<void> {
  const now = Date.now();

  // archive 보관 기한(3일) 지난 세션 사본 정리.
  await db.archive.where('closedAt').below(now - ARCHIVE_RETENTION_MS).delete();

  const extensionKey = await getExtensionKey();
  if (!extensionKey) {
    void registerExtensionKey();
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
  const [draft, pendings, archived, rawEventCount, extensionKey] = await Promise.all([
    loadCurrentSession(),
    db.pending.toArray(),
    db.archive.toArray(), // 3일치라 수십 건 규모 — 전량을 읽어도 부담이 없다
    db.rawEvents.count(),
    getExtensionKey(),
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
    },
    rawEvents: rawEventCount,
    connected: Boolean(extensionKey),
  };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case ALARM_SESSION_CHECK:
      void handleSessionCheck();
      break;
    case ALARM_RETRY:
      void handleRetry();
      break;
  }
});

function domainOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
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

  if (message?.type !== 'ACTIVITY') return;

  const domain = message.url ?? domainOf(sender.tab?.url);
  // 방어적 필터 — content script 가 blocked 도메인이면 이미 신호 자체를 보내지
  // 않지만, 혹시 모를 우회(구버전 content script, 수동 메시지 등)에 대비해
  // 서비스 워커에서도 한 번 더 걸러 rawEvents 에 아예 남기지 않는다.
  if (isBlockedDomain(domain)) return;

  void db.rawEvents.add({
    at: Date.now(),
    kind: 'activity',
    domain,
    payload: {
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
    },
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs.get(activeInfo.tabId, (tab) => {
    const domain = domainOf(tab?.url);
    if (isBlockedDomain(domain)) return; // 방어적 필터 — blocked 도메인은 tabs 이벤트도 기록하지 않는다

    void db.rawEvents.add({
      at: Date.now(),
      kind: 'tab_activated',
      domain,
      // tabs 권한으로 얻는 tab.title 도 의도 컨텍스트로 함께 저장한다.
      payload: { tabId: activeInfo.tabId, windowId: activeInfo.windowId, title: tab?.title },
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const domain = domainOf(tab.url);
  if (isBlockedDomain(domain)) return; // 방어적 필터

  void db.rawEvents.add({
    at: Date.now(),
    kind: 'tab_updated',
    domain,
    // tab.active 를 그대로 실어보낸다 — 예외 C(백그라운드 재생) 판정에 쓰인다.
    // tab.title 도 함께 저장 — normalizeEvent 가 title 로 매핑한다.
    payload: { tabId, url: tab.url, active: tab.active, title: tab.title },
  });
});
