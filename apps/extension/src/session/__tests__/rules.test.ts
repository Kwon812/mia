import { describe, expect, it } from 'vitest';
import { categorize } from '../categories';
import {
  contextSwitched,
  dayBoundaryCrossed,
  dominantCategory,
  isScattered,
  isWorthSending,
  shouldClose,
} from '../rules';
import type { ActivityEvent, SessionDraft } from '../types';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// day 경계(새벽 4시) 테스트를 제외한 나머지는 이 시각을 기준으로 상대 오프셋만
// 쓴다. 정오로 고정해 로컬 타임존이 무엇이든 "새벽 4시 - 4시간(다이제스트 이동)"
// 경계 근처에 우연히 걸리는 일이 없게 한다.
const ANCHOR = new Date(2026, 7, 4, 12, 0, 0).getTime();

function ev(overrides: Partial<ActivityEvent> & { at: number; domain: string }): ActivityEvent {
  return {
    category: categorize(overrides.domain),
    isActiveTab: true,
    scrolls: 1,
    clicks: 0,
    keys: 0,
    tabSwitch: false,
    ...overrides,
  };
}

function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    id: 'draft-1',
    startedAt: 0,
    lastActivityAt: 0,
    primaryCategory: 'dev',
    events: [],
    switchCount: 0,
    tags: [],
    domains: {},
    activityScore: 0,
    ...overrides,
  };
}

describe('categorize', () => {
  it('서브도메인이 longest-suffix 로 상위 도메인보다 우선한다', () => {
    expect(categorize('music.youtube.com')).toBe('music');
    expect(categorize('youtube.com')).toBe('entertainment');
    expect(categorize('www.youtube.com')).toBe('entertainment');
  });

  it('미등록 도메인은 etc', () => {
    expect(categorize('some-random-blog.example')).toBe('etc');
  });
});

describe('shouldClose — idle', () => {
  it('마지막 활동으로부터 30분 초과면 idle', () => {
    const d = draft({ startedAt: ANCHOR, lastActivityAt: ANCHOR });
    expect(shouldClose(d, ANCHOR + 31 * MIN)).toBe('idle');
  });

  it('30분 이내면 idle 아님', () => {
    const d = draft({ startedAt: ANCHOR, lastActivityAt: ANCHOR });
    expect(shouldClose(d, ANCHOR + 29 * MIN)).toBeNull();
  });
});

describe('shouldClose — maxlen', () => {
  it('4시간 초과면 maxlen', () => {
    const d = draft({ startedAt: ANCHOR, lastActivityAt: ANCHOR + 3 * HOUR + 50 * MIN });
    expect(shouldClose(d, ANCHOR + 4 * HOUR + 1 * MIN)).toBe('maxlen');
  });

  it('4시간 이내면 maxlen 아님', () => {
    const d = draft({ startedAt: ANCHOR, lastActivityAt: ANCHOR + 3 * HOUR + 59 * MIN });
    expect(shouldClose(d, ANCHOR + 3 * HOUR + 59 * MIN)).toBeNull();
  });
});

describe('shouldClose — day (새벽 4시 경계)', () => {
  it('새벽 4시를 넘어가면 day', () => {
    // 2026-08-04 오전 2시 시작 (KST 기준 로컬), 다음날 새벽 5시까지 활동 지속
    const startedAt = new Date(2026, 7, 4, 2, 0, 0).getTime();
    const now = new Date(2026, 7, 4, 5, 0, 0).getTime();
    const d = draft({ startedAt, lastActivityAt: now });
    expect(shouldClose(d, now)).toBe('day');
  });

  it('같은 논리적 하루(새벽 4시 이전) 안에서는 day 아님', () => {
    const startedAt = new Date(2026, 7, 4, 1, 0, 0).getTime();
    const now = new Date(2026, 7, 4, 3, 30, 0).getTime();
    const d = draft({ startedAt, lastActivityAt: now });
    expect(dayBoundaryCrossed(d, now)).toBe(false);
    expect(shouldClose(d, now)).toBeNull();
  });
});

