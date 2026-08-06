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
// 하루 경계는 KST 고정. 서버(daily_logs.log_date·일기 배치·웹의 "오늘")가 전부
// KST 고정이라 확장만 로컬 시각을 쓰면 두 정의가 갈린다. KST 는 서머타임이 없다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// activityScore 가중치. 계획서 11장 "Activity Score 가중치 — 실데이터로 튜닝"
// 대상이라 상수로 분리해둔다. 지금 값은 임의의 초기값이다.
export const ACTIVITY_WEIGHTS = {
  scroll: 1,
  click: 2,
  key: 1,
  tabSwitch: 5,
  // 10초 틱당 0.5 → 시청 1시간 ≈ 180점. 전송 필터의 엔터테인먼트 컷(150)을
  // "50분 이상 진득한 시청"만 넘도록 잡은 값 — 실데이터 튜닝 대상.
  playingTick: 0.5,
} as const;

export function eventScore(e: ActivityEvent): number {
  return (
    e.scrolls * ACTIVITY_WEIGHTS.scroll +
    e.clicks * ACTIVITY_WEIGHTS.click +
    e.keys * ACTIVITY_WEIGHTS.key +
    (e.tabSwitch ? ACTIVITY_WEIGHTS.tabSwitch : 0) +
    (e.playing ? ACTIVITY_WEIGHTS.playingTick : 0)
  );
}

/**
 * 카테고리 판정에 포함시킬 이벤트인지.
 * - 예외 A(보조 도메인 흡수): COMPANION 도메인은 항상 제외한다 (활성/비활성 무관).
 * - 예외 C(백그라운드 재생): BACKGROUND_AUDIO 도메인은 활성 탭이 아닐 때만 제외한다.
 */
/** 아무 데도 안 간 이벤트. 카테고리 투표에서 빼야 한다.
 *
 *  'newtab' 은 chrome://newtab/ 의 hostname 이고, 'etc' 는 raw.domain 이 비어
 *  올 때의 기본값이다(tabs.onActivated 가 url 없이 오는 경우 — normalizeEvent).
 *  둘 다 "탭을 하나 열었다"는 것뿐인데 한 표를 행사한다.
 *
 *  실데이터 16세션을 되짚어보니 **아홉 건에서 이 경유지가 우세 카테고리를
 *  가져갔다.** 한 세션에서는 ChatGPT 로 25분을 보내는 동안 그 사이에 뜬 새 탭
 *  두 개가 "25분간 etc 에 머물렀다"로 읽혀 가짜 switch 를 만들었다. */
const WAYPOINT_DOMAINS = ['newtab', 'etc'];

