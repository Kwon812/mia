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
  /** 탈락 사유별 개수. 개수만 보면 "왜 버려졌나"를 알 수 없다 —
   *  10분 미만이 대부분이면 세션이 잘게 끊기고 있다는 뜻이라 규칙을 봐야 한다. */
  skipReasons: Record<string, number>;
  /** 버려진 것들의 내역. 최근 것부터.
   *
   *  탈락 사유만으로는 손쓸 데를 못 정한다 — '10분 미만'이 switch 로 잘린
   *  앞 조각이면 끊는 규칙이 작업을 죽인 것이고, 그냥 잠깐 훑고 만 것이면
   *  버려지는 게 맞다. 마감 사유를 함께 봐야 그 둘이 갈린다. */
  skippedItems: { at: number; durationMin: number; closeReason: string; skipReason: string }[];
}

/**
 * **새 익명 키를 발급했다**는 사실. 사용자가 확인할 때까지 안 사라진다.
 *
 * 이 키가 곧 계정 전체다(비밀번호가 없다). 확장 스토리지가 통째로 날아가면
 * — 삭제 후 재설치, unpacked 경로 변경 — 확장은 그게 첫 설치인지 재설치인지
 * 구분할 방법이 없다. `onInstalled` 의 reason 은 둘 다 'install' 이고,
 * chrome.storage.local 미러도 같은 오리진이라 함께 사라진다.
 *
 * 그래서 발급 자체는 막지 않는다(온보딩에 마찰을 주면 첫 사용자가 손해다).
 * 대신 **조용히 갈리지 않게** 한다 — 배지와 팝업 배너로 알리고, 기존 캐릭터가
 * 있으면 사이트에서 다시 연결하도록 안내한다.
 *
 * 실제로 2026-08-08 14:48 에 이렇게 계정이 둘로 쪼개졌고, 사이트 쿠키는 옛
 * 키를 가리켜 화면에 아무 표시도 안 났다. 며칠 뒤 "경험이 왜 하나뿐이지"로
 * 발견됐다 — 그 며칠이 이 배너가 없앨 시간이다.
 */
export interface SnapshotKeyNotice {
  /** 발급 시각(epoch ms) */
  issuedAt: number;
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
  /** 새 키를 발급했고 아직 사용자가 확인하지 않았으면 그 기록. 아니면 null. */
  keyNotice: SnapshotKeyNotice | null;
}
