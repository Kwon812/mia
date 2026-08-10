// ============================================================
// 페이지가 부르는 API 를 엿듣는다. **페이지 컨텍스트에서 돈다** (world: MAIN).
//
// 왜 이게 필요한가. 화면에서 값을 긁는 것은 무르다 — 셀렉터가 깨지고, 배경
// 탭은 렌더링이 억제되고, 값은 늦게 채워진다. API 로 읽으면 그 전부가
// 사라지는데, 문제는 **어느 API 의 어느 필드인지 알 길이 없다**는 것이었다.
//
// 답은 엿듣기다. 사람이 그 화면을 보는 순간 페이지가 이미 자기 API 를
// 호출한다. 그 요청과 응답을 잡아두면, 사람이 화면에서 "$1.88" 을 집었을 때
// 잡아둔 응답에서 1.88 을 찾아 경로를 알아낼 수 있다.
//
//   → 엔드포인트를 미리 코드에 박아둘 필요가 없다.
//   → 사람이 한 번 본 화면은 확장이 아는 화면이 된다.
//   → 페이지가 세션 쿠키로 부르므로 API 키도 대개 필요 없다.
//
// 왜 격리된 세계(content.ts)가 아니라 여기인가. content script 는 페이지와
// 다른 세계에서 돌아서 페이지의 window.fetch 를 못 건드린다. 가로채려면
// 페이지 자신의 전역을 감싸야 하고, 그건 world: 'MAIN' 뿐이다.
//
// 무엇을 안 하는가: 요청을 막거나 바꾸지 않는다. 지나가는 것을 그대로 보고
// 사본만 남긴다 — 관측이 사용을 방해하면 안 된다.
// ============================================================

