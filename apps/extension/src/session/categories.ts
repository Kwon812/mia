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
  DESIGN: 'design', // 디자인·창작
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
  'sourceforge.net': CATEGORIES.DEV,
  'stackoverflow.com': CATEGORIES.DEV, // COMPANION 이기도 하다 — 판정에서만 빠진다
  'npmjs.com': CATEGORIES.DEV,
  'pypi.org': CATEGORIES.DEV,
  'crates.io': CATEGORIES.DEV,
  'packagist.org': CATEGORIES.DEV,
  'rubygems.org': CATEGORIES.DEV,
  'nuget.org': CATEGORIES.DEV,
  'pkg.go.dev': CATEGORIES.DEV,
  'vercel.com': CATEGORIES.DEV,
  'netlify.com': CATEGORIES.DEV,
  'render.com': CATEGORIES.DEV,
  'fly.io': CATEGORIES.DEV,
  'railway.app': CATEGORIES.DEV,
  'heroku.com': CATEGORIES.DEV,
  'cloudflare.com': CATEGORIES.DEV,
  'digitalocean.com': CATEGORIES.DEV,
  'linode.com': CATEGORIES.DEV,
  'aws.amazon.com': CATEGORIES.DEV,
  'console.aws.amazon.com': CATEGORIES.DEV,
  'portal.azure.com': CATEGORIES.DEV,
  'cloud.google.com': CATEGORIES.DEV,
  'firebase.google.com': CATEGORIES.DEV,
  'supabase.com': CATEGORIES.DEV,
  'planetscale.com': CATEGORIES.DEV,
  'neon.tech': CATEGORIES.DEV,
  'mongodb.com': CATEGORIES.DEV,
  'redis.io': CATEGORIES.DEV,
  'postgresql.org': CATEGORIES.DEV,
  'mysql.com': CATEGORIES.DEV,
  'sqlite.org': CATEGORIES.DEV,
  'docker.com': CATEGORIES.DEV,
  'kubernetes.io': CATEGORIES.DEV,
  'helm.sh': CATEGORIES.DEV,
  'terraform.io': CATEGORIES.DEV,
  'hashicorp.com': CATEGORIES.DEV,
  'jenkins.io': CATEGORIES.DEV,
  'circleci.com': CATEGORIES.DEV,
  'travis-ci.com': CATEGORIES.DEV,
  'gitpod.io': CATEGORIES.DEV,
  'stackblitz.com': CATEGORIES.DEV,
  'glitch.com': CATEGORIES.DEV,
  'codesandbox.io': CATEGORIES.DEV,
  'replit.com': CATEGORIES.DEV,
  'codepen.io': CATEGORIES.DEV,
  'jsfiddle.net': CATEGORIES.DEV,
  'jetbrains.com': CATEGORIES.DEV,
  'visualstudio.com': CATEGORIES.DEV,
  'cursor.com': CATEGORIES.DEV,
  'cursor.sh': CATEGORIES.DEV,
  'postman.com': CATEGORIES.DEV,
  'insomnia.rest': CATEGORIES.DEV,
  'swagger.io': CATEGORIES.DEV,
  'sentry.io': CATEGORIES.DEV,
  'datadoghq.com': CATEGORIES.DEV,
  'grafana.com': CATEGORIES.DEV,
  'newrelic.com': CATEGORIES.DEV,
  'expo.dev': CATEGORIES.DEV,
  'flutter.dev': CATEGORIES.DEV,
  'reactnative.dev': CATEGORIES.DEV,
  'unity.com': CATEGORIES.DEV,
  'unrealengine.com': CATEGORIES.DEV,
  'godotengine.org': CATEGORIES.DEV,
  'ngrok.io': CATEGORIES.DEV,
  'ngrok-free.app': CATEGORIES.DEV,
  'localhost': CATEGORIES.DEV,
  '127.0.0.1': CATEGORIES.DEV,
  '0.0.0.0': CATEGORIES.DEV,
  'vercel.app': CATEGORIES.DEV,
  'netlify.app': CATEGORIES.DEV,
  'pages.dev': CATEGORIES.DEV,
  'github.io': CATEGORIES.DEV,
  'goorm.io': CATEGORIES.DEV,
  'claude.com': CATEGORIES.DEV,

  // ── 문서 ──
  'developer.mozilla.org': CATEGORIES.DOCS,
  'readthedocs.io': CATEGORIES.DOCS,
  'devdocs.io': CATEGORIES.DOCS,
  'confluence.atlassian.com': CATEGORIES.DOCS,
  'docs.google.com': CATEGORIES.DOCS,
  'react.dev': CATEGORIES.DOCS,
  'nextjs.org': CATEGORIES.DOCS,
  'vuejs.org': CATEGORIES.DOCS,
  'angular.io': CATEGORIES.DOCS,
  'svelte.dev': CATEGORIES.DOCS,
  'nodejs.org': CATEGORIES.DOCS,
  'deno.com': CATEGORIES.DOCS,
  'bun.sh': CATEGORIES.DOCS,
  'typescriptlang.org': CATEGORIES.DOCS,
  'python.org': CATEGORIES.DOCS,
  'go.dev': CATEGORIES.DOCS,
  'rust-lang.org': CATEGORIES.DOCS,
  'kotlinlang.org': CATEGORIES.DOCS,
  'swift.org': CATEGORIES.DOCS,
  'tailwindcss.com': CATEGORIES.DOCS,
  'mui.com': CATEGORIES.DOCS,
  'ant.design': CATEGORIES.DOCS,
  'w3schools.com': CATEGORIES.DOCS,
  'geeksforgeeks.org': CATEGORIES.DOCS,
  'gitbook.io': CATEGORIES.DOCS,
  'docusaurus.io': CATEGORIES.DOCS,

  // ── 학습 ──
  'inflearn.com': CATEGORIES.STUDY,
  'udemy.com': CATEGORIES.STUDY,
  'coursera.org': CATEGORIES.STUDY,
  'edx.org': CATEGORIES.STUDY,
  'khanacademy.org': CATEGORIES.STUDY,
  'fastcampus.co.kr': CATEGORIES.STUDY,
  'programmers.co.kr': CATEGORIES.STUDY,
  'leetcode.com': CATEGORIES.STUDY,
  'hackerrank.com': CATEGORIES.STUDY,
  'acmicpc.net': CATEGORIES.STUDY,
  'solved.ac': CATEGORIES.STUDY,
  'codeforces.com': CATEGORIES.STUDY,
  'boj.kr': CATEGORIES.STUDY,
  'nomadcoders.co': CATEGORIES.STUDY,
  'classroom.google.com': CATEGORIES.STUDY,
  'instructure.com': CATEGORIES.STUDY,
  'kaggle.com': CATEGORIES.STUDY,
  'duolingo.com': CATEGORIES.STUDY,
  'ted.com': CATEGORIES.STUDY,
  'zep.us': CATEGORIES.STUDY,

  // ── AI 도구 ──
  'chatgpt.com': CATEGORIES.AI,
  'claude.ai': CATEGORIES.AI,
  'openai.com': CATEGORIES.AI,
  'perplexity.ai': CATEGORIES.AI,
  'gemini.google.com': CATEGORIES.AI,
  'copilot.microsoft.com': CATEGORIES.AI,
  'huggingface.co': CATEGORIES.AI,
  'midjourney.com': CATEGORIES.AI,
  'civitai.com': CATEGORIES.AI,
  'runwayml.com': CATEGORIES.AI,
  'elevenlabs.io': CATEGORIES.AI,
  'suno.com': CATEGORIES.AI,
  'poe.com': CATEGORIES.AI,
  'character.ai': CATEGORIES.AI,
  'groq.com': CATEGORIES.AI,
  'mistral.ai': CATEGORIES.AI,
  'cohere.com': CATEGORIES.AI,
  'replicate.com': CATEGORIES.AI,
  'stability.ai': CATEGORIES.AI,
  'notebooklm.google.com': CATEGORIES.AI,

  // ── 검색 ──
  'google.com': CATEGORIES.SEARCH,
  'bing.com': CATEGORIES.SEARCH,
  'duckduckgo.com': CATEGORIES.SEARCH,
  'naver.com': CATEGORIES.SEARCH,
  'daum.net': CATEGORIES.SEARCH,
  'yahoo.com': CATEGORIES.SEARCH,
  'baidu.com': CATEGORIES.SEARCH,
  'yandex.com': CATEGORIES.SEARCH,
  'ecosia.org': CATEGORIES.SEARCH,
  'kagi.com': CATEGORIES.SEARCH,
  'startpage.com': CATEGORIES.SEARCH,
  'translate.google.com': CATEGORIES.SEARCH,
  'papago.naver.com': CATEGORIES.SEARCH,
  'deepl.com': CATEGORIES.SEARCH,

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
  'linkedin.com': CATEGORIES.COMMUNITY,
  'discord.com': CATEGORIES.COMMUNITY,
  'quora.com': CATEGORIES.COMMUNITY,
  'medium.com': CATEGORIES.COMMUNITY,
  'velog.io': CATEGORIES.COMMUNITY,
  'tistory.com': CATEGORIES.COMMUNITY,
  'brunch.co.kr': CATEGORIES.COMMUNITY,
  'cafe.naver.com': CATEGORIES.COMMUNITY,
  'blog.naver.com': CATEGORIES.COMMUNITY,
  'post.naver.com': CATEGORIES.COMMUNITY,
  'ppomppu.co.kr': CATEGORIES.COMMUNITY,
  'ruliweb.com': CATEGORIES.COMMUNITY,
  'inven.co.kr': CATEGORIES.COMMUNITY,
  'theqoo.net': CATEGORIES.COMMUNITY,
  'bobaedream.co.kr': CATEGORIES.COMMUNITY,
  'arca.live': CATEGORIES.COMMUNITY,
  'dogdrip.net': CATEGORIES.COMMUNITY,
  'todayhumor.co.kr': CATEGORIES.COMMUNITY,
  '82cook.com': CATEGORIES.COMMUNITY,

  // ── 엔터테인먼트 ──
  'youtube.com': CATEGORIES.ENTERTAINMENT,
  'netflix.com': CATEGORIES.ENTERTAINMENT,
  'twitch.tv': CATEGORIES.ENTERTAINMENT,
  'watcha.com': CATEGORIES.ENTERTAINMENT,
  'wavve.com': CATEGORIES.ENTERTAINMENT,
  'tving.com': CATEGORIES.ENTERTAINMENT,
  'disneyplus.com': CATEGORIES.ENTERTAINMENT,
  'coupangplay.com': CATEGORIES.ENTERTAINMENT,
  'laftel.net': CATEGORIES.ENTERTAINMENT,
  'chzzk.naver.com': CATEGORIES.ENTERTAINMENT,
  'afreecatv.com': CATEGORIES.ENTERTAINMENT,
  'sooplive.co.kr': CATEGORIES.ENTERTAINMENT,
  'primevideo.com': CATEGORIES.ENTERTAINMENT,
  'max.com': CATEGORIES.ENTERTAINMENT,
  'tv.apple.com': CATEGORIES.ENTERTAINMENT,
  'tv.naver.com': CATEGORIES.ENTERTAINMENT,
  'tv.kakao.com': CATEGORIES.ENTERTAINMENT,
  'comic.naver.com': CATEGORIES.ENTERTAINMENT,
  'webtoon.naver.com': CATEGORIES.ENTERTAINMENT,
  'webtoons.com': CATEGORIES.ENTERTAINMENT,
  'kakaopage.com': CATEGORIES.ENTERTAINMENT,
  'ridibooks.com': CATEGORIES.ENTERTAINMENT,
  'store.steampowered.com': CATEGORIES.ENTERTAINMENT,
  'steampowered.com': CATEGORIES.ENTERTAINMENT,
  'epicgames.com': CATEGORIES.ENTERTAINMENT,
  'battle.net': CATEGORIES.ENTERTAINMENT,
  'riotgames.com': CATEGORIES.ENTERTAINMENT,
  'playstation.com': CATEGORIES.ENTERTAINMENT,
  'xbox.com': CATEGORIES.ENTERTAINMENT,
  'nintendo.com': CATEGORIES.ENTERTAINMENT,

  // ── 음악 ──
  'music.youtube.com': CATEGORIES.MUSIC,
  'spotify.com': CATEGORIES.MUSIC,
  'music.apple.com': CATEGORIES.MUSIC,
  'melon.com': CATEGORIES.MUSIC,
  'genie.co.kr': CATEGORIES.MUSIC,
  'soundcloud.com': CATEGORIES.MUSIC,
  'bugs.co.kr': CATEGORIES.MUSIC,
  'music-flo.com': CATEGORIES.MUSIC,
  'vibe.naver.com': CATEGORIES.MUSIC,
  'tidal.com': CATEGORIES.MUSIC,
  'deezer.com': CATEGORIES.MUSIC,

  // ── 쇼핑 ──
  'coupang.com': CATEGORIES.SHOPPING,
  'amazon.com': CATEGORIES.SHOPPING,
  'gmarket.co.kr': CATEGORIES.SHOPPING,
  '11st.co.kr': CATEGORIES.SHOPPING,
  'aliexpress.com': CATEGORIES.SHOPPING,
  'ssg.com': CATEGORIES.SHOPPING,
  'lotteon.com': CATEGORIES.SHOPPING,
  'auction.co.kr': CATEGORIES.SHOPPING,
  'tmon.co.kr': CATEGORIES.SHOPPING,
  'musinsa.com': CATEGORIES.SHOPPING,
  '29cm.co.kr': CATEGORIES.SHOPPING,
  'a-bly.com': CATEGORIES.SHOPPING,
  'zigzag.kr': CATEGORIES.SHOPPING,
  'kream.co.kr': CATEGORIES.SHOPPING,
  'bunjang.co.kr': CATEGORIES.SHOPPING,
  'joongna.com': CATEGORIES.SHOPPING,
  'daangn.com': CATEGORIES.SHOPPING,
  'temu.com': CATEGORIES.SHOPPING,
  'ebay.com': CATEGORIES.SHOPPING,
  'taobao.com': CATEGORIES.SHOPPING,
  'iherb.com': CATEGORIES.SHOPPING,
  'oliveyoung.co.kr': CATEGORIES.SHOPPING,
  'emart.com': CATEGORIES.SHOPPING,
  'homeplus.co.kr': CATEGORIES.SHOPPING,
  'baemin.com': CATEGORIES.SHOPPING,
  'yogiyo.co.kr': CATEGORIES.SHOPPING,
  'coupangeats.com': CATEGORIES.SHOPPING,

  // ── 생산성 ──
  'notion.so': CATEGORIES.PRODUCTIVITY,
  'notion.com': CATEGORIES.PRODUCTIVITY,
  'slack.com': CATEGORIES.PRODUCTIVITY,
  'trello.com': CATEGORIES.PRODUCTIVITY,
  'asana.com': CATEGORIES.PRODUCTIVITY,
  'linear.app': CATEGORIES.PRODUCTIVITY,
  'calendar.google.com': CATEGORIES.PRODUCTIVITY,
  'mail.google.com': CATEGORIES.PRODUCTIVITY,
  'outlook.com': CATEGORIES.PRODUCTIVITY,
  'atlassian.net': CATEGORIES.PRODUCTIVITY,
  'monday.com': CATEGORIES.PRODUCTIVITY,
  'clickup.com': CATEGORIES.PRODUCTIVITY,
  'airtable.com': CATEGORIES.PRODUCTIVITY,
  'miro.com': CATEGORIES.PRODUCTIVITY,
  'padlet.com': CATEGORIES.PRODUCTIVITY,
  'obsidian.md': CATEGORIES.PRODUCTIVITY,
  'evernote.com': CATEGORIES.PRODUCTIVITY,
  'todoist.com': CATEGORIES.PRODUCTIVITY,
  'drive.google.com': CATEGORIES.PRODUCTIVITY,
  'dropbox.com': CATEGORIES.PRODUCTIVITY,
  'onedrive.live.com': CATEGORIES.PRODUCTIVITY,
  'sheets.google.com': CATEGORIES.PRODUCTIVITY,
  'zoom.us': CATEGORIES.PRODUCTIVITY,
  'meet.google.com': CATEGORIES.PRODUCTIVITY,
  'teams.microsoft.com': CATEGORIES.PRODUCTIVITY,
  'webex.com': CATEGORIES.PRODUCTIVITY,
  'calendly.com': CATEGORIES.PRODUCTIVITY,
  'gather.town': CATEGORIES.PRODUCTIVITY,

  // ── 디자인·창작 ──
  'figma.com': CATEGORIES.DESIGN,
  'adobe.com': CATEGORIES.DESIGN,
  'canva.com': CATEGORIES.DESIGN,
  'dribbble.com': CATEGORIES.DESIGN,
  'behance.net': CATEGORIES.DESIGN,
  'sketch.com': CATEGORIES.DESIGN,
  'framer.com': CATEGORIES.DESIGN,
  'pinterest.com': CATEGORIES.DESIGN,
  'unsplash.com': CATEGORIES.DESIGN,
  'pexels.com': CATEGORIES.DESIGN,
  'freepik.com': CATEGORIES.DESIGN,
  'flaticon.com': CATEGORIES.DESIGN,
  'coolors.co': CATEGORIES.DESIGN,
  'fontawesome.com': CATEGORIES.DESIGN,
  'fonts.google.com': CATEGORIES.DESIGN,
  'noonnu.cc': CATEGORIES.DESIGN,
  'pixiv.net': CATEGORIES.DESIGN,
  'artstation.com': CATEGORIES.DESIGN,
  'blender.org': CATEGORIES.DESIGN,

  // ── 뉴스 ──
  'news.naver.com': CATEGORIES.NEWS,
  'news.daum.net': CATEGORIES.NEWS,
  'news.google.com': CATEGORIES.NEWS,
  'nytimes.com': CATEGORIES.NEWS,
  'bbc.com': CATEGORIES.NEWS,
  'cnn.com': CATEGORIES.NEWS,
  'reuters.com': CATEGORIES.NEWS,
  'bloomberg.com': CATEGORIES.NEWS,
  'wsj.com': CATEGORIES.NEWS,
  'theverge.com': CATEGORIES.NEWS,
  'techcrunch.com': CATEGORIES.NEWS,
  'arstechnica.com': CATEGORIES.NEWS,
  'hani.co.kr': CATEGORIES.NEWS,
  'chosun.com': CATEGORIES.NEWS,
  'joongang.co.kr': CATEGORIES.NEWS,
  'donga.com': CATEGORIES.NEWS,
  'khan.co.kr': CATEGORIES.NEWS,
  'mk.co.kr': CATEGORIES.NEWS,
  'hankyung.com': CATEGORIES.NEWS,
  'yna.co.kr': CATEGORIES.NEWS,
  'ytn.co.kr': CATEGORIES.NEWS,
  'zdnet.co.kr': CATEGORIES.NEWS,
  'bloter.net': CATEGORIES.NEWS,
  'etnews.com': CATEGORIES.NEWS,
  'news.hada.io': CATEGORIES.NEWS,

  // ── 금융 ──
  'toss.im': CATEGORIES.FINANCE,
  'kbstar.com': CATEGORIES.FINANCE,
  'finance.naver.com': CATEGORIES.FINANCE,
  'investing.com': CATEGORIES.FINANCE,
  'tradingview.com': CATEGORIES.FINANCE,
  'coinmarketcap.com': CATEGORIES.FINANCE,
  'upbit.com': CATEGORIES.FINANCE,
  'bithumb.com': CATEGORIES.FINANCE,
  'binance.com': CATEGORIES.FINANCE,
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
  // 합리적 추가 — 같은 성격(검색/AI 도구/번역)
  'bing.com',
  'duckduckgo.com',
  'perplexity.ai',
  'openai.com',
  'gemini.google.com',
  // 번역기도 곁다리다. 문서를 읽다 한 줄 돌려보는 것이라 맥락이 바뀐 게 아니다.
  'translate.google.com',
  'papago.naver.com',
  'deepl.com',
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
 * 수집 자체를 막는 blocklist (계획서 11장 "프라이버시 + 비용").
 * 이 목록에 걸리면 content script 는 아무 신호도 보내지 않는다 — 활동
 * 카운트(scrolls/clicks/keys)조차 전송하지 않는다(도메인 자체를 기록하지
 * 않기 위함). sw.ts 는 tabs 이벤트로 들어오는 도메인에 대해 한 번 더
 * 방어적으로 이 목록을 확인한다.
 *
 * ⚠️ content.ts 는 import 를 쓸 수 없는 classic script 라 이 목록을 자급자족
 * 복제해서 갖고 있다(content.ts 상단 주석 참고). 이 배열을 수정하면 반드시
 * content.ts 의 사본도 함께 갱신할 것.
 */