describe('contextSwitched — 10분 유예', () => {
  it('맥락 이탈 9분 후 원래 카테고리로 복귀하면 전환 아님', () => {
    // youtube 로 짧게(0분) 이탈했다가 2~9분 사이 github 활동이 다시 우세해져
    // "최근 10분" 창의 우세 카테고리가 도로 dev(primaryCategory) 가 된다.
    const events: ActivityEvent[] = [
      ev({ at: ANCHOR, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 2 * MIN, domain: 'github.com' }),
      ev({ at: ANCHOR + 4 * MIN, domain: 'github.com' }),
      ev({ at: ANCHOR + 6 * MIN, domain: 'github.com' }),
      ev({ at: ANCHOR + 8 * MIN, domain: 'github.com' }),
      ev({ at: ANCHOR + 9 * MIN, domain: 'github.com' }),
    ];
    const d = draft({ startedAt: ANCHOR, lastActivityAt: ANCHOR + 9 * MIN, primaryCategory: 'dev', events });
    // now = 9분 지점: 최근 10분 창의 우세 카테고리가 이미 dev(primaryCategory) 로
    // 돌아와 있으므로 애초에 "새 카테고리"로 판정되지 않는다 — 전환 아님.
    expect(contextSwitched(d, ANCHOR + 9 * MIN)).toBe(false);
    expect(shouldClose(d, ANCHOR + 9 * MIN)).not.toBe('switch');
  });

  it('맥락 이탈이 10분 이상 지속되면 switch', () => {
    const events: ActivityEvent[] = [
      ev({ at: ANCHOR, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 3 * MIN, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 6 * MIN, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 9 * MIN, domain: 'youtube.com' }),
    ];
    const d = draft({ startedAt: ANCHOR, lastActivityAt: ANCHOR + 9 * MIN, primaryCategory: 'dev', events });
    // now = 10분: youtube.com 첫 이벤트(0분)로부터 10분 경과, 그 사이 계속 youtube 우세
    expect(contextSwitched(d, ANCHOR + 10 * MIN)).toBe(true);
    expect(shouldClose(d, ANCHOR + 10 * MIN)).toBe('switch');
  });
});

describe('예외 A — 보조 도메인(COMPANION) 흡수', () => {
  it('GitHub + chatgpt.com + developer.mozilla.org 혼합은 개발 세션으로 유지된다', () => {
    const events: ActivityEvent[] = [
      ev({ at: ANCHOR, domain: 'github.com' }),
      ev({ at: ANCHOR + 2 * MIN, domain: 'chatgpt.com' }),
      ev({ at: ANCHOR + 4 * MIN, domain: 'developer.mozilla.org' }),
      ev({ at: ANCHOR + 6 * MIN, domain: 'chatgpt.com' }),
      ev({ at: ANCHOR + 8 * MIN, domain: 'github.com' }),
    ];
    const d = draft({ startedAt: ANCHOR, lastActivityAt: ANCHOR + 8 * MIN, primaryCategory: 'dev', events });

    // dominantCategory 는 COMPANION(chatgpt.com, developer.mozilla.org) 을 제외하고
    // github.com(dev) 만으로 계산되어야 한다.
    expect(dominantCategory(events)).toBe('dev');
    // 10분 넘게 흘러도 전환으로 판정되지 않는다 — 흡수 없으면 세 개로 쪼개졌을 것.
    expect(contextSwitched(d, ANCHOR + 15 * MIN)).toBe(false);
    expect(shouldClose(d, ANCHOR + 15 * MIN)).not.toBe('switch');
  });
});

