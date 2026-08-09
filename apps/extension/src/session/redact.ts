// ============================================================
// 리댁션 — "이건 애초에 안 본 것으로 한다"
//
// categories.ts 의 BLOCKED_DOMAINS 와 목적은 같고 입도만 다르다. 저쪽은
// 도메인 통째로 버리고, 여기는 **허용된 도메인 안에서 새어나오는 비밀 문자열**만
// 지운다. 실제로 새어나온 적이 있다 — GitHub 시크릿 편집 URL 이
// `/settings/secrets/actions/GOORM_SID` 꼴이라 시크릿 **이름**이 경로에 그대로
// 박히고, github.com 은 blocked 가 아니라 그게 path 로 수집돼 경험 detail 을
// 거쳐 일기까지 올라갔다.
//
// ⚠️ 이건 압축(MAX_QUERIES 같은 비용 상한)이 아니라 **정책**이다. 둘을 섞지 않는다.
//   - 압축: compressed_log 에만 적용. 모델에게 다 줄 필요가 없어서 자르는 것.
//   - 리댁션(여기): 원본에도 적용. 애초에 남기면 안 되는 것.
// 원본(rawArchive)은 무손실이 목적이라 압축을 걸지 않지만, 리댁션은 **원본에도
// 건다.** 나중에 지우는 것보다 안 남기는 게 압도적으로 싸고, 원본은 한 번
// 새면 회수 경로가 없다.
//
// 적용 지점은 sw.ts 의 db.rawEvents.add 직전 한 곳이다. content.ts 에 복제하지
// 않는다 — content script → 서비스 워커 사이에는 저장이 없어(메시지 전달뿐)
// 저장 직전에 걸면 "수집 단계 차단"이 그대로 성립하고, BLOCKED_DOMAINS 처럼
// 목록을 이중 관리하는 부채를 늘리지 않는다.
// ============================================================

/** 지워진 자리에 남기는 표식. 값이 있었다는 사실 자체는 남긴다 —
 *  세그먼트를 통째로 없애면 경로 구조가 달라져 나중에 분석이 어긋난다. */
export const REDACTED = '[redacted]';

/**
 * 경로 세그먼트 중 하나라도 이 이름이면, 그 경로의 **마지막 세그먼트**를 지운다.
 *
 * 비밀의 이름은 거의 항상 잎(leaf)에 온다:
 *   /Kwon812/me_ai/settings/secrets/actions/GOORM_SID
 *                           ^^^^^^^                    ← 여기 걸리면
 *                                          ^^^^^^^^^   ← 여기를 지운다
 *
 * 뒤쪽 전부가 아니라 마지막 하나만 지우는 이유: 원본의 목적이 충실도다.
 * `actions` 처럼 무해한 중간 세그먼트까지 날리면 리댁션이 압축으로 변질된다.
 *
 * 목록에 'key'/'keys' 는 일부러 뺐다. `/docs/keys/getting-started` 같은 평범한
 * 문서 경로가 대량으로 걸려 과잉 삭제가 된다. 여기 있는 것들은 그 자체로
 * 비밀 저장소를 뜻하는 말들만 남겼다.
 */
const SECRET_PARENTS: readonly string[] = [
  'secret',
  'secrets',
  'variables',
  'credential',
  'credentials',
  'token',
  'tokens',
  'apikey',
  'apikeys',
  'api-keys',
  'api_keys',
  'password',
  'passwords',
];

/** JWT 3분절. 길이까지 봐야 `a.b.c` 같은 평범한 파일명이 안 걸린다. */
const JWT_RE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** 이메일 — 남의 주소가 제목·검색어에 섞여 들어온다. */
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** 12자리 이상 연속 숫자 — 계좌·주문·전화·주민번호 계열. 연도(4)·타임스탬프(10)는 안 걸린다. */
const LONG_DIGITS_RE = /\b\d{12,}\b/g;

/**
 * 고엔트로피 토큰처럼 보이는가.
 *
 * 하이픈·언더스코어가 있으면 대개 사람이 읽는 슬러그(`getting-started-with-next`)라
 * 제외한다. 진짜 토큰은 보통 영숫자만으로 길게 이어진다. 이 조건이 없으면
 * 긴 블로그 슬러그가 전부 지워져 원본이 걸레가 된다.
 */
function looksLikeToken(s: string): boolean {
  if (s.length < 20) return false;
  if (!/^[A-Za-z0-9]+$/.test(s)) return false;
  return /\d/.test(s) && /[A-Za-z]/.test(s);
}

/** 12자리 이상 순수 숫자 — 계좌·주문·전화번호 계열.
 *
 *  looksLikeToken 은 영숫자 **혼합**만 잡아서 순수 숫자를 통과시킨다. 경로에도
 *  `/orders/123456789012` 처럼 그대로 박히므로 같은 기준을 경로 세그먼트에도
 *  적용한다. 12자리 하한이라 이슈 번호(#12345)·연도·유닉스 타임스탬프(10자리)는
 *  안 걸린다. */
