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

  // ── 조작 기록 ──────────────────────────────────────────────
  //
  // 예전에는 clicks++ 로 **횟수만** 셌다. 그걸로는 "어디 있었나"까지만 알고
  // "무엇을 했나"는 모른다 — 같은 Supabase 콘솔이라도 테이블을 내보낸 것과
  // 그냥 들여다본 것이 구별되지 않는다. 절차를 뽑으려면 후자가 필요하다.
  //
  // 무엇을 남기는가(계획서 PLAN-observe.md 의 B 안):
  //   태그·역할·보이는 텍스트 + 안정 셀렉터(id / data-* / aria-label)
  //
  // 무엇을 여전히 안 남기는가:
  //   **키 입력 내용과 입력 필드의 값.** keydown 은 지금도 횟수만 센다.
  //   입력은 종류와 길이로만 남긴다(`email 24자`) — 절차의 뼈대에는 그걸로
  //   충분하고, 값 자체는 내용이라 성격이 달라진다.
  const MAX_ACT = 40; // 한 틱(10초)에 남길 조작 상한. 자동 스크롤 등 폭주 방어.
  const MAX_LABEL = 60;

  // dt: 직전 조작으로부터 흐른 초. 절대 시각이 아니라 **간격**인 이유는
  // 실행기에 필요한 게 그것이기 때문이다 — 「누르고 8초 뒤에 눌렀다」는
  // 그 사이에 화면이 바뀌기를 기다렸다는 뜻이고, 재실행할 때도 기다려야 한다.
  // 간격 없이 순서만 남기면 「연달아 두 번」과 구별이 안 되고, 그건 나중에
  // 소급해서 못 채운다.
  type Action = { t: string; label?: string; sel?: string; mut?: true; dt?: number };
  let actions: Action[] = [];
  let lastActAt = 0;

  /** 조작을 담으면서 직전과의 간격을 붙인다. */
  function pushAction(act: Action): void {
    if (actions.length >= MAX_ACT) return;
    const now = Date.now();
    if (lastActAt > 0) {
      const dt = Math.round((now - lastActAt) / 100) / 10; // 0.1초 단위
      if (dt >= 0.5) act.dt = dt; // 0.5초 미만은 연속 조작으로 보고 안 남긴다
    }
    lastActAt = now;
    actions.push(act);
  }

  /** 재실행에 쓸 수 있는 셀렉터만 고른다 — 자동 생성 클래스는 다음에 안 맞는다. */
  function stableSelector(el: Element): string | undefined {
    const id = el.id;
    if (id && !/\d{4,}/.test(id)) return `#${id}`;
    for (const a of ['data-testid', 'data-test', 'data-cy', 'name', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v) return `[${a}="${v.slice(0, MAX_LABEL)}"]`;
    }
    const role = el.getAttribute('role');
    return role ? `[role="${role}"]` : undefined;
  }

  /**
   * 요소의 이름표. 버튼 라벨이 절차의 이름이 된다.
   *
   * innerText 를 쓰지 않는다. 그쪽이 "화면에 실제로 보이는" 텍스트라 더
   * 정확하지만, 읽는 순간 **스타일·레이아웃을 다시 계산하게 만든다.** 클릭
   * 한 번이면 눈에 안 띄어도 무한 스크롤·드래그처럼 클릭이 연달아 오는
   * 화면에서는 끊김으로 드러난다. 관측이 사용을 방해하면 안 된다.
   *
   * textContent 는 숨은 자식의 텍스트까지 딸려올 수 있는데, 버튼 라벨은
   * 대개 자식이 하나라 실무상 같은 값이 나온다. 절차의 이름표로는 충분하다.
   */
  function labelOf(el: Element): string | undefined {
    const t = el.getAttribute('aria-label') ?? el.textContent ?? undefined;
    return t?.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL) || undefined;
  }

  /**
   * 무언가를 **바꾸는** 조작인가.
   *
   * 이 표시가 두 군데서 쓰인다. 절차의 후조건을 뽑는 재료이고, 나중에 그
   * 절차를 사람 없이 돌려도 되는지 가르는 기준이다 — 읽기만 하는 절차는
   * 최악이 헛수고지만 바꾸는 절차는 최악이 되돌릴 수 없다.
   */
  function isMutating(el: Element, label?: string): boolean {
    if (el.matches('button[type="submit"], input[type="submit"], a[download]')) return true;
    if (el.closest('form') && el.matches('button:not([type="button"])')) return true;
    return /저장|제출|삭제|배포|보내기|내보내기|등록|확인|올리기|다운로드|save|submit|delete|deploy|publish|export|download|create|apply|confirm/i.test(
      label ?? '',
    );
  }

  document.addEventListener('scroll', () => scrolls++, { passive: true });
  document.addEventListener(
    'click',
    (e) => {
      clicks++;
      if (actions.length >= MAX_ACT) return;
      // 클릭은 자식(아이콘·span)에 꽂히기 마련이라 조작 주체까지 올라간다.
      const raw = e.target as Element | null;
      const el = raw?.closest?.('button, a, [role], input, select, summary, label') ?? raw;
      if (!el || !(el instanceof Element)) return;
      const label = labelOf(el);
      const act: Action = { t: el.tagName.toLowerCase() };
      if (label) act.label = label;
      const sel = stableSelector(el);
      if (sel) act.sel = sel;
      if (isMutating(el, label)) act.mut = true;
      pushAction(act);
      // 무언가를 바꾸는 조작은 그 자리에서 보낸다. 이런 클릭이 곧 페이지를
      // 떠나게 만드는 것이라(제출·저장·배포), 다음 틱을 기다리면 그 조작
      // 자체가 사라진다 — 절차의 후조건이 되는 바로 그 단계다.
      if (act.mut) setTimeout(flush, 0);
    },
    { passive: true, capture: true },
  );
  // 키 입력 "횟수"만 센다 — 어떤 키인지(내용)는 여전히 절대 읽지 않는다
  // (키로거 금지). 아래 change 리스너도 값이 아니라 종류와 길이만 본다.
  document.addEventListener('keydown', () => keys++, { passive: true });
  // 입력이 **끝났을 때** 무엇을 채웠는지 — 값이 아니라 종류와 길이다.
  // 절차에서 이 자리는 "여기에 날짜를 넣는다" 정도의 뜻만 지니면 된다.
  document.addEventListener(
    'change',
    (e) => {
      if (actions.length >= MAX_ACT) return;
      const el = e.target as HTMLInputElement | null;
      if (!el || !(el instanceof Element) || !el.matches('input, select, textarea')) return;
      if (/password|hidden/i.test(el.type ?? '')) return; // 길이조차 남기지 않는다
      const kind = el.tagName === 'SELECT' ? 'select' : (el.type || 'text');
      const act: Action = { t: 'input', label: `${kind} ${el.value?.length ?? 0}자` };
      const sel = stableSelector(el);
      if (sel) act.sel = sel;
      pushAction(act);
    },
    { passive: true, capture: true },
  );

  // ── 절차 실행기 ────────────────────────────────────────
  //
  // 페이지가 뜰 때마다 서비스 워커에게 "여기서 지금 할 일이 있나"를 묻는다.
  // 절차는 페이지 이동을 넘으므로(supabase → docs.google) 이 물음이 이동
  // 뒤에도 이어지는 유일한 실마리다 — content script 는 이동할 때마다 죽는다.
  //
  // 도메인이 맞을 때만 답이 온다. 절차가 supabase 를 기다리는 동안 유튜브를
  // 봐도 아무 일도 일어나지 않는다.

  /** 요소가 나타날 때까지 짧게 되풀이해 찾는다. 시간을 재생하지 않는 이유 —
   *  녹화 때의 dt 를 그대로 기다리면 네트워크가 느린 날 실패하고 빠른 날
   *  헛되이 기다린다. dt 는 각오할 상한으로만 쓴다. */
  function waitFor(sel: string, timeoutMs: number): Promise<Element | null> {
    return new Promise((resolve) => {
      const found = document.querySelector(sel);
      if (found) return resolve(found);
      const t0 = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(sel);
        if (el || Date.now() - t0 > timeoutMs) {
          clearInterval(timer);
          resolve(el);
        }
      }, 120);
    });
  }

  /** 셀렉터가 없는 단계는 보이는 텍스트로 찾는다 — 녹화 때 안정 셀렉터가
   *  없었던 요소들이다. 정확도가 떨어지므로 첫 번째 것만 쓴다. */
  function findByLabel(label: string): Element | null {
    const cands = document.querySelectorAll('button, a, [role], input, select, summary, label');
    for (let i = 0; i < cands.length; i++) {
      const t = (cands[i].getAttribute('aria-label') ?? cands[i].textContent ?? '').trim();
      if (t === label) return cands[i];
    }
    return null;
  }

  type RunStep = { sel?: string; label?: string; isInput: boolean; dt: number };
  type RunRead = {
    after: number;
    sel: string;
    label: string;
    expect?:
      | { kind: 'contains'; text: string }
      | { kind: 'not-contains'; text: string }
      | { kind: 'below'; n: number };
  };

  /** 읽은 값이 기대에 맞나. 안 맞으면 왜. session/runner.ts 와 같은 규칙이어야
   *  한다 — 이쪽은 classic script 라 import 를 못 해서 자급자족한다. */
  function checkRead(r: RunRead, value: string): string | undefined {
    if (!r.expect) return undefined;
    if (r.expect.kind === 'contains')
      return value.includes(r.expect.text) ? undefined : `"${r.expect.text}" 가 없어`;
    if (r.expect.kind === 'not-contains')
      return value.includes(r.expect.text) ? `"${r.expect.text}" 가 보여` : undefined;
    const m = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!m) return '숫자를 못 찾았어';
    return Number(m[0]) < r.expect.n ? undefined : `${m[0]} 이 ${r.expect.n} 이상이야`;
  }

  /** 짚어준 자리의 값을 읽는다. 클릭은 기록돼도 **본 것은 기록되지 않아서**,
   *  무엇을 확인하는지는 사람이 승인할 때 알려준 것뿐이다. */
  async function doReads(
    reads: RunRead[],
  ): Promise<{ label: string; value: string; wrong?: string }[]> {
    const out: { label: string; value: string; wrong?: string }[] = [];
    for (const r of reads) {
      // 값이 늦게 채워지는 화면이 많다(대시보드는 대개 그렇다). 잠깐 기다린다.
      const el = await waitFor(r.sel, 6000);
      const raw = el ? ((el as HTMLElement).innerText ?? el.textContent ?? '') : '';
      const value = raw.trim().replace(/\s+/g, ' ').slice(0, 120) || '(못 읽음)';
      const wrong = checkRead(r, value);
      out.push(wrong ? { label: r.label, value, wrong } : { label: r.label, value });
    }
    return out;
  }

  async function doStep(step: RunStep, value: string | null): Promise<string | null> {
    const budget = Math.max(4000, Math.min(20000, Math.round(step.dt * 1000) + 4000));
    let el: Element | null = step.sel ? await waitFor(step.sel, budget) : null;
    if (!el && step.label) el = findByLabel(step.label);
    if (!el) return `"${step.label ?? step.sel ?? '요소'}" 를 못 찾았어`;

    if (step.isInput) {
      // 값은 녹화에 없다. 사람이 실행 전에 채운 것만 넣는다 — 지난달 값이
      // 박혀 있는 것보다 매번 묻는 쪽이 맞다.
      if (value == null) return '넣을 값이 없어';
      const input = el as HTMLInputElement;
      const proto = Object.getPrototypeOf(input);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      // React 는 자기가 심은 setter 로만 상태를 갱신한다. el.value = x 는
      // DOM 만 바꾸고 리액트는 모른 채로 남아, 제출하면 빈 값이 간다.
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return null;
    }

    (el as HTMLElement).click();
    return null;
  }

  async function pump(): Promise<void> {
    let guard = 0;
    let ask: {
      step: RunStep;
      index: number;
      value: string | null;
      reads: RunRead[];
    } | null = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'RUN_STEP_ASK', host }, (res) => {
          if (chrome.runtime.lastError || !res?.step) return resolve(null);
          resolve({
            step: res.step,
            index: res.index,
            value: res.value ?? null,
            reads: res.reads ?? [],
          });
        });
      } catch {
        resolve(null);
      }
    });

    // 한 페이지에서 여러 단계를 이어서 한다. 단계마다 페이지가 바뀌는 것은
    // 아니라서, 이동이 없으면 여기서 계속 돈다. guard 는 무한 루프 방어다.
    while (ask && guard++ < 50) {
      const err = await doStep(ask.step, ask.value);
      // 실패해도 읽기는 해본다 — 그 화면까지는 갔으니 값이 있을 수 있고,
      // 절반쯤 진행된 결과라도 없는 것보다 낫다.
      const got = ask.reads.length > 0 ? await doReads(ask.reads) : undefined;
      const next: {
        more?: boolean;
        step?: RunStep;
        index?: number;
        value?: string | null;
        reads?: RunRead[];
      } | null = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'RUN_STEP_DONE', host, ok: !err, error: err, got },
            (res) => resolve(chrome.runtime.lastError ? null : res),
          );
        } catch {
          resolve(null);
        }
      });
      if (err || !next?.more || !next.step) break;
      ask = {
        step: next.step,
        index: next.index ?? 0,
        value: next.value ?? null,
        reads: next.reads ?? [],
      };
      // 클릭이 화면을 바꿀 틈을 준다. 이동이 일어나면 이 스크립트는 죽고
      // 새 페이지의 content script 가 이어받는다.
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // ── 요소 집기 ──────────────────────────────────────────
  //
  // "이 화면에서 뭘 확인해?" 를 사람이 클릭으로 답한다. 관측으로는 못 얻는
  // 값이라(눈은 이벤트를 안 만든다) 이 길이 유일하다.
  //
  // 개발자도구의 요소 선택기와 같은 방식이다. 켜지면 다음 클릭 한 번을
  // 가로채서 그 자리의 셀렉터를 잡고 끈다.
  let picking = false;

  function pickSelector(el: Element): string {
    const id = el.id;
    if (id && !/\d{4,}/.test(id)) return `#${id}`;
    for (const a of ['data-testid', 'data-test', 'data-cy', 'name', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v) return `[${a}="${v.slice(0, 60)}"]`;
    }
    // 안정된 이름이 없으면 구조로 짚는다. 정확도가 떨어지지만 없는 것보다 낫다.
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let d = 0; cur && d < 4; d++) {
      const p: Element | null = cur.parentElement;
      if (!p) break;
      const i = Array.prototype.indexOf.call(p.children, cur) + 1;
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${i})`);
      cur = p;
    }
    return parts.join(' > ');
  }

  /**
   * 집기 대기 — 띠만 띄우고 페이지는 그대로 쓸 수 있게 둔다.
   *
   * 확인하려는 값이 첫 화면에 있다는 보장이 없다. 메뉴를 눌러 들어가야
   * 보이는 숫자가 대부분이다. 열자마자 덮개를 씌우면 거기까지 갈 수가 없다.
   *
   * 그래서 두 단계다: 자유롭게 돌아다니다가 → 「집기」를 누르면 그때 덮개.
   * 띠는 페이지를 옮겨도 다시 뜬다 — content script 가 로드마다 PICK_ASK 로
   * 묻고, 서비스 워커는 아직 기다리는 중이라고 답하기 때문이다.
   */
  function showPickBar(): void {
    if (document.getElementById('na-pick-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'na-pick-bar';
    bar.style.cssText =
      'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483646;' +
      'display:flex;align-items:center;gap:10px;background:rgba(10,14,22,.94);color:#dfe8f5;' +
      'padding:8px 12px;border-radius:5px;font:13px -apple-system,sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.4)';
    const label = document.createElement('span');
    label.textContent = '확인할 화면까지 이동한 뒤 눌러줘';
    const go = document.createElement('button');
    go.textContent = '집기';
    go.style.cssText =
      'border:1px solid rgba(99,230,210,.5);background:none;color:#63e6d2;' +
      'padding:3px 10px;border-radius:3px;cursor:pointer;font:inherit';
    go.addEventListener('click', () => {
      bar.remove();
      startPicking();
    });
    const no = document.createElement('button');
    no.textContent = '취소';
    no.style.cssText =
      'border:none;background:none;color:#8b98ab;cursor:pointer;font:inherit';
    no.addEventListener('click', () => {
      bar.remove();
      try {
        chrome.runtime.sendMessage({ type: 'PICK_RESULT', ok: false });
      } catch {
        /* 확장 컨텍스트 무효 */
      }
    });
    bar.append(label, go, no);
    document.body.append(bar);
  }

  function startPicking(): void {
    if (picking) return;
    picking = true;

    // 덮개를 씌우지 않는다. 예전에는 화면 전체를 가리고 십자 커서만 띄웠는데,
    // 그러면 **무엇을 집는지 안 보인다** — 값이 여러 개 나란한 대시보드에서는
    // 옆칸을 집어도 알 수가 없다. 대신 마우스 밑의 요소에 테두리를 그린다.
    //
    // 가리지 않으니 페이지의 원래 호버 효과도 그대로 보인다. 그게 낫다 —
    // 실제로 그 자리가 무엇인지가 드러난다.
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #63e6d2;' +
      'background:rgba(99,230,210,.12);border-radius:2px;transition:all .05s';
    const tip = document.createElement('div');
    tip.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;max-width:60vw;' +
      'background:rgba(10,14,22,.94);color:#dfe8f5;padding:6px 10px;border-radius:4px;' +
      'font:12px -apple-system,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

    let hovered: Element | null = null;

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === box || el === tip) return;
      hovered = el;
      const r = el.getBoundingClientRect();
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
      tip.textContent = text ? `"${text.slice(0, 40)}" 를 확인` : `<${el.tagName.toLowerCase()}> 를 확인`;
      // 요소 위쪽에 붙이되, 화면 밖으로 나가면 아래로 돌린다.
      const below = r.top < 40;
      tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 320))}px`;
      tip.style.top = below ? `${r.bottom + 6}px` : `${r.top - 30}px`;
    };

    const stop = () => {
      picking = false;
      box.remove();
      tip.remove();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };

    /**
     * 집은 것을 보여주고 확인을 받는다.
     *
     * 바로 보내면 잘못 집었을 때 되돌릴 길이 없다 — 창이 닫히고 사이트로
     * 돌아가서 처음부터 다시 해야 한다. 값이 여러 개 나란한 대시보드에서는
     * 옆칸을 집는 일이 흔하니, 여기서 한 번 보고 정하게 한다.
     */
    const confirm = (el: Element) => {
      const r = el.getBoundingClientRect();
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      box.style.borderColor = '#63e6d2';
      document.removeEventListener('mousemove', onMove, true);

      const text = ((el as HTMLElement).innerText ?? el.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ');
      const sel = pickSelector(el);

      tip.textContent = '';
      tip.style.whiteSpace = 'normal';
      tip.style.pointerEvents = 'auto';
      tip.style.display = 'flex';
      tip.style.alignItems = 'center';
      tip.style.gap = '10px';

      const what = document.createElement('span');
      what.textContent = text ? `"${text.slice(0, 40)}"` : `<${el.tagName.toLowerCase()}>`;
      // 셀렉터도 보여준다. nth-child 범벅이면 화면이 조금만 바뀌어도 깨진다는
      // 뜻이라, 확인하기 전에 알아야 한다.
      const how = document.createElement('span');
      how.textContent = sel.length > 44 ? `${sel.slice(0, 44)}…` : sel;
      how.style.cssText = 'color:#8b98ab;font-size:11px';

      const yes = document.createElement('button');
      yes.textContent = '확인';
      yes.style.cssText =
        'border:1px solid rgba(99,230,210,.5);background:none;color:#63e6d2;' +
        'padding:3px 10px;border-radius:3px;cursor:pointer;font:inherit';
      yes.addEventListener('click', (ev) => {
        ev.stopPropagation();
        stop();
        try {
          chrome.runtime.sendMessage({
            type: 'PICK_RESULT',
            ok: true,
            sel,
            sample: text.slice(0, 60),
            host,
          });
        } catch {
          /* 확장 컨텍스트 무효 */
        }
      });

      const again = document.createElement('button');
      again.textContent = '다시';
      again.style.cssText = 'border:none;background:none;color:#8b98ab;cursor:pointer;font:inherit';
      again.addEventListener('click', (ev) => {
        ev.stopPropagation();
        tip.style.pointerEvents = 'none';
        tip.style.display = '';
        tip.style.whiteSpace = 'nowrap';
        document.addEventListener('mousemove', onMove, true);
      });

      tip.append(what, how, yes, again);
      // 확인 띠가 화면 밖으로 나가지 않게 다시 앉힌다.
      tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 420))}px`;
      tip.style.top = r.top < 48 ? `${r.bottom + 8}px` : `${r.top - 38}px`;
    };

    const onClick = (e: MouseEvent) => {
      // **검사가 먼저다.** 확인 띠 안을 누른 것은 집기가 아니라 답이다.
      //
      // 예전에는 preventDefault·stopPropagation 을 먼저 부르고 검사했는데,
      // 이건 문서 캡처 단계 리스너라 그 순간 이벤트가 죽는다 — 확인 버튼의
      // 핸들러가 영영 안 불렸다. 누르면 아무 일도 안 일어나는 것처럼 보였다.
      if (tip.contains(e.target as Node) || box.contains(e.target as Node)) return;

      // 캡처 단계에서 가로챈다 — 페이지가 그 클릭으로 어디론가 가버리면
      // 집은 것을 돌려줄 자리가 없다.
      e.preventDefault();
      e.stopPropagation();
      const el = hovered ?? document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      confirm(el);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      stop();
      try {
        chrome.runtime.sendMessage({ type: 'PICK_RESULT', ok: false });
      } catch {
        /* 확장 컨텍스트 무효 */
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.body.append(box, tip);
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'START_PICK') showPickBar();
      // 이미 열려 있는 탭으로 옮겨왔다. 페이지 로드가 없으니 스스로 물을
      // 계기가 없어서, 서비스 워커가 직접 깨운다.
      if (msg?.type === 'RUN_PUMP') void pump();
    });
  } catch {
    /* 확장 컨텍스트 무효 */
  }

  // ── 사이트 다리 ────────────────────────────────────────
  //
  // 사이트 스크립트는 chrome.runtime 에 직접 못 닿는다(격리된 세계). 사이트가
  // window.postMessage 로 말하면 여기서 옮긴다.
  //
  // 예전에는 run-content.js 를 따로 두고 매니페스트에서 경로로 맞췄는데,
  // **Next 는 SPA 라 그게 안 붙는다.** content script 는 페이지가 실제로
  // 로드될 때만 주입되므로, 홈에서 눌러 /procedures 로 들어가면 영영 없다.
  // 오리진으로 넓혀도 매칭에 기대는 건 마찬가지라, 어디에나 붙는 이 스크립트가
  // 스스로 오리진을 확인하는 쪽이 확실하다.
  //
  // 아무 페이지나 절차를 돌리게 두면 안 된다 — 남의 사이트가 START_RUN 을
  // 보내면 네 브라우저에서 마음대로 클릭이 일어난다. 그래서 앱 오리진에서만 연다.
  const APP_ORIGINS = ['https://mia-web-nine.vercel.app'];
  const isApp =
    APP_ORIGINS.includes(location.origin) ||
    // 개발 중에는 포트가 자주 바뀐다. 로컬은 열어둔다.
    hostname === 'localhost' ||
    hostname === '127.0.0.1';

  if (isApp) {
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || typeof e.data.__na !== 'string') return;
      const kind = e.data.__na as string;

      const relay = (msg: unknown, ackType: string, extra: Record<string, unknown> = {}) => {
        try {
          chrome.runtime.sendMessage(msg, (res) => {
            window.postMessage(
              {
                __na: ackType,
                ...extra,
                ...(res ?? {}),
                ok: !chrome.runtime.lastError && (res?.ok !== false),
                error: chrome.runtime.lastError?.message ?? res?.error ?? null,
              },
              '*',
            );
          });
        } catch {
          window.postMessage({ __na: ackType, ...extra, ok: false, error: '확장에 닿지 못했어' }, '*');
        }
      };

      if (kind === 'run') relay({ type: 'START_RUN', run: e.data.run }, 'run-ack');
      else if (kind === 'pick')
        relay({ type: 'START_PICK', url: e.data.url }, 'pick-started', { after: e.data.after });
      // 결과를 가지러 온다. 붙들고 있다가 주면 워커가 잠드는 순간 영영 안 간다.
      else if (kind === 'pick-poll')
        relay({ type: 'PICK_POLL' }, 'pick-ack', { after: e.data.after });
      else if (kind === 'run-status') relay({ type: 'RUN_STATUS' }, 'run-status-ack');
    });
  }

  // 페이지가 자리 잡은 뒤에 시작한다 — 로드 직후에는 아직 그릴 것을 안 그렸다.
  setTimeout(() => void pump(), 600);

  // 이 탭이 집기 대상인지 스스로 묻는다. 서비스 워커가 밀어넣기를 기다리면
  // 무거운 페이지에서 경합이 난다 — 밀 때 이 스크립트가 아직 없다.
  setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ type: 'PICK_ASK' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.pick) showPickBar();
      });
    } catch {
      /* 확장 컨텍스트 무효 */
    }
  }, 700);

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

  /**
   * 모아둔 것을 보낸다.
   *
   * 10초 틱이 기본이지만 그것만으로는 **떠나는 순간을 못 잡는다.** 링크를
   * 눌러 페이지가 바뀌면 마지막 틱 이후의 조작이 전송 전에 사라지는데,
   * 하필 절차의 마지막 단계가 대개 페이지를 바꾸는 클릭이라 제일 중요한
   * 것부터 없어진다.
   *
   * 그래서 세 번 부른다: 10초마다 · 무언가를 바꾸는 조작 직후 · 떠날 때.
   */
  function flush(): void {
    const playing = isMediaPlaying();
    if (scrolls === 0 && clicks === 0 && keys === 0 && actions.length === 0 && !playing) return;

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
        // ── 조작 열 ── 절차 추출의 원재료. 도메인·제목이 "어디 있었나"라면
        // 이건 "무엇을 했나"다. 둘 다 있어야 절차가 뽑힌다.
        actions: actions.length > 0 ? actions : undefined,
      });
    } catch {
      // chrome.runtime 부재 또는 확장 컨텍스트 무효화(reload 등) 시 무시한다.
    }

    scrolls = 0;
    clicks = 0;
    keys = 0;
    actions = [];
  }

  setInterval(flush, 10000);

  // 떠나기 직전. beforeunload 는 MV3 에서 못 미덥고, pagehide 와
  // visibilitychange 를 같이 걸면 이동·탭 전환·창 닫기가 대부분 덮인다.
  // 둘 다 걸리는 경우가 있지만 flush 는 비어 있으면 아무것도 안 한다.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
})();
