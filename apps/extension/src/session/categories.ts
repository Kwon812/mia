// 도메인 → 카테고리 사전.
//
// 계획서 04장 "도메인 → 카테고리 사전"은 11장에서 OPEN 항목으로 남아있고
// "본인 브라우징으로 시작"이 지침이다. 여기서는 한국 사용자 기준으로 실용적인
// 50개 내외를 시작점으로 둔다. 실데이터 검증(계획서 04장 "검증 방법") 후
// 늘어날 것을 전제로 한다.

/** 미등록 도메인의 기본 카테고리 */
export const DEFAULT_CATEGORY = 'etc';

// 카테고리 값 자체는 자유 문자열이지만, 여기서 쓰는 값들을 한 곳에 모아둔다.
export const CATEGORIES = {
  DEV: 'dev', // 개발
  STUDY: 'study', // 학습
  DOCS: 'docs', // 문서
  AI: 'ai', // AI 도구
  SEARCH: 'search', // 검색
  COMMUNITY: 'community', // 커뮤니티
  ENTERTAINMENT: 'entertainment', // 엔터테인먼트
  MUSIC: 'music', // 음악
  SHOPPING: 'shopping', // 쇼핑
  PRODUCTIVITY: 'productivity', // 생산성
  NEWS: 'news', // 뉴스
  FINANCE: 'finance', // 금융
  ETC: DEFAULT_CATEGORY,
} as const;

/**
 * 도메인(호스트명) → 카테고리 사전.
 * 서브도메인은 longest-suffix 매칭(categorize 참고)으로 별도 처리되므로,
 * 여기 있는 정확한 호스트명이 우선 매칭된다 (예: music.youtube.com 이
 * youtube.com 보다 먼저 걸린다).
 */
export const CATEGORY_MAP: Record<string, string> = {
  // ── 개발 ──
  'github.com': CATEGORIES.DEV,
  'gitlab.com': CATEGORIES.DEV,
  'bitbucket.org': CATEGORIES.DEV,
  'stackoverflow.com': CATEGORIES.DEV, // COMPANION 이기도 함 — 카테고리 판정에서는 흡수됨
  'npmjs.com': CATEGORIES.DEV,
  'vercel.com': CATEGORIES.DEV,
  'codesandbox.io': CATEGORIES.DEV,
  'replit.com': CATEGORIES.DEV,
  'codepen.io': CATEGORIES.DEV,
  'jsfiddle.net': CATEGORIES.DEV,
  'docker.com': CATEGORIES.DEV,
  'kubernetes.io': CATEGORIES.DEV,
  'supabase.com': CATEGORIES.DEV,
  'localhost': CATEGORIES.DEV, // 로컬 개발 서버

  // ── 학습 ──
  'inflearn.com': CATEGORIES.STUDY,
  'udemy.com': CATEGORIES.STUDY,
  'coursera.org': CATEGORIES.STUDY,
  'khanacademy.org': CATEGORIES.STUDY,
  'fastcampus.co.kr': CATEGORIES.STUDY,
  'programmers.co.kr': CATEGORIES.STUDY,
  'leetcode.com': CATEGORIES.STUDY,

  // ── 문서 ──
  'developer.mozilla.org': CATEGORIES.DOCS, // COMPANION
  'docs.google.com': CATEGORIES.DOCS,
  'confluence.atlassian.com': CATEGORIES.DOCS,
  'readthedocs.io': CATEGORIES.DOCS,

  // ── AI 도구 ──
  'chatgpt.com': CATEGORIES.AI, // COMPANION
  'claude.ai': CATEGORIES.AI, // COMPANION
  'openai.com': CATEGORIES.AI,
  'perplexity.ai': CATEGORIES.AI,
  'gemini.google.com': CATEGORIES.AI, // google.com 보다 우선 매칭되어야 함

  // ── 검색 ──
  'google.com': CATEGORIES.SEARCH, // COMPANION
  'bing.com': CATEGORIES.SEARCH,
  'duckduckgo.com': CATEGORIES.SEARCH,
  'naver.com': CATEGORIES.SEARCH,

  // ── 커뮤니티 ──
  'reddit.com': CATEGORIES.COMMUNITY,
  'news.ycombinator.com': CATEGORIES.COMMUNITY,
  'clien.net': CATEGORIES.COMMUNITY,
  'dcinside.com': CATEGORIES.COMMUNITY,
  'fmkorea.com': CATEGORIES.COMMUNITY,
  'x.com': CATEGORIES.COMMUNITY,
  'twitter.com': CATEGORIES.COMMUNITY,
  'facebook.com': CATEGORIES.COMMUNITY,
  'instagram.com': CATEGORIES.COMMUNITY,
  'threads.net': CATEGORIES.COMMUNITY,

  // ── 엔터테인먼트 ──
  'youtube.com': CATEGORIES.ENTERTAINMENT,
  'netflix.com': CATEGORIES.ENTERTAINMENT,
  'twitch.tv': CATEGORIES.ENTERTAINMENT,
  'watcha.com': CATEGORIES.ENTERTAINMENT,
  'wavve.com': CATEGORIES.ENTERTAINMENT,
  'tving.com': CATEGORIES.ENTERTAINMENT,

  // ── 음악 (백그라운드 재생 예외 대상과 대체로 겹침) ──
  'music.youtube.com': CATEGORIES.MUSIC, // youtube.com 보다 우선 매칭되어야 함
  'spotify.com': CATEGORIES.MUSIC,
  'music.apple.com': CATEGORIES.MUSIC,
  'melon.com': CATEGORIES.MUSIC,
  'genie.co.kr': CATEGORIES.MUSIC,
  'soundcloud.com': CATEGORIES.MUSIC,

  // ── 쇼핑 ──
  'coupang.com': CATEGORIES.SHOPPING,
  'amazon.com': CATEGORIES.SHOPPING,
  'gmarket.co.kr': CATEGORIES.SHOPPING,
  '11st.co.kr': CATEGORIES.SHOPPING,
  'aliexpress.com': CATEGORIES.SHOPPING,

  // ── 생산성 ──
  'notion.so': CATEGORIES.PRODUCTIVITY,
  'slack.com': CATEGORIES.PRODUCTIVITY,
  'trello.com': CATEGORIES.PRODUCTIVITY,
  'asana.com': CATEGORIES.PRODUCTIVITY,
  'linear.app': CATEGORIES.PRODUCTIVITY,
  'calendar.google.com': CATEGORIES.PRODUCTIVITY,
  'mail.google.com': CATEGORIES.PRODUCTIVITY,
  'outlook.com': CATEGORIES.PRODUCTIVITY,

  // ── 뉴스 ──
  'news.naver.com': CATEGORIES.NEWS,
  'nytimes.com': CATEGORIES.NEWS,

  // ── 금융 ──
  'toss.im': CATEGORIES.FINANCE,
  'kbstar.com': CATEGORIES.FINANCE,
};

