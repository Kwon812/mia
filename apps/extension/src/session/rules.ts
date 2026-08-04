// 세션 판단 규칙 — 전부 순수 함수.
//
// Date.now() 를 직접 호출하지 않는다. 시각은 항상 인자 `now` 로 받는다
// (테스트 가능성 + "메모리에 아무것도 남기지 마라" 원칙과 별개로, 서비스
// 워커가 죽었다 깨어나도 같은 입력이면 같은 결과가 나와야 하기 때문).

import { isBackgroundAudioDomain, isCompanionDomain } from './categories';
import type { ActivityEvent, CloseReason, SessionDraft } from './types';

// ── 계획서 04장 수치 상수 ──
const IDLE_MS = 30 * 60 * 1000; // idle 30분
const MAXLEN_MS = 4 * 60 * 60 * 1000; // maxlen 4시간
const SWITCH_GRACE_MS = 10 * 60 * 1000; // 맥락 전환 10분 유예
const SCATTERED_WINDOW_MS = 60 * 60 * 1000; // scattered 판정 기준 60분
const SCATTERED_MIN_SWITCHES = 3; // scattered 판정 기준 전환 3회
const DAY_BOUNDARY_HOUR = 4; // 새벽 4시 경계

// activityScore 가중치. 계획서 11장 "Activity Score 가중치 — 실데이터로 튜닝"
// 대상이라 상수로 분리해둔다. 지금 값은 임의의 초기값이다.
export const ACTIVITY_WEIGHTS = {
  scroll: 1,
  click: 2,
  key: 1,
  tabSwitch: 5,
} as const;

export function eventScore(e: ActivityEvent): number {
  return (
    e.scrolls * ACTIVITY_WEIGHTS.scroll +
    e.clicks * ACTIVITY_WEIGHTS.click +
    e.keys * ACTIVITY_WEIGHTS.key +
    (e.tabSwitch ? ACTIVITY_WEIGHTS.tabSwitch : 0)
  );
}

/**
 * 카테고리 판정에 포함시킬 이벤트인지.
 * - 예외 A(보조 도메인 흡수): COMPANION 도메인은 항상 제외한다 (활성/비활성 무관).
 * - 예외 C(백그라운드 재생): BACKGROUND_AUDIO 도메인은 활성 탭이 아닐 때만 제외한다.
 */
function isRelevantForCategory(e: ActivityEvent): boolean {
  if (isCompanionDomain(e.domain)) return false;
  if (isBackgroundAudioDomain(e.domain) && !e.isActiveTab) return false;
  return true;
}

/**
 * 이벤트 목록에서 가장 우세한(빈도 최다) 카테고리. 판정 제외 대상(예외 A/C)은
 * 미리 걸러진다. 동률이면 먼저 등장한 카테고리를 택한다(결정적 결과를 위함).
 * 판정 대상 이벤트가 하나도 없으면 undefined.
 */
export function dominantCategory(events: ActivityEvent[]): string | undefined {
  const relevant = events.filter(isRelevantForCategory);
  if (relevant.length === 0) return undefined;

  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const e of relevant) {
    if (!counts.has(e.category)) {
      counts.set(e.category, 0);
      order.push(e.category);
    }
    counts.set(e.category, counts.get(e.category)! + 1);
  }

  let best = order[0];
  for (const cat of order) {
    if (counts.get(cat)! > counts.get(best)!) best = cat;
  }
  return best;
}

/**
 * "최근 10분" 창 안에서 판정 대상 이벤트들의 우세 카테고리와, 그 카테고리로
 * 처음 진입한 시각. 없으면 undefined.
 */
function recentDominant(
  draft: SessionDraft,
  now: number,
): { category: string; firstAt: number } | undefined {
  const relevantEvents = draft.events.filter(isRelevantForCategory);
  const recent = relevantEvents.filter((e) => now - e.at < SWITCH_GRACE_MS);
  if (recent.length === 0) return undefined;

  const category = dominantCategory(recent);
  if (!category) return undefined;

  // "지금 이 카테고리가 이어진 지 얼마나 됐는가"는 최근 10분 창만 봐서는 알 수
  // 없다 — 그 창 자체가 10분이라 drift 가 구조적으로 10분을 넘을 수 없기
  // 때문이다. 그래서 전체 이력(relevantEvents)을 시간 역순으로 훑어, 지금과
  // 같은 카테고리가 끊기지 않고 이어진 구간이 언제 시작됐는지 역추적한다.
  // 마지막 이벤트가 이 카테고리와 다르면(=이미 다른 흐름으로 바뀐 뒤라는 뜻)
  // 안전하게 drift 없음(now)으로 본다.
  let firstAt = now;
  for (let i = relevantEvents.length - 1; i >= 0; i--) {
    const e = relevantEvents[i];
    if (e.category !== category) break;
    firstAt = e.at;
  }

  return { category, firstAt };
}