function looksLikeLongNumber(s: string): boolean {
  return /^\d{12,}$/.test(s);
}

/**
 * URL 경로 리댁션. 앞뒤 슬래시와 세그먼트 구조는 그대로 둔다.
 *
 * 두 규칙이 독립적으로 걸린다:
 *   1) SECRET_PARENTS 가 경로 어딘가에 있으면 → 마지막 세그먼트를 지운다
 *   2) 세그먼트 자체가 토큰꼴이면 → 부모와 무관하게 지운다 (세션ID가 박힌 경로 등)
 */
export function redactPath(path: string): string {
  if (!path || path === '/') return path;

  const trailingSlash = path.length > 1 && path.endsWith('/');
  const segments = path.split('/');

  // 마지막 '비어있지 않은' 세그먼트의 위치. 'a/b/' 처럼 슬래시로 끝나면
  // split 결과의 꼬리가 '' 이라 그걸 잎으로 착각하면 아무것도 못 지운다.
  let leaf = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== '') {
      leaf = i;
      break;
    }
  }
  if (leaf < 0) return path;

  const hasSecretParent = segments.some(
    (s, i) => i < leaf && SECRET_PARENTS.includes(s.toLowerCase()),
  );

  const out = segments.map((s, i) => {
    if (s === '') return s;
    if (looksLikeToken(s) || looksLikeLongNumber(s)) return REDACTED;
    if (hasSecretParent && i === leaf) return REDACTED;
    return s;
  });

  const joined = out.join('/');
  // split/join 은 꼬리 슬래시를 보존하지만, 방어적으로 한 번 더 맞춘다.
  return trailingSlash && !joined.endsWith('/') ? `${joined}/` : joined;
}

/**
 * 자유 텍스트(페이지 제목·검색어) 리댁션.
 *
 * 경로와 달리 구조가 없어 세그먼트 규칙을 쓸 수 없다. 형태만으로 확실한 것
 * — JWT·이메일·긴 숫자열·토큰꼴 단어 — 만 지운다. 일반 단어는 건드리지 않는다.
 */
export function redactText(text: string): string {
  if (!text) return text;

  let out = text.replace(JWT_RE, REDACTED).replace(EMAIL_RE, REDACTED).replace(LONG_DIGITS_RE, REDACTED);

  // 남은 토큰꼴 낱말. 위 정규식이 이미 REDACTED 로 바꾼 자리는 대괄호가 있어
  // looksLikeToken 의 영숫자-only 조건에 걸리지 않는다.
  out = out
    .split(' ')
    .map((word) => (looksLikeToken(word) ? REDACTED : word))
    .join(' ');

  return out;
}

/**
 * rawEvent.payload 리댁션 — 저장 직전에 한 번 통과시킨다.
 *
 * title/path/query 세 필드만 자유 문자열이다. 나머지(scrolls·clicks·keys·
 * visible·playing·tabId 등)는 숫자·불리언이라 손댈 게 없다.
 * 원본 payload 를 변형하지 않고 새 객체를 돌려준다.
 */
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  if (typeof out.title === 'string') out.title = redactText(out.title);
  if (typeof out.path === 'string') out.path = redactPath(out.path);
  if (typeof out.query === 'string') out.query = redactText(out.query);
  // url 은 tab_updated 가 통째로 싣는다 — 경로가 그대로 들어있어 같이 지운다.
  if (typeof out.url === 'string') out.url = redactUrl(out.url);
  // 조작 라벨 — 버튼 텍스트에 토큰·시크릿 이름이 박히는 경우가 있다
  // (GitHub 시크릿 편집 화면의 삭제 버튼이 시크릿 이름을 그대로 단다).
  if (Array.isArray(out.actions)) {
    out.actions = out.actions.map((a) => {
      if (typeof a !== 'object' || a === null) return a;
      const o = { ...(a as Record<string, unknown>) };
      if (typeof o.label === 'string') o.label = redactText(o.label);
      if (typeof o.sel === 'string') o.sel = redactText(o.sel);
      return o;
    });
  }
  return out;
}

/** 절대 URL 의 경로 부분만 리댁션한다. 파싱 실패하면 문자열 규칙으로 떨어뜨린다. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = redactPath(u.pathname);
    // 쿼리스트링은 통째로 버린다. 토큰·이메일·주문번호가 가장 많이 박히는
    // 자리인데 파라미터 이름이 제각각이라 화이트리스트가 불가능하다.
    // 검색어는 content.ts 가 화이트리스트(SEARCH_QUERY_PARAMS)로 이미 뽑아
    // payload.query 로 따로 싣고 있어, 여기서 버려도 잃는 게 없다.
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return redactText(url);
  }
}
