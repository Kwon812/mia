// rawEvents → SessionDraft 갱신(ingest), draft → 전송 페이로드(close).
//
// ingest/close 모두 순수 함수다: Date.now() 를 직접 부르지 않고 `now` 를
// 인자로 받는다. 유일한 예외는 crypto.randomUUID() 로 만드는 세션 id인데,
// 이는 "규칙 결과"가 아니라 "새 세션의 식별자 발급"이라 결정성이 필요 없다.

import { categorize } from './categories';
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

function newId(): string {
  return crypto.randomUUID();
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
  const newEvents = [...rawEvents].map(normalizeEvent).sort((a, b) => a.at - b.at);

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
}

function buildCompressedLog(draft: SessionDraft): { segments: CompressedSegment[]; tags: string[] } {
  const segments: CompressedSegment[] = [];
  let cur: { domain: string; category: string; startAt: number; endAt: number } | null = null;

  for (const e of draft.events) {
    if (cur && cur.domain === e.domain) {
      cur.endAt = e.at;
    } else {
      if (cur) segments.push(toSegment(cur));
      cur = { domain: e.domain, category: e.category, startAt: e.at, endAt: e.at };
    }
  }
  if (cur) segments.push(toSegment(cur));

  return { segments, tags: draft.tags };
}

function toSegment(cur: { domain: string; category: string; startAt: number; endAt: number }): CompressedSegment {
  return {
    domain: cur.domain,
    category: cur.category,
    start: new Date(cur.startAt).toISOString(),
    end: new Date(cur.endAt).toISOString(),
  };
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
  return {
    id: draft.id,
    started_at: new Date(draft.startedAt).toISOString(),
    ended_at: new Date(now).toISOString(),
    duration_min: Math.max(0, Math.round((now - draft.startedAt) / 60000)),
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