(() => {
  /** 들고 있을 응답 수. 값 하나 찾으려고 화면 전체의 호출을 훑는다. */
  const MAX_KEEP = 60;
  /**
   * **한 경로가 몇 개까지 차지할 수 있나.**
   *
   * 쿼리만 바꿔 같은 API 를 수십 번 부르는 대시보드가 많다 — OpenAI 는
   * usage 를 기간별로 나눠 부른다. 그걸 그대로 담으면 그 하나가 상한을 다
   * 먹고 다른 API 가 밀려난다. 실측에서 열두 개를 잡았는데 대부분 같은
   * 경로였고, 정작 값이 있던 credit_grants 는 밀려날 뻔했다.
   *
   * 하나만 남기지 않는 이유: 기간별 호출은 서로 다른 데이터를 준다.
   * 화면이 그걸 합쳐 보여주면 여러 개가 다 있어야 합이 맞는다.
   */
  const MAX_PER_PATH = 6;
  /** 이보다 큰 응답은 안 든다. 대시보드 하나가 메모리를 다 먹으면 안 된다. */
  const MAX_BYTES = 512 * 1024;
  /** 이보다 오래된 것은 버린다. 화면을 옮겼는데 옛 응답에서 값을 찾으면
   *  실행할 때 엉뚱한 곳을 부르게 된다. */
  const MAX_AGE_MS = 10 * 60 * 1000;

  type Caught = {
    url: string;
    method: string;
    /** POST 본문. GraphQL 처럼 경로가 하나뿐인 곳은 이게 있어야 재현된다. */
    body?: string;
    /**
     * 요청에 붙은 헤더. **이게 없으면 재현이 안 된다.**
     *
     * 쿠키만으로 되는 줄 알았는데 아니었다. 대시보드는 세션 토큰을
     * Authorization 헤더로 보내는 곳이 많고(OpenAI 가 그렇다), 조직 id 나
     * CSRF 토큰을 커스텀 헤더로 얹기도 한다. 집을 때는 페이지가 부른 응답의
     * 사본을 봐서 성공하는데, 실행할 때는 확장이 직접 불러 401 이 났다 —
     * 로그인은 멀쩡한데.
     */
    headers?: Record<string, string>;
    /**
     * 자격을 어떻게 실었나 (include·omit·same-origin).
     *
     * 이걸 안 맞추면 크로스 오리진에서 브라우저가 아예 막는다. Authorization
     * 헤더로 인증하는 API 는 서버가 Access-Control-Allow-Origin: * 를 주는
     * 것이 보통이고, 그때 credentials: include 는 정책 위반이다 — 실측에서
     * "Failed to fetch" 가 그렇게 났다. 원래 어떻게 불렀는지를 그대로 쓴다.
     */
    creds?: RequestCredentials;
    /** 파싱된 응답. 객체가 아니면 안 든다 — 값 찾기는 JSON 에서만 한다. */
    json: unknown;
    at: number;
  };

  const caught: Caught[] = [];

  /** 쿼리를 뗀 경로. 같은 API 인지 가르는 열쇠다. */
  function pathOf(url: string): string {
    try {
      const u = new URL(url);
      return `${u.host}${u.pathname}`;
    } catch {
      return url.split('?')[0].slice(0, 120);
    }
  }

  function keep(c: Caught): void {
    const now = Date.now();
    // 오래된 것부터 버린다.
    for (let i = caught.length - 1; i >= 0; i--) {
      if (now - caught[i].at > MAX_AGE_MS) caught.splice(i, 1);
    }
    // 같은 요청을 다시 불렀으면 새 것만 남긴다 — 값이 갱신됐을 테니.
    const same = caught.findIndex((x) => x.url === c.url && x.method === c.method);
    if (same >= 0) caught.splice(same, 1);
    caught.unshift(c);

    // **경로별로 상한을 둔다.** 한 API 가 자리를 다 먹으면 다른 API 가
    // 밀려나고, 그러면 정작 값이 있는 곳을 못 본다.
    const p = pathOf(c.url);
    let n = 0;
    for (let i = 0; i < caught.length; i++) {
      if (pathOf(caught[i].url) !== p) continue;
      n += 1;
      if (n > MAX_PER_PATH) caught.splice(i--, 1);
    }

    if (caught.length > MAX_KEEP) caught.length = MAX_KEEP;
  }

  /**
   * 재현에 필요한 헤더만 고른다.
   *
   * 전부 들고 가면 안 된다. 브라우저가 스스로 채우는 것(Host·Origin·
   * Content-Length)을 우리가 다시 얹으면 오히려 거부당하고, User-Agent 나
   * Accept-Encoding 은 붙일 이유가 없다.
   *
   * 인증에 쓰이는 것과 그 서비스가 정한 커스텀 헤더(x- 로 시작하거나
   * 서비스 이름이 붙은 것)만 남긴다.
   */
  const KEEP_HEADER = /^(authorization|openai-|anthropic-|x-|.*-token$|.*-key$|content-type)/i;
  const DROP_HEADER = /^(host|origin|referer|cookie|content-length|user-agent|accept-encoding|connection|sec-)/i;

  function pickHeaders(h: HeadersInit | undefined, req?: Request): Record<string, string> {
    const out: Record<string, string> = {};
    const add = (k: string, v: string) => {
      const key = k.toLowerCase();
      if (DROP_HEADER.test(key) || !KEEP_HEADER.test(key)) return;
      if (v && v.length < 4000) out[k] = v;
    };
    try {
      if (req) req.headers.forEach((v, k) => add(k, v));
      if (h instanceof Headers) h.forEach((v, k) => add(k, v));
      else if (Array.isArray(h)) h.forEach(([k, v]) => add(k, v));
      else if (h && typeof h === 'object') {
        for (const [k, v] of Object.entries(h)) add(k, String(v));
      }
    } catch {
      // 헤더를 못 읽어도 나머지는 그대로 간다.
    }
    return out;
  }

  /** JSON 으로 읽히는 것만 든다. HTML·이미지는 값 찾기에 쓸 데가 없다. */
  function tryKeep(
    url: string,
    method: string,
    body: string | undefined,
    text: string,
    headers?: Record<string, string>,
    creds?: RequestCredentials,
  ): void {
    if (!text || text.length > MAX_BYTES) return;
    const head = text.slice(0, 200).trimStart();
    if (!head.startsWith('{') && !head.startsWith('[')) return;
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object') {
        keep({ url, method, body, json, headers, creds, at: Date.now() });
      }
    } catch {
      // JSON 이 아니면 그만이다.
    }
  }

  // ── fetch ────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const res = await origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;
      const init = args[1];
      const method = (init?.method ?? (req instanceof Request ? req.method : 'GET')).toUpperCase();
      const body = typeof init?.body === 'string' ? init.body.slice(0, 4000) : undefined;
      // **복제해서 읽는다.** 원본 스트림을 읽으면 페이지가 못 읽는다 —
      // 엿듣기가 페이지를 망가뜨리면 안 된다.
      const headers = pickHeaders(init?.headers, req instanceof Request ? req : undefined);
      const creds =
        init?.credentials ?? (req instanceof Request ? req.credentials : undefined);
      res
        .clone()
        .text()
        .then((t) => tryKeep(new URL(url, location.href).href, method, body, t, headers, creds))
        .catch(() => undefined);
    } catch {
      // 무슨 일이 있어도 원래 응답은 그대로 돌려준다.
    }
    return res;
  };

  // ── XMLHttpRequest ───────────────────────────────────────
  // 요즘 앱은 대개 fetch 를 쓰지만, 오래된 대시보드는 아직 XHR 이다.
  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;
  type Tagged = XMLHttpRequest & {
    __naUrl?: string;
    __naMethod?: string;
    __naBody?: string;
    __naHeaders?: Record<string, string>;
  };

  // XHR 은 setRequestHeader 로 하나씩 얹는다. 그걸 가로채야 인증 헤더를 안다.
  const OrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (this: Tagged, name: string, value: string) {
    const key = String(name).toLowerCase();
    if (!DROP_HEADER.test(key) && KEEP_HEADER.test(key)) {
      this.__naHeaders = { ...(this.__naHeaders ?? {}), [name]: String(value) };
    }
    // eslint-disable-next-line prefer-rest-params
    return OrigSetHeader.apply(this, arguments as never);
  } as typeof XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (this: Tagged, method: string, url: string, ...rest: unknown[]) {
    this.__naMethod = String(method).toUpperCase();
    try {
      this.__naUrl = new URL(String(url), location.href).href;
    } catch {
      this.__naUrl = String(url);
    }
    // eslint-disable-next-line prefer-rest-params
    return OrigOpen.apply(this, arguments as never);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (this: Tagged, body?: Document | XMLHttpRequestBodyInit | null) {
    if (typeof body === 'string') this.__naBody = body.slice(0, 4000);
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          tryKeep(
            this.__naUrl ?? '',
            this.__naMethod ?? 'GET',
            this.__naBody,
            this.responseText,
            this.__naHeaders,
          );
        }
      } catch {
        // 무시 — 엿듣기 실패가 페이지에 영향을 주면 안 된다.
      }
    });
    // eslint-disable-next-line prefer-rest-params
    return OrigSend.apply(this, arguments as never);
  } as typeof XMLHttpRequest.prototype.send;

  // ── 격리된 세계와의 다리 ─────────────────────────────────
  //
  // 여기는 페이지 컨텍스트라 chrome.runtime 에 못 닿는다. content.ts 가
  // 물으면 postMessage 로 답한다.
  window.addEventListener('message', (e) => {
    // 디버그: 지금 무엇을 잡고 있는지 본다. 콘솔에서
    //   window.postMessage({__naNet:'peek'}, '*')
    // 하면 잡은 경로들이 찍힌다 — 엿듣기가 붙었는지, 무엇을 보고 있는지를
    // 사람이 직접 확인할 수 있어야 한다.
    if (e.source === window && e.data?.__naNet === 'peek') {
      const by: Record<string, number> = {};
      for (const c of caught) by[pathOf(c.url)] = (by[pathOf(c.url)] ?? 0) + 1;
      console.log(`[NA] 엿들은 것 ${caught.length}개 · 경로 ${Object.keys(by).length}종`, by);
      return;
    }
    /**
     * **엿들은 것에서 바로 읽는다. 다시 부르지 않는다.**
     *
     * 재현은 벽에 부딪혔다. 헤더를 그대로 실어 보냈는데 서버가
     * "Missing bearer authentication" 이라고 답했다 — 크로스 오리진에서
     * 브라우저가 Authorization 을 떼어낸 것이다. 우리가 어떻게 해도 페이지가
     * 부르는 것과 같아지지 않는다.
     *
     * 그런데 다시 부를 이유가 없다. **페이지를 그 화면에 두면 페이지가
     * 스스로 부른다.** 실행할 때 어차피 그 사이트에 가 있으므로, 로드되면서
     * 부른 응답이 이미 여기 있다. 자격 문제가 통째로 사라진다.
     *
     * 신선한 것만 준다. 오래된 응답을 주면 어제 값을 오늘 값으로 보게 된다.
     */
    if (e.source === window && e.data?.__naNet === 'read') {
      const { id, url, maxAgeMs } = e.data as { id: string; url: string; maxAgeMs?: number };
      const want = pathOf(url);
      const fresh = caught.find(
        (c) => pathOf(c.url) === want && Date.now() - c.at <= (maxAgeMs ?? 120000),
      );
      window.postMessage(
        fresh
          ? { __naNet: 'read-ans', id, ok: true, json: fresh.json, age: Date.now() - fresh.at }
          : { __naNet: 'read-ans', id, ok: false },
        '*',
      );
      return;
    }

    // **그 페이지가 스스로 부른다.**
    //
    // 확장이 요청을 재구성하면 아무리 헤더를 옮겨도 페이지와 똑같아지지
    // 않는다 — Origin·Referer·쿠키 조합이 다르고, 브라우저가 자동으로
    // 채우는 것들이 어긋난다. 실측에서 401 과 400 이 그렇게 났다.
    //
    // 여기서 부르면 그 전부가 맞는다. 페이지가 자기 API 를 부르는 것과
    // 글자 그대로 같은 일이다.
    if (e.source === window && e.data?.__naNet === 'refetch') {
      const { id, url, method, body, headers } = e.data as {
        id: string;
        url: string;
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      };

      // **원래 어떻게 불렀는지를 그대로 쓴다.**
      //
      // 자격과 헤더를 우리가 정하면 어긋난다 — Authorization 으로 인증하는
      // API 에 credentials: include 를 붙이면 브라우저가 아예 막고
      // ("Failed to fetch"), 쿠키로 인증하는 곳에 헤더만 붙이면 401 이다.
      // 같은 경로를 엿들은 적이 있으면 그때 본 그대로 부른다.
      const past = caught.find((c) => pathOf(c.url) === pathOf(url));
      const useHeaders = headers ?? past?.headers ?? {};
      const useCreds = past?.creds ?? 'include';

      // **무엇을 보내는지 찍는다.**
      //
      // 여기까지 오는 동안 원인을 세 번 잘못 짚었다. 자격이 어떻게 실리는지가
      // 눈에 안 보이면 다음에도 같은 일이 반복된다 — 401 이 났을 때 헤더가
      // 없었던 건지, 엿들은 기록을 못 찾은 건지, 방식이 안 맞은 건지가
      // 이 한 줄로 갈린다.
      console.log(
        `[NA] 부른다 ${pathOf(url)}`,
        `자격=${useCreds}`,
        `헤더=[${Object.keys(useHeaders).join(', ') || '없음'}]`,
        past ? '(엿들은 기록 있음)' : '(기록 없음 — 짐작으로 부른다)',
      );

      // 원본 fetch 를 쓴다. 감싼 쪽을 부르면 이 호출까지 엿듣게 되어,
      // 재현한 응답이 다시 후보로 쌓인다.
      const once = (creds: RequestCredentials) =>
        origFetch(url, {
          method: method ?? 'GET',
          credentials: creds,
          headers: { Accept: 'application/json', ...useHeaders },
          body: body ?? undefined,
        });

      const answer = (o: { ok: boolean; status: number; text?: string; error?: string }) =>
        window.postMessage({ __naNet: 'refetch-ans', id, ...o }, '*');

      once(useCreds)
        .catch(() =>
          // 자격 방식이 안 맞아 막혔을 수 있다. 반대쪽으로 한 번 더 해본다 —
          // 엿들은 기록이 없을 때 우리가 고른 값이 틀렸을 경우다.
          once(useCreds === 'include' ? 'omit' : 'include'),
        )
        .then(async (r) => {
          const text = await r.text();
          if (!r.ok) {
            // 서버가 왜 거절했는지는 대개 본문에 있다. 상태 코드만으로는
            // 토큰이 없는 건지 권한이 모자란 건지 모른다.
            console.log(`[NA] ${r.status} ${pathOf(url)}`, text.slice(0, 300));
          }
          answer({ ok: r.ok, status: r.status, text: text.slice(0, MAX_BYTES) });
        })
        .catch((err) => {
          console.log(`[NA] 못 불렀다 ${pathOf(url)}`, err);
          answer({ ok: false, status: 0, error: String(err?.message ?? err) });
        });
      return;
    }
    if (e.source !== window || e.data?.__naNet !== 'ask') return;
    window.postMessage(
      {
        __naNet: 'ans',
        id: e.data.id,
        caught: caught.map((c) => ({
          url: c.url,
          method: c.method,
          body: c.body,
          headers: c.headers,
          json: c.json,
        })),
      },
      '*',
    );
  });
})();
