import { API_BASE } from './config';
import { db } from './db';

// 서비스 워커: manifest 에서 "type": "module" 이므로 정적 import 사용 가능.
// 다만 이 파일은 vite 멀티 엔트리 빌드에서 content.ts 와 공유 청크를 만들지
// 않도록 db.ts / config.ts 를 이 파일에서만 참조한다 (vite.config.ts 참고).
//
// 절대 금지: setInterval, 전역 변수에 상태 저장.
// 대체: chrome.alarms + IndexedDB(Dexie, db.ts).

const ALARM_SESSION_CHECK = 'sessionCheck';
const ALARM_COMPRESS = 'compress';
const ALARM_RETRY = 'retry';
const ALARM_DIARY = 'diary';

// 다음 새벽 3시(로컬 타임)의 epoch ms 를 계산한다.
function nextThreeAm(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function registerAlarms(): void {
  chrome.alarms.create(ALARM_SESSION_CHECK, { periodInMinutes: 1 });
  chrome.alarms.create(ALARM_COMPRESS, { periodInMinutes: 5 });
  chrome.alarms.create(ALARM_RETRY, { periodInMinutes: 10 });
  chrome.alarms.create(ALARM_DIARY, {
    when: nextThreeAm(),
    periodInMinutes: 1440,
  });
}

async function registerExtensionKey(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/register`, { method: 'POST' });
    if (!res.ok) return;
    const { extension_key } = (await res.json()) as { extension_key: string };
    await db.meta.put({ key: 'extensionKey', value: extension_key });
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
  // TODO: 브라우저 재시작 시 status: 'sending' 으로 남아있는 고아 pending
  // 세션을 정리한다 (브라우저 종료로 전송 완료/실패 처리가 안 된 채 남은 것).
});

async function handleSessionCheck(): Promise<void> {
  // TODO: meta.currentSession 을 읽어 shouldClose() 규칙(idle/switch/maxlen/day)
  // 을 평가하고, 종료 조건이면 세션을 확정해 pending 에 기록한다.
}

async function handleCompress(): Promise<void> {
  // TODO: rawEvents 를 시간 순으로 묶어 세션 단위로 압축하고, 압축된 원본은
  // rawEvents 에서 제거해 200~500건 수준으로 유지한다.
}

async function handleRetry(): Promise<void> {
  // TODO: pending 중 status: 'failed' 인 세션을 다시 전송한다.
  // extensionKey 가 없으면 registerExtensionKey() 를 재시도한다.
}

async function handleDiary(): Promise<void> {
  // TODO: 하루치 세션을 모아 다이어리 생성 요청을 서버로 보낸다.
}

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case ALARM_SESSION_CHECK:
      void handleSessionCheck();
      break;
    case ALARM_COMPRESS:
      void handleCompress();
      break;
    case ALARM_RETRY:
      void handleRetry();
      break;
    case ALARM_DIARY:
      void handleDiary();
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

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'ACTIVITY') return;

  void db.rawEvents.add({
    at: Date.now(),
    kind: 'activity',
    domain: message.url ?? domainOf(sender.tab?.url),
    payload: {
      scrolls: message.scrolls,
      clicks: message.clicks,
      keys: message.keys,
    },
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs.get(activeInfo.tabId, (tab) => {
    void db.rawEvents.add({
      at: Date.now(),
      kind: 'tab_activated',
      domain: domainOf(tab?.url),
      payload: { tabId: activeInfo.tabId, windowId: activeInfo.windowId },
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  void db.rawEvents.add({
    at: Date.now(),
    kind: 'tab_updated',
    domain: domainOf(tab.url),
    payload: { tabId, url: tab.url },
  });
});
