import { describe, expect, it } from 'vitest';
import type { RawEvent } from '../../db';
import { isBlockedDomain } from '../categories';
import { buildCompressedLog, close, continueDraft, ingest, MAX_QUERIES, MAX_TITLE_LEN, normalizeEvent } from '../builder';
import { shouldClose } from '../rules';
import type { SessionDraft } from '../types';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ANCHOR = new Date(2026, 7, 4, 12, 0, 0).getTime();

function raw(overrides: Partial<RawEvent> & { at: number; domain: string }): RawEvent {
  return {
    kind: 'activity',
    payload: { scrolls: 1 },
    ...overrides,
  };
}

describe('normalizeEvent — isActiveTab 판정', () => {
  it('tab_activated 는 항상 활성 탭이다', () => {
    const e = normalizeEvent(raw({ at: 0, domain: 'github.com', kind: 'tab_activated', payload: {} }));
    expect(e.isActiveTab).toBe(true);
    expect(e.tabSwitch).toBe(true);
  });

  it('tab_updated 는 payload.active 를 그대로 따른다', () => {
    const activeEvt = normalizeEvent(
      raw({ at: 0, domain: 'github.com', kind: 'tab_updated', payload: { active: true } }),
    );
    const inactiveEvt = normalizeEvent(
      raw({ at: 0, domain: 'music.youtube.com', kind: 'tab_updated', payload: { active: false } }),
    );
    expect(activeEvt.isActiveTab).toBe(true);
    expect(inactiveEvt.isActiveTab).toBe(false);
  });

  it('activity(content script) 는 payload.visible 을 따르고, 없으면 활성으로 간주한다', () => {
    const visible = normalizeEvent(
      raw({ at: 0, domain: 'music.youtube.com', kind: 'activity', payload: { visible: true, scrolls: 2 } }),
    );
    const hidden = normalizeEvent(
      raw({ at: 0, domain: 'music.youtube.com', kind: 'activity', payload: { visible: false, scrolls: 2 } }),
    );
    const missing = normalizeEvent(raw({ at: 0, domain: 'github.com', kind: 'activity', payload: {} }));
    expect(visible.isActiveTab).toBe(true);
    expect(hidden.isActiveTab).toBe(false);
    expect(missing.isActiveTab).toBe(true);
  });
});

describe('ingest — 기본 동작', () => {
  it('draft 가 없으면 새 세션을 만들고 primaryCategory 를 확정한다', () => {
    const events = [
      raw({ at: ANCHOR, domain: 'github.com' }),
      raw({ at: ANCHOR + MIN, domain: 'github.com' }),
    ];
    const draft = ingest(null, events, ANCHOR + MIN);
    expect(typeof draft.id).toBe('string');
    expect(draft.id.length).toBeGreaterThan(10);
    expect(draft.startedAt).toBe(ANCHOR);
    expect(draft.primaryCategory).toBe('dev');
    expect(draft.events).toHaveLength(2);
  });

  it('domains 는 이벤트 사이 간격을 초 단위로 누적한다', () => {
    const events = [
      raw({ at: ANCHOR, domain: 'github.com', payload: { scrolls: 0 } }),
      raw({ at: ANCHOR + 5 * MIN, domain: 'github.com', payload: { scrolls: 0 } }),
    ];
    const draft = ingest(null, events, ANCHOR + 5 * MIN);
    // 마지막 이벤트는 다음 신호가 없어 구간을 셀 수 없으므로 0 — 첫 구간만 5분(300초).
    expect(draft.domains['github.com']).toBe(300);
  });

  it('activityScore 는 이벤트들의 가중합이다', () => {
    const events = [raw({ at: ANCHOR, domain: 'github.com', payload: { scrolls: 3, clicks: 2, keys: 1 } })];
    const draft = ingest(null, events, ANCHOR);
    // 가중치: scroll 1, click 2, key 1 → 3*1 + 2*2 + 1*1 = 8
    expect(draft.activityScore).toBe(8);
  });

  it('이어지는 ingest 호출은 기존 draft 를 누적 갱신한다(같은 id 유지)', () => {
    const first = ingest(null, [raw({ at: ANCHOR, domain: 'github.com' })], ANCHOR);
    const second = ingest(first, [raw({ at: ANCHOR + MIN, domain: 'github.com' })], ANCHOR + MIN);
    expect(second.id).toBe(first.id);
    expect(second.events).toHaveLength(2);
  });
});