/**
 * 예외 A(보조 도메인 흡수) 대상.
 * 계획서 04장 원문 5개 + 같은 성격(검색/문서/AI 도구)의 합리적 추가.
 * 카테고리 "판정"에서만 제외되고, domains 누적/activityScore 계산에는 그대로
 * 포함된다 (rules.ts 의 isRelevantForCategory 참고).
 */
export const COMPANION: readonly string[] = [
  // 계획서 원문
  'google.com',
  'stackoverflow.com',
  'chatgpt.com',
  'claude.ai',
  'developer.mozilla.org',
  // 합리적 추가 — 같은 성격(검색/AI 도구)
  'bing.com',
  'duckduckgo.com',
  'perplexity.ai',
  'openai.com',
  'gemini.google.com',
];

/**
 * 예외 C(백그라운드 재생) 대상.
 * 활성 탭이 아닐 때는 카테고리 판정에서 제외한다 (ActivityEvent.isActiveTab).
 */
export const BACKGROUND_AUDIO: readonly string[] = [
  'music.youtube.com',
  'spotify.com',
  'music.apple.com',
  'soundcloud.com',
];

/**
 * hostname 이 set 에 있는 도메인의 서브도메인인지(자기 자신 포함) longest-suffix
 * 로 확인한다. 예: isDomainInSet('open.spotify.com', BACKGROUND_AUDIO) === true
 */
function isDomainInSet(hostname: string, set: readonly string[]): boolean {
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (set.includes(suffix)) return true;
  }
  return false;
}

export function isCompanionDomain(hostname: string): boolean {
  return isDomainInSet(hostname, COMPANION);
}

export function isBackgroundAudioDomain(hostname: string): boolean {
  return isDomainInSet(hostname, BACKGROUND_AUDIO);
}

/**
 * hostname → 카테고리. 서브도메인 longest-suffix 매칭:
 * 'music.youtube.com' 전체 호스트부터 검사해 CATEGORY_MAP 에 있으면 그 값을
 * 쓰고, 없으면 왼쪽 라벨을 하나씩 잘라내며 (music.youtube.com → youtube.com
 * → com) 더 짧은 접미사로 재시도한다. 가장 긴 접미사가 먼저 매칭되므로
 * 'music.youtube.com' 이 'youtube.com' 보다 항상 우선한다.
 * 어디에도 없으면 'etc'.
 */
export function categorize(hostname: string): string {
  if (!hostname) return DEFAULT_CATEGORY;
  const labels = hostname.toLowerCase().split('.');
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    const category = CATEGORY_MAP[suffix];
    if (category) return category;
  }
  return DEFAULT_CATEGORY;
}
