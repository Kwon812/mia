// 팝업(popup.ts)이 서비스 워커에게 요청해 받는 "지금 이 순간" 스냅샷의 형태.
//
// 이 파일에는 타입만 있다. popup.ts 가 `import type` 으로 들여오면 번들에 코드가
// 한 줄도 남지 않으므로, sw.js 와 popup.js 사이에 공유 청크가 생기지 않는다
// (vite.config.ts 의 공유 청크 금지 원칙). 값(상수)을 여기 두면 그 순간
// 공유 청크가 생기므로 메시지 타입 문자열은 양쪽에서 리터럴로 쓴다 —
// connect-content.ts 의 'GET_EXTENSION_KEY' 와 같은 방식이다.

/** 진행 중인 드래프트에서 팝업이 보여주는 부분만 추린 것. */
export interface SnapshotDraft {
  id: string;
  startedAt: number;
  lastActivityAt: number;
  primaryCategory: string;
  activityScore: number;
  switchCount: number;
  tags: string[];
  /** { hostname: 누적 초 } */
  domains: Record<string, number>;
  /** 흡수된 ActivityEvent 개수 */
  eventCount: number;
  continuedFrom: string | null;
  /** 지금 이탈 중인 카테고리. 홈 카테고리에 있으면 null */
  excursionCategory: string | null;
}

/** "지금 이 순간 마감된다면" 의 결과 — 실제 close()/sendSkipReason() 을 태워 만든다. */
export interface SnapshotPreview {
  durationMin: number;
  uniqueDomains: number;
  /** null 이면 전송 대상. 아니면 탈락 사유 */
  skipReason: string | null;
}

/** 시한부 종료 조건까지 남은 ms. */
export interface SnapshotCountdown {
  idle: number;
  maxlen: number;
  day: number;
}

export interface SnapshotQueue {
  /** 전송 중(응답 대기) */
  sending: number;
  /** 전송 실패 — 재시도 대상 */
  failed: number;
  /** archive 3일치 총 개수 */
  archived: number;
  /** 그중 전송 필터에 걸린 것 */
  skipped: number;
}

export interface SessionSnapshot {
  /** 서비스 워커가 스냅샷을 만든 시각 — 팝업의 경과 시간 계산 기준 */
  now: number;
  draft: SnapshotDraft | null;
  preview: SnapshotPreview | null;
  countdown: SnapshotCountdown | null;
  queue: SnapshotQueue;
  /** 아직 드래프트에 흡수되지 않은 rawEvents 행 수 */
  rawEvents: number;
  /** extensionKey 발급 여부 */
  connected: boolean;
}