describe('close — 전송 페이로드', () => {
  it('snake_case 필드와 compressed_log 세그먼트를 만든다', () => {
    const events = [
      raw({ at: ANCHOR, domain: 'github.com', payload: { scrolls: 5 } }),
      raw({ at: ANCHOR + 20 * MIN, domain: 'stackoverflow.com', payload: { scrolls: 5 } }),
    ];
    const draft = ingest(null, events, ANCHOR + 20 * MIN);
    const now = ANCHOR + 25 * MIN;
    const payload = close(draft, 'idle', now);

    expect(payload.id).toBe(draft.id);
    expect(payload.started_at).toBe(new Date(ANCHOR).toISOString());
    expect(payload.ended_at).toBe(new Date(now).toISOString());
    expect(payload.duration_min).toBe(25);
    expect(payload.close_reason).toBe('idle');
    expect(payload.continued_from).toBeNull();
    expect(payload.primary_category).toBe('dev');
    expect(payload.unique_domains).toBe(2);
    expect(payload.domains).toHaveProperty('github.com');
    expect(payload.domains).toHaveProperty('stackoverflow.com');

    const log = payload.compressed_log as { segments: Array<{ domain: string }> };
    expect(log.segments.map((s) => s.domain)).toEqual(['github.com', 'stackoverflow.com']);
  });
});

describe('maxlen → continuedFrom 체인', () => {
  it('4시간 초과 세션은 maxlen 으로 닫히고, 다음 draft 가 continuedFrom 을 갖는다', () => {
    const startEvents = [raw({ at: ANCHOR, domain: 'github.com' })];
    let draft = ingest(null, startEvents, ANCHOR);

    const laterNow = ANCHOR + 4 * HOUR + 1 * MIN;
    draft = ingest(draft, [raw({ at: laterNow, domain: 'github.com' })], laterNow);

    const reason = shouldClose(draft, laterNow);
    expect(reason).toBe('maxlen');

    const payload = close(draft, reason!, laterNow);
    expect(payload.close_reason).toBe('maxlen');
    expect(payload.continued_from).toBeNull(); // 이 세션 자신은 이전 세션을 잇는 게 아님

    const next = continueDraft(draft, laterNow);
    expect(next.continuedFrom).toBe(draft.id);
    expect(next.primaryCategory).toBe(draft.primaryCategory);
    expect(next.switchCount).toBe(0);
    expect(next.events).toHaveLength(0);
    expect(next.startedAt).toBe(laterNow);
  });
});

describe('예외 B — scattered 는 실제 ingest 틱을 거쳐도 누적된다', () => {
  it('GitHub↔YouTube 3왕복(각 10분 미만) → switchCount 누적, scattered 태그, 종료 아님', () => {
    // 각 "방문"은 최근 10분 창에서 확실히 우세하도록 이벤트 2개씩 묶는다.
    // 방문 사이사이 github 로 확실히 복귀시켜 activeExcursionCategory 를 리셋한다.
    const timeline: Array<{ at: number; domain: string }> = [
      { at: 0, domain: 'github.com' },
      // 왕복 1
      { at: 2 * MIN, domain: 'youtube.com' },
      { at: 3 * MIN, domain: 'youtube.com' },
      { at: 4 * MIN, domain: 'github.com' },
      { at: 5 * MIN, domain: 'github.com' },
      { at: 6 * MIN, domain: 'github.com' },
      // 왕복 2
      { at: 8 * MIN, domain: 'youtube.com' },
      { at: 9 * MIN, domain: 'youtube.com' },
      { at: 10 * MIN, domain: 'github.com' },
      { at: 11 * MIN, domain: 'github.com' },
      { at: 12 * MIN, domain: 'github.com' },
      // 왕복 3
      { at: 14 * MIN, domain: 'youtube.com' },
      { at: 15 * MIN, domain: 'youtube.com' },
      { at: 16 * MIN, domain: 'github.com' },
      { at: 17 * MIN, domain: 'github.com' },
      { at: 18 * MIN, domain: 'github.com' },
    ];

    let draft = ingest(null, [raw({ at: ANCHOR + timeline[0].at, domain: timeline[0].domain })], ANCHOR);

    // 1분 알람(sessionCheck)을 흉내내 매 분마다 그 시점에 발생한 이벤트만 넘긴다.
    for (let minute = 1; minute <= 20; minute++) {
      const now = ANCHOR + minute * MIN;
      const tickEvents = timeline
        .filter((e) => e.at === minute * MIN)
        .map((e) => raw({ at: now, domain: e.domain }));
      draft = ingest(draft, tickEvents, now);
    }

    const finalNow = ANCHOR + 20 * MIN;
    expect(draft.switchCount).toBeGreaterThanOrEqual(3);
    expect(draft.tags).toContain('scattered');
    // scattered 로 흡수되어 idle/switch/maxlen/day 어느 것으로도 끊기지 않는다.
    expect(shouldClose(draft, finalNow)).toBeNull();
  });
});