function isRelevantForCategory(e: ActivityEvent): boolean {
  if (WAYPOINT_DOMAINS.includes(e.domain)) return false;
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

  // 개수가 아니라 활동 점수 가중 투표 — playing 틱(0.5)은 10초마다 꼬박꼬박
  // 오기 때문에 개수로 세면 듀얼 모니터에서 보이기만 하는 유튜브가 실제 작업
  // 카테고리를 뺏을 수 있다. 점수 기준이면 입력이 있는 작업이 압도하고,
  // 순수 시청 세션(입력 0)은 경쟁자가 없어 여전히 시청이 우세로 잡힌다.
  const scores = new Map<string, number>();
  const order: string[] = [];
  for (const e of relevant) {
    if (!scores.has(e.category)) {
      scores.set(e.category, 0);
      order.push(e.category);
    }
    scores.set(e.category, scores.get(e.category)! + eventScore(e));
  }

  let best = order[0];
  for (const cat of order) {
    if (scores.get(cat)! > scores.get(best)!) best = cat;
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

/** 새벽 4시를 기준으로 한 "논리적 날짜" 버킷.
 *
 *  KST 고정 오프셋으로 센다. 브라우저 로컬 시각(setHours)으로 세면 안 된다 —
 *  서버(daily_logs.log_date, 일기 배치, 웹의 "오늘")는 전부 KST 고정이라,
 *  사용자가 KST 가 아닌 머신을 쓰면 세션이 잘리는 지점과 일기가 담는 구간이
 *  최대 하루 가까이 어긋난다. 한 "날"의 세션이 두 log_date 로 흩어지거나
 *  어느 일기에도 안 들어간다.
 *  KST 는 서머타임이 없어 고정 오프셋으로 충분하다. */
function dayBucket(epochMs: number): string {
  const kstShifted = new Date(
    epochMs + KST_OFFSET_MS - DAY_BOUNDARY_HOUR * 60 * 60 * 1000,
  );
  return kstShifted.toISOString().slice(0, 10);
}

/**
 * 마지막 활동과 다음 활동 **사이에** 유휴 임계를 넘는 공백이 있었는가.
 *
 * shouldClose 의 idle 판정은 `now - lastActivityAt` 만 본다. 그런데 흡수(ingest)
 * 가 lastActivityAt 을 먼저 갱신한 뒤에 판정이 돌기 때문에, 알람이 아예 안 돈
 * 구간(노트북 절전 등)은 그 공백이 판정에 보이지 않는다 — 어젯밤 22시 활동과
 * 오늘 아침 9시 활동이 한 세션으로 이어지고, idle 이 아니라 maxlen 으로 잘려
 * 11시간짜리 가짜 세션이 만들어진다.
 * 그래서 흡수하기 **전에** 이벤트 시각으로 공백을 따로 본다.
 *
 * 임계값(IDLE_MS)을 파일 밖으로 내보내지 않으려고 함수로 감싼다 — timeUntilClose
 * 와 같은 이유다.
 */
export function idleGapBefore(draft: SessionDraft, nextActivityAt: number): boolean {
  return nextActivityAt - draft.lastActivityAt > IDLE_MS;
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

/** 다음 새벽 4시 경계의 epoch ms. dayBucket 과 **같은 KST 고정 기준**을 쓴다.
 *  dayBucket 만 KST 로 바꾸고 여기를 로컬로 두면 팝업의 남은 시간이 거짓말을
 *  한다 — KST 가 아닌 머신에서 "16시간 남음"이라 띄우고 실제로는 3시간 뒤에
 *  잘린다. */
function nextDayBoundary(now: number): number {
  const kstMs = now + KST_OFFSET_MS;
  const d = new Date(kstMs);
  const boundary = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    DAY_BOUNDARY_HOUR,
  );
  const next = kstMs >= boundary ? boundary + 24 * 60 * 60 * 1000 : boundary;
  return next - KST_OFFSET_MS;
}

/** 시한부 종료 조건까지 남은 시간(ms). 이미 조건을 넘겼으면 0. */
export interface CloseCountdown {
  idle: number;
  maxlen: number;
  day: number;
}

/**
 * shouldClose 의 "언제쯤"을 답하는 함수 — 팝업(popup.ts)의 남은 시간 표시용.
 *
 * switch 는 여기 없다. 앞으로 어떤 도메인을 볼지에 달린 조건이라 남은 시간이라는
 * 개념이 성립하지 않는다(지금 이탈 중인지는 recentDominantCategory 로 따로 본다).
 *
 * 이 함수가 존재하는 이유는 IDLE_MS/MAXLEN_MS/DAY_BOUNDARY_HOUR 를 이 파일 밖으로
 * 내보내지 않기 위해서다 — 임계값이 두 곳에 생기면 규칙을 고쳤을 때 표시가 거짓말을 한다.
 */
export function timeUntilClose(draft: SessionDraft, now: number): CloseCountdown {
  return {
    idle: Math.max(0, IDLE_MS - (now - draft.lastActivityAt)),
    maxlen: Math.max(0, MAXLEN_MS - (now - draft.startedAt)),
    day: dayBoundaryCrossed(draft, now) ? 0 : Math.max(0, nextDayBoundary(now) - now),
  };
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
  return sendSkipReason(final) === null;
}

/** 전송 필터 탈락 사유. 통과면 null. archive(3일 보관) 튜닝 기록용. */
export function sendSkipReason(final: SendableSession): string | null {
  if (final.duration_min < 10) return 'too_short';
  if (final.activity_score < 50) return 'low_activity';
  if (
    final.unique_domains === 1 &&
    final.primary_category === 'entertainment' &&
    final.activity_score < 150
  ) {
    return 'single_domain_entertainment';
  }
  return null;
}
