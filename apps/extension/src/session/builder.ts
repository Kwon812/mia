// rawEvents → SessionDraft 갱신(ingest), draft → 전송 페이로드(close).
//
// ingest/close 모두 순수 함수다: Date.now() 를 직접 부르지 않고 `now` 를
// 인자로 받는다. 유일한 예외는 crypto.randomUUID() 로 만드는 세션 id인데,
// 이는 "규칙 결과"가 아니라 "새 세션의 식별자 발급"이라 결정성이 필요 없다.

import { categorize, isBlockedDomain } from './categories';
import {
  eventScore,
  isScattered as isScatteredNow,
  recentDominantCategory,
  dominantCategory as pickDominantCategory,
} from './rules';
import type { ActivityEvent, FinalCloseReason, RawEvent, SessionDraft } from './types';

// domains(호스트별 누적 초) 계산 시, 이벤트 사이 간격을 얼마까지 "그 도메인에
// 머문 시간"으로 인정할지의 상한. content script 활동 신호 주기(10초)보다
// 훨씬 크게 잡아 정상적인 체류는 다 인정하되, 알람 지연 등으로 이벤트가 뜨문
// 뜨문 들어와도 idle 구간을 그 도메인 체류로 과다 계상하지 않게 한다.
// 실데이터 튜닝 대상 (계획서 11장).
const MAX_DOMAIN_GAP_MS = 10 * 60 * 1000;

// ── LLM 토큰 비용 상한 (계획서 11장) ──
// compressed_log 는 세션 종료 시 experience-engine 프롬프트에 그대로 들어간다.
// title/path/query 를 그대로 다 실으면 세션이 길어질수록 토큰이 무한정
// 늘어나므로 상수로 상한을 두고 관리한다.
export const MAX_TITLE_LEN = 200; // title/path 절단 길이 (content.ts 의 MAX_TEXT_LEN 과 동일)
export const MAX_SEGMENTS = 20; // compressed_log.segments 최대 개수 — 넘으면 최신 구간만 남긴다
const MAX_SEGMENT_PATHS = 3; // 구간별 path 예시 최대 개수
export const MAX_QUERIES = 15; // 세션 전체 검색 쿼리 최대 개수 (중복 제거 후)

function newId(): string {
  return crypto.randomUUID();
}

/** payload 의 문자열 필드를 안전하게 꺼내고 절단한다. 비어있으면 undefined. */
function readTextField(payload: Record<string, unknown>, key: string, maxLen: number): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.slice(0, maxLen);
}

/** RawEvent(db.ts) → ActivityEvent(session/types.ts) 정규화. */
export function normalizeEvent(raw: RawEvent): ActivityEvent {
  const domain = raw.domain || 'etc';
  const payload = raw.payload ?? {};

  // isActiveTab 판정:
  // - tab_activated: 정의상 활성화된 탭이므로 항상 true
  // - tab_updated: chrome.tabs.onUpdated 콜백의 tab.active 를 그대로 실어보낸다
  //   (sw.ts 참고). 값이 없으면(과거 데이터 등) 활성으로 간주해 과도하게
  //   깎이지 않게 한다.
  // - activity(content script): document.visibilityState 기반 payload.visible
  let isActiveTab = true;
  if (raw.kind === 'tab_activated') {
    isActiveTab = true;
  } else if (raw.kind === 'tab_updated') {
    isActiveTab = Boolean(payload.active ?? true);
  } else {
    isActiveTab = Boolean(payload.visible ?? true);
  }

  return {
    at: raw.at,
    domain,
    category: categorize(domain),
    isActiveTab,
    scrolls: Number(payload.scrolls) || 0,
    clicks: Number(payload.clicks) || 0,
    keys: Number(payload.keys) || 0,
    tabSwitch: raw.kind === 'tab_activated',
    playing: Boolean(payload.playing),
    // 의도 컨텍스트 — tab_activated/tab_updated 는 payload.title(tabs 권한),
    // activity 는 payload.title/path/query(content script) 에서 온다.
    title: readTextField(payload, 'title', MAX_TITLE_LEN),
    path: readTextField(payload, 'path', MAX_TITLE_LEN),
    query: readTextField(payload, 'query', MAX_TITLE_LEN),
  };
}

function computeDomainSeconds(events: ActivityEvent[]): Record<string, number> {
  const domains: Record<string, number> = {};
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const next = events[i + 1];
    // 마지막 이벤트는 다음 신호가 없어 구간 길이를 알 수 없으므로 0으로 둔다
    // (보수적 추정 — 다음 ingest 호출에서 새 이벤트가 붙으면 그때 채워진다).
    const gapMs = next ? next.at - cur.at : 0;
    const cappedMs = Math.min(gapMs, MAX_DOMAIN_GAP_MS);
    domains[cur.domain] = (domains[cur.domain] ?? 0) + Math.round(cappedMs / 1000);
  }
  return domains;
}