export const BLOCKED_DOMAINS: readonly string[] = [
  // ── 은행 (한국 주요 은행) ──
  'kbstar.com', // KB국민은행
  'shinhan.com', // 신한은행
  'wooribank.com', // 우리은행
  'nonghyup.com', // NH농협은행
  'nhbank.com', // NH농협은행(별칭 도메인)
  'hanabank.com', // 하나은행
  'ibk.co.kr', // IBK기업은행
  'kakaobank.com', // 카카오뱅크
  'tossbank.com', // 토스뱅크
  'sc.co.kr', // SC제일은행

  // ── 증권 ──
  'kiwoom.com', // 키움증권
  'miraeasset.com', // 미래에셋증권
  'koreainvestment.com', // 한국투자증권
  'samsungpop.com', // 삼성증권

  // ── 의료/병원 예약 ──
  'goodoc.co.kr', // 굿닥(병원 예약)
  'nhis.or.kr', // 국민건강보험공단
  'hidoc.co.kr', // 하이닥(병원/건강 정보)

  // ── 정부 민원 ──
  'gov.kr', // 정부24 등 정부 포털
  'hometax.go.kr', // 국세청 홈택스

  // ── 성인 사이트 (대표 도메인) ──
  'pornhub.com',
  'xvideos.com',

  // ── 메일/DM (사적 대화·메일 내용 유출 방지) ──
  'mail.google.com', // Gmail
  'mail.naver.com', // 네이버 메일
  'web.whatsapp.com', // WhatsApp 웹
  'web.telegram.org', // Telegram 웹
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

/** hostname 이 BLOCKED_DOMAINS 에 걸리는지(서브도메인 포함) longest-suffix 로 확인한다. */
export function isBlockedDomain(hostname: string): boolean {
  return isDomainInSet(hostname, BLOCKED_DOMAINS);
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
