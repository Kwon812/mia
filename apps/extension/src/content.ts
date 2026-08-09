// classic script 로 주입된다 (manifest content_scripts, "type" module 아님).
// 반드시 import 문이 하나도 없어야 한다 — 모든 로직은 이 파일 안에서 자급자족한다.

(() => {
  // ── blocklist (계획서 11장 "프라이버시 + 비용") ──
  // ⚠️ session/categories.ts 의 BLOCKED_DOMAINS 와 동일해야 한다. 이 파일은
  // import 를 쓸 수 없는 classic script라 자급자족 복제한다 — 저 목록을
  // 수정하면 반드시 이 배열도 함께 갱신할 것 (이중 관리, 알려진 한계).
  const BLOCKED_DOMAINS: readonly string[] = [
    // ── 은행 (한국 주요 은행) ──
    'kbstar.com',
    'shinhan.com',
    'wooribank.com',
    'nonghyup.com',
    'nhbank.com',
    'hanabank.com',
    'ibk.co.kr',
    'kakaobank.com',
    'tossbank.com',
    'sc.co.kr',
    // ── 증권 ──
    'kiwoom.com',
    'miraeasset.com',
    'koreainvestment.com',
    'samsungpop.com',
    // ── 의료/병원 예약 ──
    'goodoc.co.kr',
    'nhis.or.kr',
    'hidoc.co.kr',
    // ── 정부 민원 ──
    'gov.kr',
    'hometax.go.kr',
    // ── 성인 사이트 (대표 도메인) ──
    'pornhub.com',
    'xvideos.com',
    // ── 메일/DM ──
    'mail.google.com',
    'mail.naver.com',
    'web.whatsapp.com',
    'web.telegram.org',
  ];

  // 검색 엔진/서비스별 검색어 쿼리 파라미터 화이트리스트.
  // "무엇을 검색했는지"는 오직 이 표에 있는 도메인의, 이 파라미터에서만 읽는다
  // (DOM 입력 필드 값을 읽지 않는다 — 키로거 오인 방지 + 프라이버시).
  const SEARCH_QUERY_PARAMS: Record<string, string> = {
    'google.com': 'q',
    'bing.com': 'q',
    'duckduckgo.com': 'q',
    'naver.com': 'query',
    'youtube.com': 'search_query',
    'github.com': 'q',
    'stackoverflow.com': 'q',
    'npmjs.com': 'q',
    'reddit.com': 'q',
    'amazon.com': 'k',
    'coupang.com': 'q',
    'daum.net': 'q',
    'yahoo.com': 'p',
    'baidu.com': 'wd',
    'ecosia.org': 'q',
  };

  // title/path/query 절단 길이 — LLM 프롬프트 토큰 비용 상한 (session/builder.ts
  // 의 MAX_TITLE_LEN 과 동일한 값을 이 파일에서도 자급자족으로 쓴다).
  const MAX_TEXT_LEN = 200;

  // hostname 이 table(또는 set)에 longest-suffix 로 매칭되는지/값을 찾는다.
  // 예: 'music.youtube.com' → 'youtube.com' 라벨부터 왼쪽으로 하나씩 잘라가며 검사.
  function matchSuffix(hostname: string, table: Record<string, string>): string | undefined {
    const labels = hostname.toLowerCase().split('.');
    for (let i = 0; i < labels.length; i++) {
      const suffix = labels.slice(i).join('.');
      if (table[suffix] !== undefined) return table[suffix];
    }
    return undefined;
  }

  function isInSet(hostname: string, set: readonly string[]): boolean {
    const labels = hostname.toLowerCase().split('.');
    for (let i = 0; i < labels.length; i++) {
      const suffix = labels.slice(i).join('.');
      if (set.includes(suffix)) return true;
    }
    return false;
  }

  // 매칭용(포트 없음)과 기록용(포트 있음)을 나눈다.
  // 차단·검색어 사전은 hostname 으로 조회해야 `example.com:8443` 같은 것이
  // 안 빗나가고, 기록에는 포트가 있어야 localhost 의 여러 프로젝트가 갈린다.
  const hostname = location.hostname;
  const host = location.host;

  // blocked 도메인이면 리스너조차 등록하지 않고 즉시 종료 — 활동 카운트를
  // 포함해 그 어떤 신호도 만들지 않는다 (도메인 자체를 기록하지 않기 위함).
  if (isInSet(hostname, BLOCKED_DOMAINS)) return;

  // 검색어 파라미터 이름을 이번 페이지 hostname 기준으로 1회만 찾아둔다.
  // (SPA 로 다른 오리진으로 넘어가는 일은 없으므로 — 아래 SPA 주석 참고 —
  // 매 틱 다시 찾을 필요는 없지만, 실제 값(location.search)은 매 틱 새로 읽는다.)
  const searchParamName = matchSuffix(hostname, SEARCH_QUERY_PARAMS);

  function extractSearchQuery(): string | undefined {
    if (!searchParamName) return undefined;
    const value = new URLSearchParams(location.search).get(searchParamName);
    if (!value) return undefined;
    return value.slice(0, MAX_TEXT_LEN);
  }

  let scrolls = 0;
  let clicks = 0;
  let keys = 0;

  document.addEventListener('scroll', () => scrolls++, { passive: true });
  document.addEventListener('click', () => clicks++, { passive: true });
  // 키 입력 "횟수"만 센다 — 어떤 키인지(내용)는 절대 읽지 않는다 (키로거 금지,
  // 스토어 심사·프라이버시상 필수). 입력 필드 값도 별도로 읽지 않는다.
  document.addEventListener('keydown', () => keys++, { passive: true });

  // content script 는 페이지 컨텍스트에서 계속 살아있으므로 setInterval 사용이
  // 안전하다 (서비스 워커에서는 절대 금지 — chrome.alarms 사용).
  // 보이는 탭에서 미디어(video/audio)가 실제 재생 중인지.
  // 입력이 0이어도 강의·영상 시청을 무활동(idle)으로 오인하지 않기 위한 신호다.
  // 비활성 탭이면 false → 백그라운드 음악은 신호를 보내지 않는다 (예외 C 유지).
  // 한계: iframe 속 플레이어는 top frame 에서 안 보인다 (유튜브 본편은 잡힌다).
  const isMediaPlaying = () => {
    if (document.visibilityState !== 'visible') return false;
    const media = document.querySelectorAll<HTMLMediaElement>('video, audio');
    for (let i = 0; i < media.length; i++) {
      const m = media[i];
      if (!m.paused && !m.ended && m.readyState > 2) return true;
    }
    return false;
  };

  setInterval(() => {
    const playing = isMediaPlaying();
    if (scrolls === 0 && clicks === 0 && keys === 0 && !playing) return;

    try {
      // SPA URL 변경 감지: 별도 리스너(popstate/history patch 등) 없이 10초
      // 틱마다 location.pathname/search, document.title 의 "현재값"을 그대로
      // 읽는다 — 한 틱 안에서 여러 번 이동해도 마지막 상태만 반영되는 정도의
      // 정밀도로 충분하다는 전제(계획서 11장 실데이터 튜닝 대상).
      chrome.runtime.sendMessage({
        type: 'ACTIVITY',
        scrolls,
        clicks,
        keys,
        playing,
        url: host,
        // 예외 C(백그라운드 재생) 판정용: 이 탭이 지금 보이는 탭인지.
        // 백그라운드에서 음악만 틀어놓고 다른 탭에서 작업 중이면 false가 된다.
        visible: document.visibilityState === 'visible',
        // ── 의도 컨텍스트 (계획서 확장: "무엇을 검색·열람했는지") ──
        // title/path 는 매 틱 현재값. query 는 화이트리스트 파라미터가 있을
        // 때만 포함한다. 입력 필드 값·페이지 본문·키 입력 내용은 절대 읽지 않는다.
        title: document.title.slice(0, MAX_TEXT_LEN),
        path: location.pathname.slice(0, MAX_TEXT_LEN),
        query: extractSearchQuery(),
      });
    } catch {
      // chrome.runtime 부재 또는 확장 컨텍스트 무효화(reload 등) 시 무시한다.
    }

    scrolls = 0;
    clicks = 0;
    keys = 0;
  }, 10000);
})();