describe('normalizeEvent — 의도 컨텍스트(title/path/query) 매핑', () => {
  it('payload 의 title/path/query 를 그대로 옮긴다', () => {
    const e = normalizeEvent(
      raw({
        at: 0,
        domain: 'google.com',
        kind: 'activity',
        payload: { scrolls: 1, title: 'redis cache invalidation - Google 검색', path: '/search', query: 'redis cache invalidation' },
      }),
    );
    expect(e.title).toBe('redis cache invalidation - Google 검색');
    expect(e.path).toBe('/search');
    expect(e.query).toBe('redis cache invalidation');
  });

  it('title/path 는 MAX_TITLE_LEN 을 넘으면 절단된다', () => {
    const longTitle = 'a'.repeat(300);
    const e = normalizeEvent(raw({ at: 0, domain: 'github.com', payload: { title: longTitle } }));
    expect(e.title).toHaveLength(MAX_TITLE_LEN);
  });

  it('필드가 없으면 undefined 로 남는다(전송하지 않은 것으로 취급)', () => {
    const e = normalizeEvent(raw({ at: 0, domain: 'github.com', payload: {} }));
    expect(e.title).toBeUndefined();
    expect(e.path).toBeUndefined();
    expect(e.query).toBeUndefined();
  });

  it('tab_activated/tab_updated 도 payload.title(tabs 권한)을 옮긴다', () => {
    const e = normalizeEvent(
      raw({ at: 0, domain: 'github.com', kind: 'tab_activated', payload: { title: 'GitHub · repo' } }),
    );
    expect(e.title).toBe('GitHub · repo');
  });
});

describe('buildCompressedLog — 상한·중복 제거', () => {
  function draftWithEvents(events: SessionDraft['events']): SessionDraft {
    return {
      id: 'd1',
      startedAt: events[0]?.at ?? 0,
      lastActivityAt: events[events.length - 1]?.at ?? 0,
      primaryCategory: 'dev',
      events,
      switchCount: 0,
      tags: [],
      domains: {},
      activityScore: 0,
    };
  }

  it('구간별 title 대표값 — 가장 많이 등장한 것을 고른다', () => {
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'github.com', payload: { title: 'Issue #1' } })),
      normalizeEvent(raw({ at: MIN, domain: 'github.com', payload: { title: 'Issue #2' } })),
      normalizeEvent(raw({ at: 2 * MIN, domain: 'github.com', payload: { title: 'Issue #1' } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments).toHaveLength(1);
    expect(log.segments[0].title).toBe('Issue #1');
  });

  it('구간별 path 예시를 등장 순서대로, 중복 없이 모은다', () => {
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'github.com', payload: { path: '/a' } })),
      normalizeEvent(raw({ at: MIN, domain: 'github.com', payload: { path: '/b' } })),
      normalizeEvent(raw({ at: 2 * MIN, domain: 'github.com', payload: { path: '/a' } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments[0].paths).toEqual(['/a', '/b']);
  });

  it('segments 가 MAX_SEGMENTS(20) 를 넘으면 최신 구간만 남긴다', () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      normalizeEvent(raw({ at: i * MIN, domain: `site${i}.com` })),
    );
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments).toHaveLength(20);
    // 가장 오래된 5개(site0~site4)는 잘리고 최신 20개만 남는다.
    expect(log.segments[0].domain).toBe('site5.com');
    expect(log.segments.at(-1)?.domain).toBe('site24.com');
  });

  it('queries 는 세션 전체에서 중복 제거되고 MAX_QUERIES(15) 개로 상한이 걸린다', () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      normalizeEvent(raw({ at: i * MIN, domain: 'google.com', payload: { query: `q${i % 10}` } })),
    );
    const log = buildCompressedLog(draftWithEvents(events));
    // q0~q9 만 실제로 존재(중복 제거) — 10개, MAX_QUERIES(15) 이내라 그대로.
    expect(log.queries).toHaveLength(10);
    expect(new Set(log.queries).size).toBe(log.queries.length);
    expect(log.queries.length).toBeLessThanOrEqual(MAX_QUERIES);
  });

  it('queries 가 MAX_QUERIES 를 넘는 고유값이면 앞에서부터 15개로 잘린다', () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      normalizeEvent(raw({ at: i * MIN, domain: 'google.com', payload: { query: `unique-${i}` } })),
    );
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.queries).toHaveLength(MAX_QUERIES);
    expect(log.queries[0]).toBe('unique-0');
  });
});

describe('blocked 도메인 — sw 필터를 우회해 들어와도 세션에서 제외된다', () => {
  it('isBlockedDomain 은 은행 도메인에 true 를 반환한다 (방어선 확인)', () => {
    expect(isBlockedDomain('kbstar.com')).toBe(true);
  });

  it('ingest 에 blocked 도메인 rawEvent 가 섞여 들어와도 draft.events 에서 제외된다', () => {
    const events = [
      raw({ at: ANCHOR, domain: 'github.com' }),
      raw({ at: ANCHOR + MIN, domain: 'kbstar.com' }), // sw 필터를 우회해 들어온 것으로 가정
      raw({ at: ANCHOR + 2 * MIN, domain: 'github.com' }),
    ];
    const d = ingest(null, events, ANCHOR + 2 * MIN);
    expect(d.events.map((e) => e.domain)).toEqual(['github.com', 'github.com']);
    expect(d.domains).not.toHaveProperty('kbstar.com');
  });
});