/** builder.ts 가 "지금 이탈 구간의 카테고리"를 읽기 위해 쓰는 헬퍼 (edge-trigger 용). */
export function recentDominantCategory(draft: SessionDraft, now: number): string | undefined {
  return recentDominant(draft, now)?.category;
}

/**
 * 맥락 전환 원(原) 신호 — 예외 B(scattered) 적용 전.
 * 최근 10분이 계속 primaryCategory 와 다른 카테고리로 우세하고, 그 상태가
 * 10분 이상 지속됐으면 true.
 */
function isContextDrifting(draft: SessionDraft, now: number): boolean {
  const rec = recentDominant(draft, now);
  if (!rec) return false;
  if (rec.category === draft.primaryCategory) return false;
  return now - rec.firstAt >= SWITCH_GRACE_MS;
}

/**
 * 예외 B — 왕복(scattered) 판정.
 * switchCount(흡수된 이탈 횟수) 가 3회 이상이면서 세션 경과 시간이 60분
 * 미만이면 scattered. 이 경우 진짜 전환으로 끊지 않고 태그만 남긴다.
 */
export function isScattered(draft: SessionDraft, now: number): boolean {
  return (
    draft.switchCount >= SCATTERED_MIN_SWITCHES && now - draft.startedAt < SCATTERED_WINDOW_MS
  );
}

/**
 * 맥락 전환 최종 판정 — shouldClose 가 쓰는 값.
 * isContextDrifting 이 true 여도 isScattered 면 끊지 않는다(예외 B).
 */
export function contextSwitched(draft: SessionDraft, now: number): boolean {
  if (!isContextDrifting(draft, now)) return false;
  if (isScattered(draft, now)) return false; // 예외 B: 흡수, 종료 아님
  return true;
}

/** 새벽 4시를 기준으로 한 "논리적 날짜" 버킷. DST 등 엣지 케이스는 무시한다. */
function dayBucket(epochMs: number): string {
  const d = new Date(epochMs);
  d.setHours(d.getHours() - DAY_BOUNDARY_HOUR);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** day 조건 — 세션 시작 시각과 now 가 새벽 4시 경계를 넘어 다른 "날"이면 true. */
export function dayBoundaryCrossed(draft: SessionDraft, now: number): boolean {
  return dayBucket(draft.startedAt) !== dayBucket(now);
}

/**
 * 종료 조건 네 가지. 계획서 04장 우선순위 그대로: idle → switch → maxlen → day.
 */
export function shouldClose(draft: SessionDraft, now: number): CloseReason | null {
  if (now - draft.lastActivityAt > IDLE_MS) return 'idle';
  if (contextSwitched(draft, now)) return 'switch';
  if (now - draft.startedAt > MAXLEN_MS) return 'maxlen';
  if (dayBoundaryCrossed(draft, now)) return 'day';
  return null;
}

/** 전송 필터에 필요한 최소 형태 (close() 가 만드는 최종 페이로드와 호환). */
export interface SendableSession {
  duration_min: number;
  activity_score: number;
  unique_domains: number;
  primary_category: string;
}

/**
 * 전송 필터 — 계획서 04장 "isWorthSending".
 * 1) 10분 미만 컷
 * 2) activityScore 50 미만 컷
 * 3) 단일 도메인 + entertainment 카테고리 + activityScore 150 미만 컷
 *    (영상 필터. 150 이상이면 강의 시청 등 진짜 몰입으로 보고 통과시킨다)
 */
export function isWorthSending(final: SendableSession): boolean {
  if (final.duration_min < 10) return false;
  if (final.activity_score < 50) return false;
  if (
    final.unique_domains === 1 &&
    final.primary_category === 'entertainment' &&
    final.activity_score < 150
  ) {
    return false;
  }
  return true;
}
