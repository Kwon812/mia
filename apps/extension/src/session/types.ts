// 세션 분할 로직의 내부 타입 정의.
//
// packages/shared/src/session.ts 의 sessionPayloadSchema 가 서버로 보낼
// 최종 페이로드의 형태다. 하지만 이 파일은 @na/shared 를 import 하지 않는다.
// 이유(번들 독립성):
//   1) apps/extension 은 vite.config.ts 의 "공유 청크 방지" 원칙대로 sw.js /
//      content.js 가 각각 단일 파일로 독립 빌드된다. 워크스페이스 패키지를
//      들여오면 그 패키지의 의존성 변경이 확장 재빌드를 강제하고, 확장 전용
//      빌드 산출물에 서버/웹 전용 코드(zod 등)가 섞여 들어갈 위험이 생긴다.
//   2) 확장은 Chrome Web Store 심사를 받는 별도 배포 단위라 웹/서버와 배포
//      주기가 다르다. 공유 패키지에 묶이면 그 배포 독립성이 깨진다.
// 따라서 이 파일은 sessionPayloadSchema 의 필드명(snake_case 등)과 "형태만"
// 수동으로 맞추고, 실제 검증은 서버(schema)가 한다.

import type { RawEvent } from '../db';

export type { RawEvent };

/** rawEvents 에서 정규화된 활동 이벤트 하나. */
export interface ActivityEvent {
  /** epoch ms */
  at: number;
  /** hostname (예: 'github.com') */
  domain: string;
  /** categorize(domain) 결과 */
  category: string;
  /** 예외 C(백그라운드 재생) 판정에 쓰는 "활성 탭이었는가" 플래그 */
  isActiveTab: boolean;
  scrolls: number;
  clicks: number;
  keys: number;
  /** 탭 전환(tab_activated) 이벤트인지 — activityScore 가중치용 */
  tabSwitch: boolean;
}

/** shouldClose() 가 실제로 판정하는 종료 사유 (계획서 04장 우선순위 순서) */
export type CloseReason = 'idle' | 'switch' | 'maxlen' | 'day';

/** close() 가 만드는 최종 페이로드에 쓰이는 종료 사유. 서버 스키마의
 * CLOSE_REASONS 는 여기에 'shutdown'(브라우저 종료 시 강제 마감)을 더 갖는다. */
export type FinalCloseReason = CloseReason | 'shutdown';

/** 진행 중인 세션의 누적 상태. 서비스 워커 메모리가 아니라 IndexedDB(meta)에
 * 저장되는 값이며, 이 타입 자체는 순수 데이터라 어디서든 직렬화 가능하다. */
export interface SessionDraft {
  /** crypto.randomUUID — 세션 시작 시 1회 생성, payload.id 로 그대로 전송됨 */
  id: string;
  startedAt: number;
  lastActivityAt: number;
  /** 세션 시작 시 확정되는 카테고리. 이후 draft 생존 기간 동안 고정된다
   * (진짜 전환이 일어나면 이 draft 는 닫히고 새 draft 가 새 primaryCategory 로 시작한다) */
  primaryCategory: string;
  events: ActivityEvent[];
  /** 흡수된(닫지 않은) 맥락 이탈 횟수 — scattered 판정용 (예외 B) */
  switchCount: number;
  tags: string[];
  /** { hostname: 누적 초 } */
  domains: Record<string, number>;
  activityScore: number;
  /** maxlen 절단으로 이어진 이전 세션 id */
  continuedFrom?: string;
  /** 내부 전용 상태: 현재 "이탈 구간"의 카테고리(홈 카테고리가 아닐 때만 존재).
   * 같은 이탈이 여러 틱(1분 알람)에 걸쳐 반복 감지되어 switchCount 가 중복
   * 증가하는 것을 막기 위한 edge-trigger 마커다. builder.ingest 에서만 갱신한다. */
  activeExcursionCategory?: string;
}