describe('예외 B — scattered (왕복은 끊지 않고 태그)', () => {
  it('switchCount 3회 이상 + 60분 미만이면 진짜 전환도 흡수되어 종료되지 않는다', () => {
    // 최근 10분 내내 youtube 우세, drift 10분 이상 지속 → 원래는 switch 감이지만
    // switchCount(3) + 경과 10분(<60분) 조건으로 scattered 처리되어 끊기지 않는다.
    const events: ActivityEvent[] = [
      ev({ at: ANCHOR, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 3 * MIN, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 6 * MIN, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 9 * MIN, domain: 'youtube.com' }),
    ];
    const d = draft({
      startedAt: ANCHOR,
      lastActivityAt: ANCHOR + 9 * MIN,
      primaryCategory: 'dev',
      events,
      switchCount: 3,
    });
    const now = ANCHOR + 10 * MIN; // 세션 경과 10분 < 60분

    expect(isScattered(d, now)).toBe(true);
    expect(contextSwitched(d, now)).toBe(false); // 예외 B 로 흡수됨
    expect(shouldClose(d, now)).not.toBe('switch');
  });

  it('60분 이상 지난 뒤에는 scattered 예외가 풀려 다시 switch 로 끊긴다', () => {
    const events: ActivityEvent[] = [
      ev({ at: ANCHOR + 60 * MIN, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 63 * MIN, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 66 * MIN, domain: 'youtube.com' }),
      ev({ at: ANCHOR + 69 * MIN, domain: 'youtube.com' }),
    ];
    const d = draft({
      startedAt: ANCHOR,
      lastActivityAt: ANCHOR + 69 * MIN,
      primaryCategory: 'dev',
      events,
      switchCount: 3,
    });
    const now = ANCHOR + 70 * MIN; // 세션 경과 70분 >= 60분 → scattered 예외 소멸

    expect(isScattered(d, now)).toBe(false);
    expect(contextSwitched(d, now)).toBe(true);
    expect(shouldClose(d, now)).toBe('switch');
  });
});

describe('예외 C — 백그라운드 재생(BACKGROUND_AUDIO)', () => {
  it('music.youtube.com 이 비활성 탭이면 카테고리 판정에서 제외된다', () => {
    const events: ActivityEvent[] = [
      ev({ at: 0, domain: 'github.com' }),
      ev({ at: 2 * MIN, domain: 'music.youtube.com', isActiveTab: false }),
      ev({ at: 4 * MIN, domain: 'music.youtube.com', isActiveTab: false }),
      ev({ at: 6 * MIN, domain: 'github.com' }),
    ];
    expect(dominantCategory(events)).toBe('dev');
  });

  it('music.youtube.com 이 활성 탭이면 카테고리 판정에 포함된다', () => {
    const events: ActivityEvent[] = [
      ev({ at: 0, domain: 'music.youtube.com', isActiveTab: true }),
      ev({ at: 2 * MIN, domain: 'music.youtube.com', isActiveTab: true }),
    ];
    expect(dominantCategory(events)).toBe('music');
  });
});

describe('isWorthSending — 전송 필터', () => {
  const base = { duration_min: 20, activity_score: 100, unique_domains: 2, primary_category: 'dev' };

  it('10분 미만이면 컷', () => {
    expect(isWorthSending({ ...base, duration_min: 9 })).toBe(false);
  });

  it('activityScore 50 미만이면 컷', () => {
    expect(isWorthSending({ ...base, activity_score: 49 })).toBe(false);
  });

  it('단일 도메인 + entertainment + activityScore 150 미만이면 컷 (영상 필터)', () => {
    expect(
      isWorthSending({
        duration_min: 30,
        activity_score: 120,
        unique_domains: 1,
        primary_category: 'entertainment',
      }),
    ).toBe(false);
  });

  it('단일 도메인 + entertainment 라도 activityScore 150 이상이면 통과 (진짜 강의 시청)', () => {
    expect(
      isWorthSending({
        duration_min: 40,
        activity_score: 150,
        unique_domains: 1,
        primary_category: 'entertainment',
      }),
    ).toBe(true);
  });

  it('조건을 모두 만족하면 통과', () => {
    expect(isWorthSending(base)).toBe(true);
  });
});
