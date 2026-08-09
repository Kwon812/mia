import { describe, expect, it } from 'vitest';
import type { RawEvent } from '../../db';
import { isBlockedDomain } from '../categories';
import { buildCompressedLog, close, continueDraft, hasScoringEvent, ingest, MAX_QUERIES, MAX_TITLE_LEN, normalizeEvent } from '../builder';
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
      raw({ at: ANCHOR, domain: 'github.com', payload: { scrolls: 1 } }),
      raw({ at: ANCHOR + 5 * MIN, domain: 'github.com', payload: { scrolls: 1 } }),
    ];
    const draft = ingest(null, events, ANCHOR + 5 * MIN);
    // 마지막 이벤트는 다음 신호가 없어 구간을 셀 수 없으므로 0 — 첫 구간만 5분(300초).
    expect(draft.domains['github.com']).toBe(300);
  });

  it('점수 0 이벤트는 체류 시간을 가져가지 않는다', () => {
    // 배경에 열어둔 네이버 탭이 로드를 끝냈을 뿐인데, 예전에는 다음 이벤트까지의
    // 간격(최대 10분)을 통째로 가져가 "가장 오래 머문 곳"이 그쪽으로 찍혔다.
    const events = [
      raw({ at: ANCHOR, domain: 'github.com', payload: { keys: 20 } }),
      // 배경 탭 로드 완료 — eventScore 0
      { at: ANCHOR + MIN, kind: 'tab_updated', domain: 'naver.com', payload: { active: false } },
      raw({ at: ANCHOR + 9 * MIN, domain: 'github.com', payload: { keys: 20 } }),
    ];
    const draft = ingest(null, events, ANCHOR + 9 * MIN);
    // 방문 사실은 남는다(unique_domains 의 의미가 "방문한 도메인 수"여야 하므로)
    // — 다만 체류 시간은 0 이다.
    expect(draft.domains['naver.com']).toBe(0);
    // 그 9분은 실제로 사람이 있던 github 이 이어서 먹는다.
    expect(draft.domains['github.com']).toBe(9 * 60);
    // 도메인 집합은 그대로 2개 — 전송 필터의 unique_domains 판정이 안 바뀐다.
    expect(Object.keys(draft.domains)).toHaveLength(2);
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
    // 세션의 끝은 닫힌 시각(now)이 아니라 마지막 활동 시각이다 — idle 대기
    // 30분이 세션 길이에 포함되면 10분 전송 필터가 무력화된다 (close 주석 참고).
    expect(payload.ended_at).toBe(new Date(ANCHOR + 20 * MIN).toISOString());
    expect(payload.duration_min).toBe(20);
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

  it('구간마다 귀속 체류 시간(sec)을 남긴다 — start~end 로는 못 재는 값', () => {
    // 네이버 이벤트는 하나뿐이라 span 은 0 분이지만, 다음 활동까지 2분이 비어
    // 있으므로 그 2분은 네이버 몫이다. 실데이터에서 구간의 72% 가 이 모양이다.
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'localhost', payload: { scrolls: 3 } })),
      normalizeEvent(raw({ at: 6 * MIN, domain: 'localhost', payload: { scrolls: 3 } })),
      normalizeEvent(raw({ at: 7 * MIN, domain: 'www.naver.com', payload: { scrolls: 3 } })),
      normalizeEvent(raw({ at: 9 * MIN, domain: 'localhost', payload: { scrolls: 3 } })),
      normalizeEvent(raw({ at: 16 * MIN, domain: 'localhost', payload: { scrolls: 3 } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    const first = log.segments[0];
    expect(first.domain).toBe('localhost');
    expect(first.sec).toBe(7 * 60); // 0~6분 + 6~7분(다음 활동까지)

    // 네이버 구간의 span 은 0 분이다(이벤트가 하나뿐). 그런데 실제로는 2분을
    // 머물렀고, sec 이 그걸 잡는다 — start~end 만 보면 없는 시간이 된다.
    const naver = log.segments[1];
    expect(naver.domain).toBe('www.naver.com');
    expect(naver.start).toBe(naver.end);
    expect(naver.sec).toBe(2 * 60);
  });

  it('1분 미만 경유는 앞 구간의 곁가지로 접고, 시간은 그 구간에 더한다', () => {
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'localhost', payload: { scrolls: 3, title: 'Project NA' } })),
      normalizeEvent(raw({ at: 5 * MIN, domain: 'localhost', payload: { scrolls: 3, title: 'Project NA' } })),
      // 30초만 스친 곳 — 칸은 안 주되 무엇이었는지는 남는다.
      normalizeEvent(raw({ at: 6 * MIN, domain: 'supabase.com', payload: { scrolls: 1, title: 'characters | Table Editor' } })),
      normalizeEvent(raw({ at: 6 * MIN + 30_000, domain: 'localhost', payload: { scrolls: 3, title: 'Project NA' } })),
      normalizeEvent(raw({ at: 12 * MIN, domain: 'localhost', payload: { scrolls: 3, title: 'Project NA' } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments).toHaveLength(1);
    expect(log.segments[0].via).toEqual(['supabase.com · characters | Table Editor']);
    // 접힌 30초도 사라지지 않는다.
    expect(log.segments[0].sec).toBe(12 * 60);
  });

  it('같은 곳이라도 제목이 다르면 잇지 않는다 — 대상이 다르다', () => {
    // localhost 는 프로젝트마다 같은 도메인이라, 이으면 서로 다른 두 작업이
    // 압축 단계에서 한 덩어리가 된다.
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'localhost', payload: { scrolls: 3, title: 'Project NA' } })),
      normalizeEvent(raw({ at: 6 * MIN, domain: 'localhost', payload: { scrolls: 3, title: 'Project NA' } })),
      normalizeEvent(raw({ at: 7 * MIN, domain: 'www.naver.com', payload: { clicks: 1 } })),
      normalizeEvent(raw({ at: 7 * MIN + 20_000, domain: 'localhost', payload: { scrolls: 3, title: 'SOLDIER : A DAY' } })),
      normalizeEvent(raw({ at: 14 * MIN, domain: 'localhost', payload: { scrolls: 3, title: 'SOLDIER : A DAY' } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments.map((s) => s.title)).toEqual(['Project NA', 'SOLDIER : A DAY']);
  });

  it('마지막 구간은 짧아도 접지 않는다 — 무엇을 하다 끝났나가 outcome 의 근거다', () => {
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'github.com', payload: { scrolls: 3 } })),
      normalizeEvent(raw({ at: 10 * MIN, domain: 'github.com', payload: { scrolls: 3 } })),
      // 마지막 이벤트는 다음 신호가 없어 dwell 이 구조적으로 0 이다.
      normalizeEvent(raw({ at: 11 * MIN, domain: 'vercel.com', payload: { scrolls: 3 } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments.map((s) => s.domain)).toEqual(['github.com', 'vercel.com']);
    expect(log.segments.at(-1)?.sec).toBe(0);
  });

  it('세션 첫머리의 경유는 버리지 않고 다음 실질 구간에 붙인다', () => {
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'newtab', payload: { clicks: 1 } })),
      normalizeEvent(raw({ at: 20_000, domain: 'github.com', payload: { scrolls: 3 } })),
      normalizeEvent(raw({ at: 10 * MIN, domain: 'github.com', payload: { scrolls: 3 } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments).toHaveLength(1);
    expect(log.segments[0].domain).toBe('github.com');
    expect(log.segments[0].via).toEqual(['newtab']);
  });

  it('상한을 넘겨 잘리는 앞부분은 버리지 않고 earlier 합계로 남는다', () => {
    // 접고도 넘치는 건 긴 세션뿐이다(실측: 4시간짜리가 접은 뒤 22~61구간).
    // 그때 앞부분을 그냥 버리면 모델이 세션 끝자락만 보고 판정하게 된다.
    const events = Array.from({ length: 25 }, (_, i) => [
      normalizeEvent(raw({ at: i * 10 * MIN, domain: `site${i}.com`, payload: { scrolls: 3, title: `T${i}` } })),
      normalizeEvent(raw({ at: i * 10 * MIN + 5 * MIN, domain: `site${i}.com`, payload: { scrolls: 3, title: `T${i}` } })),
    ]).flat();

    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.segments).toHaveLength(20);
    expect(log.segments[0].domain).toBe('site5.com');

    const earlier = log.earlier!;
    expect(earlier.segments).toBe(5); // site0~site4
    expect(earlier.sec).toBeGreaterThan(0);
    // 번호는 segments 에서 이어진다 — 그래야 앞부분도 배정 대상이 된다.
    expect(earlier.top[0].i).toBe(20);
    expect(earlier.top[0].label).toBe('site0.com · T0');
    expect(earlier.top[0].sec).toBeGreaterThan(0);
  });

  it('상한을 안 넘으면 earlier 자체가 없다', () => {
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'github.com', payload: { scrolls: 3 } })),
      normalizeEvent(raw({ at: 10 * MIN, domain: 'github.com', payload: { scrolls: 3 } })),
    ];
    expect(buildCompressedLog(draftWithEvents(events)).earlier).toBeUndefined();
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
    expect(log.queries[0].q).toBe('unique-0');
    expect(log.queries[0].n).toBe(1);
  });

  it('같은 검색어 반복은 횟수와 구간으로 남는다 (stuck 판정의 근거)', () => {
    // 예전에는 중복을 지워서, 같은 걸 여덟 번 물어도 한 번 물은 것과 같은
    // 입력이 됐다 — 프롬프트의 stuck 기준("같은 검색어가 반복되거나")이
    // 판정할 근거를 압축 단계가 먼저 없앤 셈이었다.
    const q = 'hydration mismatch';
    const events = [
      normalizeEvent(raw({ at: 0, domain: 'google.com', payload: { query: q } })),
      normalizeEvent(raw({ at: 12 * MIN, domain: 'google.com', payload: { query: q } })),
      normalizeEvent(raw({ at: 40 * MIN, domain: 'google.com', payload: { query: q } })),
      normalizeEvent(raw({ at: 41 * MIN, domain: 'google.com', payload: { query: 'other' } })),
    ];
    const log = buildCompressedLog(draftWithEvents(events));
    expect(log.queries).toHaveLength(2);
    expect(log.queries[0]).toMatchObject({ q, n: 3 });
    // 구간이 남아야 "40분간 붙들고 있었다"가 읽힌다.
    expect(log.queries[0].first).not.toBe(log.queries[0].last);
    // 시각은 KST 오프셋 표기 — UTC 로 찍으면 LLM 의 시간대 판단이 9시간 어긋난다.
    expect(log.queries[0].first).toMatch(/\+09:00$/);
    expect(log.segments[0].start).toMatch(/\+09:00$/);
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

describe('primaryCategory — etc 잠정값 승격', () => {
  it('구글(COMPANION) 새 탭에서 시작해도 실제 카테고리가 나타나면 승격된다', () => {
    // 시작: 구글만 — COMPANION 은 투표권이 없어 잠정 'etc'
    const first = ingest(null, [raw({ at: ANCHOR, domain: 'google.com', payload: { scrolls: 2 } })], ANCHOR);
    expect(first.primaryCategory).toBe('etc');

    // 깃허브 활동이 나타나는 순간 dev 로 승격 — 가짜 switch 절단 방지
    const second = ingest(
      first,
      [raw({ at: ANCHOR + 2 * MIN, domain: 'github.com', payload: { scrolls: 3, keys: 10 } })],
      ANCHOR + 2 * MIN,
    );
    expect(second.primaryCategory).toBe('dev');

    // 한 번 실제 카테고리로 굳으면 이후에는 고정
    const third = ingest(
      second,
      [raw({ at: ANCHOR + 4 * MIN, domain: 'youtube.com', payload: { scrolls: 1 } })],
      ANCHOR + 4 * MIN,
    );
    expect(third.primaryCategory).toBe('dev');
  });
});

describe('유휴 시계는 점수가 붙는 이벤트만 리셋한다', () => {
  // tab_updated 는 eventScore 가 0 — 시스템이 이미 "활동 아님"으로 판정한 값이다.
  // 그런데 이것까지 lastActivityAt 을 밀어올려서, 자동 새로고침 배경 탭 하나가
  // 유휴 판정을 영원히 미뤘다(실측: 서버 세션 8건 중 idle 0건).
  const tabUpdated = (at: number, domain = 'github.com'): RawEvent => ({
    at,
    kind: 'tab_updated',
    domain,
    payload: { active: true, title: 't' },
  });
  const typed = (at: number, domain = 'github.com'): RawEvent => ({
    at,
    kind: 'activity',
    domain,
    payload: { keys: 30, visible: true },
  });

  it('tab_updated 만 들어오면 lastActivityAt 이 안 밀린다', () => {
    const t0 = 1_000_000;
    const draft = ingest(null, [typed(t0)], t0);
    expect(draft.lastActivityAt).toBe(t0);

    const later = ingest(draft, [tabUpdated(t0 + 20 * 60_000)], t0 + 20 * 60_000);
    expect(later.lastActivityAt).toBe(t0); // 20분이 지나도 그대로
  });

  it('탭 전환(점수 5)과 재생 틱(0.5)은 활동으로 남는다', () => {
    const t0 = 1_000_000;
    const draft = ingest(null, [typed(t0)], t0);

    const switched = ingest(draft, [{ at: t0 + 60_000, kind: 'tab_activated', domain: 'github.com', payload: {} }], t0 + 60_000);
    expect(switched.lastActivityAt).toBe(t0 + 60_000);

    const playing = ingest(switched, [{ at: t0 + 120_000, kind: 'activity', domain: 'youtube.com', payload: { playing: true, visible: true } }], t0 + 120_000);
    expect(playing.lastActivityAt).toBe(t0 + 120_000);
  });

  it('점수 0 이벤트만으로는 세션을 시작하지 않는다', () => {
    expect(hasScoringEvent([tabUpdated(1_000_000)])).toBe(false);
    expect(hasScoringEvent([tabUpdated(1_000_000), typed(1_000_001)])).toBe(true);
  });
});

// ── 조작 기록 (PLAN-observe 0단계) ───────────────────────────
//
// 도메인·제목이 "어디 있었나"라면 조작은 "무엇을 했나"다. 이게 압축을 통과해
// compressed_log 까지 살아 나가야 절차를 뽑을 수 있다. 중간에 뭉개지면
// 몇 주 뒤에야 알게 되고, 그때는 그 기간 데이터가 이미 없다.
describe('조작 기록', () => {
  const act = (at: number, payload: Record<string, unknown>): RawEvent => ({
    id: at,
    at,
    kind: 'activity',
    domain: 'app.example.com',
    payload: { scrolls: 0, clicks: 1, keys: 0, visible: true, ...payload },
  });

  it('normalizeEvent 가 조작을 통과시킨다', () => {
    const e = normalizeEvent(
      act(1000, { actions: [{ t: 'button', label: '내보내기', sel: '#export', mut: true, dt: 3.2 }] }),
    );
    expect(e.acts).toEqual([{ t: 'button', label: '내보내기', sel: '#export', mut: true, dt: 3.2 }]);
  });

  it('형태가 깨진 조작은 버린다 — rawEvents 는 오래 살아 버전이 섞인다', () => {
    const e = normalizeEvent(
      act(1000, { actions: [null, 'nope', { label: 't 없음' }, { t: 'a', label: 'ok' }] }),
    );
    expect(e.acts).toEqual([{ t: 'a', label: 'ok' }]);
  });

  it('조작이 없던 시절의 이벤트도 그대로 돈다', () => {
    expect(normalizeEvent(act(1000, {})).acts).toBeUndefined();
  });

  it('압축을 지나 compressed_log 까지 살아 나간다 — 순서를 지킨다', () => {
    const events: RawEvent[] = [
      act(0, { actions: [{ t: 'a', label: '테이블' }] }),
      act(60_000, { actions: [{ t: 'button', label: '필터', dt: 12 }] }),
      act(120_000, { actions: [{ t: 'button', label: '내보내기', sel: '#export', mut: true }] }),
    ];
    const draft = ingest(null, events, 180_000);
    const payload = close(draft, 'idle', 180_000);
    const acts = (payload.compressed_log.segments as { acts?: unknown[] }[])
      .flatMap((s) => s.acts ?? []);
    // 중복 제거를 하지 않는다 — 순서가 곧 절차의 모양이다
    expect(acts.map((a) => (a as { label: string }).label)).toEqual(['테이블', '필터', '내보내기']);
    expect(acts.some((a) => (a as { mut?: true }).mut === true)).toBe(true);
  });
});