/**
 * draft(없으면 새 세션) 에 새 rawEvents 를 반영한 다음 draft 를 돌려준다.
 * 呼출부(sw.ts)는 반영이 끝난 rawEvents 를 IndexedDB 에서 지운다.
 */
export function ingest(
  draft: SessionDraft | null,
  rawEvents: RawEvent[],
  now: number,
): SessionDraft {
  // 3중 방어 — content script(신호 미전송) → sw.ts(메시지/tabs 필터) → 여기(세션
  // 반영 직전 최종 필터). 어떤 경로로든 blocked 도메인 rawEvent 가 여기까지
  // 넘어와도 세션(따라서 compressed_log·LLM 프롬프트)에는 절대 포함되지 않는다.
  const newEvents = [...rawEvents]
    .map(normalizeEvent)
    .filter((e) => !isBlockedDomain(e.domain))
    .sort((a, b) => a.at - b.at);

  const events = draft ? [...draft.events, ...newEvents] : newEvents;
  events.sort((a, b) => a.at - b.at);

  const startedAt = draft?.startedAt ?? newEvents[0]?.at ?? now;
  const lastActivityAt = Math.max(
    draft?.lastActivityAt ?? startedAt,
    ...newEvents.map((e) => e.at),
    startedAt,
  );

  // primaryCategory 는 세션 시작 시 1회 확정, 이후 draft 생존 동안 고정.
  const primaryCategory = draft?.primaryCategory ?? pickDominantCategory(events) ?? 'etc';

  const base: SessionDraft = {
    id: draft?.id ?? newId(),
    startedAt,
    lastActivityAt,
    primaryCategory,
    events,
    switchCount: draft?.switchCount ?? 0,
    tags: draft ? [...draft.tags] : [],
    domains: computeDomainSeconds(events),
    activityScore: events.reduce((sum, e) => sum + eventScore(e), 0),
    continuedFrom: draft?.continuedFrom,
    activeExcursionCategory: draft?.activeExcursionCategory,
  };

  // switchCount 갱신 — edge-trigger 방식.
  // "지금 이탈 구간의 카테고리"가 이전 틱과 다르면(=새 이탈이 시작됐으면)
  // switchCount 를 늘린다. 10분 지속 여부(rules.ts 의 isContextDrifting)와
  // 무관하게, 짧은 왕복도 "이탈 횟수"로는 셈한다 — 그래야 10분을 못 채우는
  // 빠른 왕복(GitHub↔YouTube 3회 등)도 scattered 로 잡힌다.
  const currentExcursion = recentDominantCategory(base, now);
  if (currentExcursion !== undefined && currentExcursion !== base.primaryCategory) {
    if (base.activeExcursionCategory !== currentExcursion) {
      base.switchCount += 1;
    }
    base.activeExcursionCategory = currentExcursion;
  } else {
    base.activeExcursionCategory = undefined; // 홈 카테고리로 복귀 — 다음 이탈은 새 이탈로 카운트
  }

  // 예외 B 태그 — scattered 조건을 만족하면 태그를 남긴다 (rules.isScattered 와
  // 같은 조건이지만 순환 참조를 피하기 위해 이 파일에서 직접 계산하지 않고
  // rules.ts 의 shouldClose/contextSwitched 가 쓰는 것과 동일한 임계값을 쓴다).
  if (isScatteredNow(base, now)) {
    if (!base.tags.includes('scattered')) base.tags = [...base.tags, 'scattered'];
  }

  return base;
}

interface CompressedSegment {
  domain: string;
  category: string;
  start: string;
  end: string;
  /** 이 구간에서 관측된 title 대표값 — 가장 많이 등장한 것, 동률이면 더 나중에 등장한 것. */
  title?: string;
  /** 이 구간에서 관측된 path 예시(등장 순서, 중복 제거, 최대 MAX_SEGMENT_PATHS 개). */
  paths?: string[];
}

/** buildCompressedLog 내부 누적용 — 아직 CompressedSegment 로 확정되기 전 상태. */
interface RawSegment {
  domain: string;
  category: string;
  startAt: number;
  endAt: number;
  titleCounts: Map<string, number>;
  titleLastAt: Map<string, number>;
  paths: string[];
}

function newRawSegment(e: ActivityEvent): RawSegment {
  return {
    domain: e.domain,
    category: e.category,
    startAt: e.at,
    endAt: e.at,
    titleCounts: new Map(),
    titleLastAt: new Map(),
    paths: [],
  };
}

function absorbEvent(seg: RawSegment, e: ActivityEvent): void {
  seg.endAt = e.at;
  if (e.title) {
    seg.titleCounts.set(e.title, (seg.titleCounts.get(e.title) ?? 0) + 1);
    seg.titleLastAt.set(e.title, e.at);
  }
  if (e.path && seg.paths.length < MAX_SEGMENT_PATHS && !seg.paths.includes(e.path)) {
    seg.paths.push(e.path);
  }
}

/** close() 내부에서 쓰지만, 상한·중복제거 로직을 직접 검증하기 위해 export 한다. */
export function buildCompressedLog(
  draft: SessionDraft,
): { segments: CompressedSegment[]; tags: string[]; queries: string[] } {
  const rawSegments: RawSegment[] = [];
  let cur: RawSegment | null = null;

  for (const e of draft.events) {
    if (cur && cur.domain === e.domain) {
      absorbEvent(cur, e);
    } else {
      if (cur) rawSegments.push(cur);
      cur = newRawSegment(e);
      absorbEvent(cur, e);
    }
  }
  if (cur) rawSegments.push(cur);

  // 토큰 상한 — 구간이 MAX_SEGMENTS 를 넘으면 최신 구간 위주로 남긴다
  // (LLM 이 요약에 쓰기엔 오래된 구간보다 최근 구간이 더 유용하다는 전제).
  const trimmed = rawSegments.length > MAX_SEGMENTS ? rawSegments.slice(-MAX_SEGMENTS) : rawSegments;
  const segments = trimmed.map(toSegment);

  // 세션 전체 검색 쿼리 — 등장 순서 유지, 중복 제거, 최대 MAX_QUERIES 개.
  const queries: string[] = [];
  for (const e of draft.events) {
    if (e.query && !queries.includes(e.query)) {
      queries.push(e.query);
      if (queries.length >= MAX_QUERIES) break;
    }
  }

  return { segments, tags: draft.tags, queries };
}

function toSegment(seg: RawSegment): CompressedSegment {
  const result: CompressedSegment = {
    domain: seg.domain,
    category: seg.category,
    start: new Date(seg.startAt).toISOString(),
    end: new Date(seg.endAt).toISOString(),
  };

  if (seg.titleCounts.size > 0) {
    let bestTitle: string | undefined;
    let bestCount = -1;
    let bestLastAt = -1;
    for (const [title, count] of seg.titleCounts) {
      const lastAt = seg.titleLastAt.get(title)!;
      if (count > bestCount || (count === bestCount && lastAt > bestLastAt)) {
        bestTitle = title;
        bestCount = count;
        bestLastAt = lastAt;
      }
    }
    result.title = bestTitle;
  }

  if (seg.paths.length > 0) result.paths = seg.paths;

  return result;
}

/** close() 가 만드는 전송 페이로드. packages/shared 의 sessionPayloadSchema 와
 * 형태(snake_case)를 맞춘다 — import 하지 않는 이유는 types.ts 상단 주석 참고. */
export interface SessionPayloadLike {
  id: string;
  started_at: string;
  ended_at: string;
  duration_min: number;
  close_reason: FinalCloseReason;
  continued_from: string | null;
  primary_category: string;
  activity_score: number;
  unique_domains: number;
  switch_count: number;
  tags: string[];
  compressed_log: unknown;
  domains: Record<string, number>;
}

/** draft 를 종료 사유와 함께 전송 페이로드로 확정한다. */
export function close(draft: SessionDraft, reason: FinalCloseReason, now: number): SessionPayloadLike {
  // 세션의 끝은 "닫힌 시각(now)"이 아니라 "마지막 활동 시각"이다.
  // idle 은 마지막 활동 후 30분을 기다렸다 발동하므로 now 를 쓰면 그 30분이,
  // shutdown 은 브라우저를 껐던 몇 시간이 통째로 세션 길이에 들어가 버린다 —
  // 그러면 5분짜리 세션이 35분으로 계산돼 10분 전송 필터가 무력화된다.
  const endedAt = Math.max(draft.startedAt, Math.min(draft.lastActivityAt, now));
  return {
    id: draft.id,
    started_at: new Date(draft.startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    duration_min: Math.max(0, Math.round((endedAt - draft.startedAt) / 60000)),
    close_reason: reason,
    continued_from: draft.continuedFrom ?? null,
    primary_category: draft.primaryCategory,
    // playingTick(0.5) 때문에 소수가 될 수 있다 — 서버 스키마는 int.
    activity_score: Math.round(draft.activityScore),
    unique_domains: Object.keys(draft.domains).length,
    switch_count: draft.switchCount,
    tags: draft.tags,
    compressed_log: buildCompressedLog(draft),
    domains: draft.domains,
  };
}

/**
 * maxlen 절단 시 다음 draft. previous.id 를 continuedFrom 으로 이어붙여
 * 서버가 두 세션을 하나의 경험으로 재조립할 수 있게 한다 (계획서 04장).
 */
export function continueDraft(previous: SessionDraft, now: number): SessionDraft {
  return {
    id: newId(),
    startedAt: now,
    lastActivityAt: now,
    primaryCategory: previous.primaryCategory,
    events: [],
    switchCount: 0,
    tags: [],
    domains: {},
    activityScore: 0,
    continuedFrom: previous.id,
  };
}
