// 툴바 아이콘을 누르면 뜨는 창 — 지금 쌓이고 있는 세션을 보여준다.
//
// 네트워크를 쓰지 않는다. 서버에 아직 가지 않은(어쩌면 영영 가지 않을) 상태를
// 보는 것이 목적이고, 그 진실은 전부 로컬 IndexedDB 에 있다.
//
// 값 import 가 하나도 없다 (타입만 import 한다). sw.js 와 공유 청크가 생기지
// 않도록 하기 위함이며, 데이터는 전부 서비스 워커에 물어서 받는다 — 세션 규칙을
// 여기에 복제하지 않기 위해서다 (sw.ts 의 buildSessionSnapshot 주석 참고).

import type { SessionSnapshot } from './snapshot';
import type { UsageEntry, UsageSnapshot } from './usage';

// 팝업이 열려 있는 동안의 갱신 주기. 드래프트 자체는 1분 알람에서만 변하지만
// 남은 시간·경과 시간이 매초 흘러야 살아있는 화면이 된다.
const REFRESH_MS = 1000;

/** 사이트 주소. config.ts 의 API_BASE 와 같은 값을 **리터럴로** 적는다 —
 *  이 파일이 값 import 를 하는 순간 sw.js 와 공유 청크가 생긴다(파일 상단 주석).
 *  config.ts 를 바꾸면 여기도 바꾼다. */
const SITE_BASE = 'https://mia-web-nine.vercel.app';

/** 마감 사유. 버려진 세션이 왜 그 길이였는지를 말해준다 —
 *  switch 로 잘린 조각인지, 그냥 짧게 끝난 것인지. */
const CLOSE_REASON_LABEL: Record<string, string> = {
  idle: '무활동',
  switch: '맥락이탈',
  maxlen: '4시간',
  day: '날짜경계',
  shutdown: '종료',
};

const SKIP_REASON_LABEL: Record<string, string> = {
  too_short: '10분 미만',
  low_activity: '활동 점수 부족',
  single_domain_entertainment: '단일 도메인 영상',
};

const CATEGORY_LABEL: Record<string, string> = {
  dev: '개발',
  study: '학습',
  docs: '문서',
  ai: 'AI 도구',
  search: '검색',
  community: '커뮤니티',
  entertainment: '엔터테인먼트',
  music: '음악',
  shopping: '쇼핑',
  productivity: '생산성',
  news: '뉴스',
  finance: '금융',
  etc: '기타',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

/** 밀리초 → "1시간 23분" / "12분" / "45초" */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return `${m}분`;
  return `${s}초`;
}

/** 도메인별 누적 초 → "5분" 같은 짧은 표기 */
function formatSeconds(sec: number): string {
  if (sec >= 60) return `${Math.round(sec / 60)}분`;
  return `${sec}초`;
}

function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── DOM 헬퍼 — textContent 만 쓴다 (innerHTML 금지: 도메인 문자열이 그대로 들어온다) ──

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stat(label: string, value: string): HTMLElement {
  const box = el('div', 'stat');
  box.append(el('span', 'stat-k', label), el('span', 'stat-v', value));
  return box;
}

function row(label: string, value: string, valueClass = 'row-v'): HTMLElement {
  const line = el('div', 'row');
  line.append(el('span', 'row-k', label), el('span', valueClass, value));
  return line;
}

// ── 렌더 ──

// ── 확장 키 복구칸의 상태 ──
// 열려 있는 동안은 위 칸을 다시 그리지 않는다(render 참고) — 매 초 지워지면
// 키를 한 글자도 못 붙여넣는다. 그래서 입력값도 여기 들고 있는다.
let restoreOpen = false;
let restoreDraft = '';
let restoreBusy = false;
let restoreMsg: { text: string; bad: boolean } | null = null;
/** 지금 이 확장이 들고 있는 키. 패널을 열 때 SW 에게 물어 채운다. */
let currentKey: string | null = null;
/** 위 칸을 스냅샷 없이 혼자 다시 그리기 위한 마지막 값 */
let lastSnap: SessionSnapshot | null = null;

/**
 * 새 익명 키를 발급했다는 경고 배너 — **맨 위, 닫기 전까지 계속.**
 *
 * 확장은 첫 설치와 "스토리지를 잃은 재설치"를 구분할 수 없다(onInstalled 의
 * reason 이 둘 다 'install' 이고, storage.local 미러도 같은 오리진이라 함께
 * 사라진다). 그래서 발급은 그대로 하고 사람에게 묻는다.
 *
 * 자동으로 사라지지 않는다. 시간이 지나 없어지면 경고가 아니라 알림이 된다 —
 * 실제로 이 사고는 며칠 뒤 "경험이 왜 하나뿐이지"로 발견됐다.
 */
function renderKeyNotice(root: HTMLElement, snap: SessionSnapshot): void {
  if (!snap.keyNotice) return;

  const box = el('div', 'notice');
  box.append(
    el('div', 'notice-t', '새 캐릭터로 시작했어요'),
    el(
      'div',
      'notice-s',
      `${formatClock(snap.keyNotice.issuedAt)}에 이 브라우저에 새 신원이 발급됐어요. ` +
        '확장을 처음 설치한 거면 그대로 두면 돼요. 전에 키우던 캐릭터가 있다면 ' +
        '지금부터의 기록이 그쪽에 안 쌓이니 다시 연결해주세요.',
    ),
  );

  const actions = el('div', 'notice-actions');

  const connect = el('button', 'btn btn-main', '기존 캐릭터에 연결');
  connect.addEventListener('click', () => {
    // /connect 는 connect-content.js 가 주입되는 곳이라, 열기만 하면 지금 키로
    // 쿠키가 다시 세팅된다. 옛 키로 되돌리는 것은 사람이 그 화면에서 한다.
    void chrome.tabs.create({ url: `${SITE_BASE}/connect` });
  });

  const dismiss = el('button', 'btn', '처음 설치예요');
  dismiss.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'ACK_KEY_NOTICE' }, () => {
        // lastError 를 읽지 않으면 콘솔에 경고가 쌓인다. 실패해도 다음 새로고침에
        // 배너가 그대로 남을 뿐이라 따로 알리지 않는다.
        void chrome.runtime.lastError;
        refresh();
      });
    } catch {
      /* 확장 컨텍스트 무효화 — 다음에 다시 뜬다 */
    }
  });

  actions.append(connect, dismiss);
  box.append(actions);
  root.append(box);
}

/**
 * 확장 키를 보여주고, 옛 키로 되돌린다.
 *
 * 이 값이 곧 계정 전체다(비밀번호가 없다). 브라우저를 지우면 확장 스토리지도
 * 같이 사라지고 새 키가 발급되는데, 그때까지 옛 키를 되돌릴 방법이 코드에
 * 없었다 — 콘솔에서 IndexedDB 를 직접 여는 것 말고는. 여기가 그 자리다.
 *
 * 적어두는 쪽도 같이 둔다. 잃고 나서 찾는 것보다 잃기 전에 적는 게 싸다.
 */
function renderKeyRestore(root: HTMLElement): void {
  const box = el('div', 'krest');

  if (!restoreOpen) {
    const open = el('button', 'krest-link', '확장 키 확인·변경');
    open.addEventListener('click', () => {
      restoreOpen = true;
      restoreMsg = null;
      askCurrentKey();
      repaintNotice();
    });
    box.append(open);
    root.append(box);
    return;
  }

  box.append(
    el('div', 'krest-t', '확장 키'),
    el(
      'div',
      'krest-s',
      '이 브라우저의 기록이 어느 캐릭터에 쌓이는지 정하는 값이에요. ' +
        '브라우저를 지우면 함께 사라지니 어딘가에 적어두고, 새로 설치했다면 옛 키를 붙여넣어 되돌리세요.',
    ),
    el('div', 'krest-now', currentKey ?? '아직 발급되지 않았어요'),
  );

  // 이 패널이 있는 이유 자체가 "키를 잃으면 캐릭터를 잃는다" 인데, 구글을
  // 이어두면 그 전제가 사라진다. 키를 적어두라고 말하는 자리 바로 옆이
  // 그 말을 안 해도 되게 만드는 방법을 놓기에 가장 정직한 자리다.
  const link = el('button', 'krest-link', '구글 계정에 연결해두기 →');
  link.addEventListener('click', () => {
    // /connect 가 아니라 /connect/google 이다. /connect 는 connect-content.js 가
    // 주입돼 키로 쿠키만 다시 심고 홈으로 튕기므로, 안내를 볼 새가 없다.
    void chrome.tabs.create({ url: `${SITE_BASE}/connect/google` });
  });
  box.append(link);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'keys-i';
  input.placeholder = 'na_... (되돌릴 옛 키)';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = restoreDraft;
  input.disabled = restoreBusy;
  input.addEventListener('input', () => {
    restoreDraft = input.value;
  });
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') submitRestore();
  });
  box.append(input);

  if (restoreMsg) {
    box.append(el('div', restoreMsg.bad ? 'krest-m krest-bad' : 'krest-m krest-good', restoreMsg.text));
  }

  const actions = el('div', 'notice-actions');
  const save = el('button', 'btn btn-main', restoreBusy ? '확인하는 중...' : '이 키로 바꾸기');
  save.addEventListener('click', () => submitRestore());
  const close = el('button', 'btn', '닫기');
  close.addEventListener('click', () => {
    restoreOpen = false;
    restoreMsg = null;
    repaintNotice();
  });
  actions.append(save, close);
  box.append(actions);
  root.append(box);

  // 붙여넣기가 목적인 칸이다 — 열자마자 커서가 여기 있어야 한다.
  if (!restoreBusy) input.focus();
}

/** 지금 키를 SW 에게 물어 온다. 실패하면 빈손으로 그린다(경고까지는 아니다). */
function askCurrentKey(): void {
  try {
    chrome.runtime.sendMessage({ type: 'GET_EXTENSION_KEY' }, (res?: { key: string | null }) => {
      void chrome.runtime.lastError;
      currentKey = res?.key ?? null;
      if (restoreOpen) repaintNotice();
    });
  } catch {
    currentKey = null;
  }
}

/** 검증과 저장은 서비스 워커가 한다(applyExtensionKey) — 여기는 결과만 그린다. */
function submitRestore(): void {
  if (restoreBusy) return;
  const value = restoreDraft.trim();
  if (!value) {
    restoreMsg = { text: '키를 붙여넣어줘', bad: true };
    repaintNotice();
    return;
  }

  restoreBusy = true;
  restoreMsg = null;
  repaintNotice();

  try {
    chrome.runtime.sendMessage(
      { type: 'SET_EXTENSION_KEY', key: value },
      (res?: { ok: boolean; error?: string }) => {
        restoreBusy = false;
        if (chrome.runtime.lastError || !res) {
          restoreMsg = { text: '확장이 응답하지 않아 — 잠시 뒤 다시 열어보세요', bad: true };
        } else if (!res.ok) {
          restoreMsg = { text: res.error ?? '바꾸지 못했어', bad: true };
        } else {
          // 패널을 닫지 않는다 — 바뀌었다는 말을 사람이 읽고 닫아야 한다.
          currentKey = value;
          restoreDraft = '';
          restoreMsg = { text: '이 키로 바꿨어요. 지금부터의 기록은 이쪽에 쌓여요.', bad: false };
        }
        repaintNotice();
      },
    );
  } catch {
    restoreBusy = false;
    restoreMsg = { text: '확장 컨텍스트가 끊겼어 — 팝업을 다시 열어주세요', bad: true };
    repaintNotice();
  }
}

/** 위 칸(경고 배너 + 키 칸)만 다시 그린다. 아래 세션 칸은 건드리지 않는다. */
function repaintNotice(): void {
  const parts = shell();
  if (!parts) return;
  parts.notice.replaceChildren();
  if (lastSnap) renderKeyNotice(parts.notice, lastSnap);
  renderKeyRestore(parts.notice);
}

function renderNoSession(root: HTMLElement, snap: SessionSnapshot): void {
  const empty = el('div', 'empty');
  empty.append(
    el('div', 'empty-mark', '—'),
    el('div', 'empty-t', '지금은 열린 세션이 없어요'),
    el(
      'div',
      'empty-s',
      snap.rawEvents > 0
        ? `활동 신호 ${snap.rawEvents}건이 대기 중 — 다음 확인(최대 1분)에 새 세션이 시작돼요`
        : '브라우징을 시작하면 여기에 나타나요',
    ),
  );
  root.append(empty);
}

function renderDraft(root: HTMLElement, snap: SessionSnapshot): void {
  const draft = snap.draft;
  const preview = snap.preview;
  const countdown = snap.countdown;
  if (!draft || !preview || !countdown) return;

  const elapsed = Math.max(0, snap.now - draft.startedAt);
  const sinceActivity = Math.max(0, snap.now - draft.lastActivityAt);

  // ── 헤더 ──
  const head = el('div', 'head');
  const title = el('div', 'head-main');
  title.append(
    el('span', 'dot' + (sinceActivity < 2 * 60 * 1000 ? ' dot-live' : ' dot-idle')),
    el('span', 'head-cat', categoryLabel(draft.primaryCategory)),
  );
  head.append(title, el('div', 'head-sub', `${formatClock(draft.startedAt)} 시작 · ${formatDuration(elapsed)}째`));
  root.append(head);

  // ── 전송 미리보기 — 이 팝업의 핵심 ──
  const verdict = el('div', 'verdict ' + (preview.skipReason === null ? 'verdict-ok' : 'verdict-skip'));
  verdict.append(
    el('span', 'verdict-k', '지금 마감되면'),
    el(
      'span',
      'verdict-v',
      preview.skipReason === null
        ? '서버로 전송'
        : `버려짐 · ${SKIP_REASON_LABEL[preview.skipReason] ?? preview.skipReason}`,
    ),
  );
  root.append(verdict);

  // ── 지표 ──
  const stats = el('div', 'stats');
  stats.append(
    stat('기록될 길이', `${preview.durationMin}분`),
    stat('활동 점수', String(draft.activityScore)),
    stat('도메인', String(preview.uniqueDomains)),
    stat('맥락 이탈', `${draft.switchCount}회`),
  );
  root.append(stats);

  // ── 마감까지 ──
  const closes = el('div', 'block');
  closes.append(el('div', 'block-h', '마감까지'));
  closes.append(row('무활동(idle)', formatDuration(countdown.idle)));
  closes.append(row('최대 길이', formatDuration(countdown.maxlen)));
  closes.append(row('하루 경계', formatDuration(countdown.day)));
  if (draft.excursionCategory) {
    closes.append(
      row('맥락 전환', `${categoryLabel(draft.excursionCategory)}(으)로 이탈 중`, 'row-v row-warn'),
    );
  }
  root.append(closes);

  // ── 도메인 ──
  const domains = Object.entries(draft.domains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (domains.length > 0) {
    const max = domains[0][1] || 1;
    const block = el('div', 'block');
    block.append(el('div', 'block-h', '머문 곳'));
    for (const [host, sec] of domains) {
      const line = el('div', 'bar-row');
      const bar = el('div', 'bar');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${Math.max(2, Math.round((sec / max) * 100))}%`;
      bar.append(fill);
      line.append(el('span', 'bar-k', host), bar, el('span', 'bar-v', formatSeconds(sec)));
      block.append(line);
    }
    root.append(block);
  }

  // ── 태그 · 이어받은 세션 ──
  if (draft.tags.length > 0 || draft.continuedFrom) {
    const marks = el('div', 'marks');
    for (const tag of draft.tags) marks.append(el('span', 'tag', tag));
    if (draft.continuedFrom) marks.append(el('span', 'tag tag-quiet', '4시간 절단에서 이어짐'));
    root.append(marks);
  }
}

function renderFooter(root: HTMLElement, snap: SessionSnapshot): void {
  const foot = el('div', 'foot');

  const queue =
    snap.queue.sending + snap.queue.failed === 0
      ? '전송 대기 없음'
      : `전송 대기 ${snap.queue.sending + snap.queue.failed}건` +
        (snap.queue.failed > 0 ? ` (실패 ${snap.queue.failed})` : '');

  foot.append(el('div', 'foot-row', queue));
  foot.append(
    el(
      'div',
      'foot-row',
      `최근 3일 ${snap.queue.archived}건 마감 · ${snap.queue.skipped}건 필터 탈락`,
    ),
  );
  // 왜 버려졌는지까지 보여준다. 개수만으로는 손쓸 데를 못 찾는다 —
  // '10분 미만'이 쌓이면 세션이 잘게 끊기고 있다는 신호다(맥락 이탈 판정이
  // 예민하면 앞 조각이 10분을 못 채우고 통째로 사라진다).
  for (const it of snap.queue.skippedItems ?? []) {
    const t = new Date(it.at);
    const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    foot.append(
      el(
        'div',
        'foot-row foot-warn',
        `${hm} · ${it.durationMin}분 · ${CLOSE_REASON_LABEL[it.closeReason] ?? it.closeReason} · ${SKIP_REASON_LABEL[it.skipReason] ?? it.skipReason}`,
      ),
    );
  }
  if (!snap.connected) {
    foot.append(el('div', 'foot-row foot-warn', '아직 키가 발급되지 않았어요'));
  }
  root.append(foot);
}

// ── API 사용량 ──────────────────────────────────────────────
//
// 대시보드를 세 군데 열지 않으려고 붙인 자리다. 숫자를 만드는 일은 전부
// 서비스 워커가 한다(usage.ts) — 여기는 받은 문자열을 그리기만 한다.
// 그래서 팝업에 API 키도, 통화 계산도 들어오지 않는다.

let usage: UsageSnapshot | null = null;
/** 한 번도 못 받았을 때와 "받았는데 비었다"를 구분한다 */
let usageLoading = true;
/** 키 입력칸이 열려 있나. 열려 있는 동안은 이 블록을 다시 그리지 않는다 */
let keysOpen = false;
/** 방금 갱신을 눌렀나 — 버튼이 눌린 티가 나야 한다 */
let usageBusy = false;

/** 값이 없어도 자리를 지킨다 — 매 초 재배치되면 눈이 따라가지 못한다. */
function sparkline(values: number[]): HTMLElement {
  const box = el('div', 'u-spark');
  for (const v of values) {
    const bar = el('span', 'u-bar');
    // 0 인 날도 보이게 최소 높이를 준다. 안 그러면 "그 날은 데이터가 없다"와
    // "그 날은 안 썼다"가 똑같이 빈칸으로 보인다.
    bar.style.height = `${Math.max(12, Math.round(v * 100))}%`;
    if (v === 0) bar.classList.add('u-bar-zero');
    box.append(bar);
  }
  return box;
}

function renderUsageEntry(entry: UsageEntry): HTMLElement {
  const box = el('div', 'u-item');

  const top = el('div', 'u-top');
  top.append(el('span', 'u-name', entry.label));
  if (entry.spark.length > 0) top.append(sparkline(entry.spark));
  else top.append(el('span', 'u-spark'));

  // 큰 숫자와 그 이름을 세로로 쌓는다. 칸마다 줄 수 있는 것이 달라서
  // (금액이거나, Render 처럼 애초에 금액이 아니거나) 이름이 없으면 못 읽는다.
  const amountBox = el('div', 'u-amt-box');
  const amount = el('span', 'u-amt', entry.headline ?? '—');
  if (entry.headline === null && entry.hasKey && !entry.error) {
    // Render 가 여기다. 비용 API 가 없어서 못 적는 것이지 0 이 아니다.
    amount.classList.add('u-amt-none');
    amount.title = '이 서비스는 요금을 API 로 주지 않아 — 대시보드에서 봐야 해';
  }
  amountBox.append(amount);
  if (entry.headlineLabel) amountBox.append(el('span', 'u-amt-k', entry.headlineLabel));
  top.append(amountBox);
  box.append(top);

  if (!entry.hasKey && entry.subUsd === null) {
    const ask = el('button', 'u-sub u-link', '키를 넣으면 여기에 보여요');
    ask.addEventListener('click', () => {
      keysOpen = true;
      paintUsage();
    });
    box.append(ask);
  } else if (entry.error) {
    box.append(el('div', 'u-sub u-err', entry.error));
  } else if (entry.lines.length > 0) {
    box.append(el('div', 'u-sub', entry.lines.map((l) => `${l.k} ${l.v}`).join(' · ')));
  }

  return box;
}

/**
 * 키 입력칸.
 *
 * **저장된 키를 되돌려 받지 않는다.** 팝업은 "있다/없다"만 안다 — 키가
 * DOM 에 들어오는 순간 확장 화면을 여는 누구나 읽을 수 있게 된다. 바꿀
 * 때는 새로 넣는다. 구독료는 반대다 — 비밀이 아니라 상수라 그대로 보인다.
 */
function renderKeyForm(): HTMLElement {
  const box = el('div', 'keys');
  const inputs = new Map<string, HTMLInputElement>();
  const subs = new Map<string, HTMLInputElement>();
  /** 손댄 칸만 저장한다 — 안 건드린 구독료를 매번 다시 쓰지 않으려고 */
  const subDirty = new Set<string>();

  // 목록은 서비스 워커가 준다. 못 받았다면 저장도 못 하는 상태라 —
  // 빈 입력칸 세 개를 그려놓고 안 되는 것보다 그렇다고 말하는 게 낫다.
  if (!usage) {
    box.append(el('div', 'u-sub u-err', '서비스 워커가 응답을 안 해 — 팝업을 닫았다 다시 열어봐'));
    return box;
  }

  for (const entry of usage.entries) {
    const field = el('div', 'keys-f');

    const head = el('div', 'keys-l');
    head.append(el('span', undefined, entry.label));
    const issue = el('button', 'u-link', '키 발급');
    issue.addEventListener('click', () => void chrome.tabs.create({ url: entry.keyUrl }));
    head.append(issue);
    field.append(head);

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'keys-i';
    input.placeholder = entry.hasKey ? '저장됨 — 바꾸려면 새로 입력' : '키 붙여넣기';
    // 브라우저 비밀번호 관리자가 끼어들면 엉뚱한 값이 채워진다.
    input.autocomplete = 'off';
    field.append(input);
    inputs.set(entry.id, input);

    const hint = el('div', 'keys-h', entry.keyHint);
    field.append(hint);

    // 넣는 그 자리에서 종류를 봐준다. 일반 키를 넣고 저장한 뒤 401 을 보고
    // 나서야 아는 것과, 넣자마자 아는 것은 다르다.
    input.addEventListener('input', () => {
      const v = input.value.trim();
      const wrong =
        v.length > 8 &&
        ((entry.id === 'openai' && !v.startsWith('sk-admin')) ||
          (entry.id === 'anthropic' && !v.startsWith('sk-ant-admin')) ||
          (entry.id === 'render' && !v.startsWith('rnd_')));
      hint.textContent = wrong ? `이 키로는 안 될 거야 — ${entry.keyHint}` : entry.keyHint;
      hint.classList.toggle('keys-h-warn', wrong);
    });

    // 월 구독료. **API 가 안 주는 값이라 사람이 적는다** — cost_report 에는
    // API 사용액만 있고 Pro/Max·Plus 구독료는 청구 주체가 아예 다르다.
    // 비우면 지운다.
    const sub = document.createElement('input');
    sub.type = 'text';
    sub.inputMode = 'decimal';
    sub.className = 'keys-i keys-money';
    sub.placeholder = '월 구독료 $ (없으면 비워둬)';
    sub.autocomplete = 'off';
    if (entry.subUsd !== null) sub.value = String(entry.subUsd);
    sub.addEventListener('input', () => subDirty.add(entry.id));
    field.append(sub);
    subs.set(entry.id, sub);

    if (entry.hasKey) {
      const drop = el('button', 'u-link keys-drop', '키 지우기');
      drop.addEventListener('click', () => {
        saveKeys([[entry.id, '']]);
      });
      field.append(drop);
    }

    box.append(field);
  }

  const actions = el('div', 'notice-actions');
  const save = el('button', 'btn btn-main', '저장');
  save.addEventListener('click', () => {
    const pairs: [string, string][] = [];
    for (const [id, input] of inputs) {
      const v = input.value.trim();
      // 빈 칸은 "지우기"가 아니라 "안 건드림"이다. 지우기는 따로 있다.
      if (v) pairs.push([id, v]);
    }
    // 구독료는 빈 칸이 곧 "지움"이다 — 키와 달리 값이 그대로 보이므로
    // 지우려는 건지 안 건드린 건지가 눈에 보인다.
    const money: [string, string][] = [];
    for (const [id, input] of subs) {
      if (subDirty.has(id)) money.push([id, input.value.trim()]);
    }
    saveKeys(pairs, money);
  });
  const close = el('button', 'btn', '닫기');
  close.addEventListener('click', () => {
    keysOpen = false;
    paintUsage();
  });
  actions.append(save, close);
  box.append(actions);

  return box;
}

/** 저장 → 캐시가 비워지고 → 곧바로 다시 부른다. 저장했는데 옛 오류가 남아 있으면 안 된다. */
function saveKeys(pairs: [string, string][], money: [string, string][] = []): void {
  const msgs = [
    ...pairs.map(([service, key]) => ({ type: 'SET_USAGE_KEY', service, key })),
    ...money.map(([service, amount]) => ({ type: 'SET_USAGE_SUB', service, amount })),
  ];
  if (msgs.length === 0) {
    keysOpen = false;
    paintUsage();
    return;
  }
  // 마지막 하나가 끝난 뒤에 다시 부른다. 중간에 부르면 캐시를 지우는 다음
  // 저장과 겹쳐서 방금 넣은 값이 빠진 채로 화면에 뜬다.
  let left = msgs.length;
  const done = () => {
    if (--left === 0) {
      keysOpen = false;
      loadUsage(true);
    }
  };
  for (const msg of msgs) {
    try {
      chrome.runtime.sendMessage(msg, () => {
        void chrome.runtime.lastError;
        done();
      });
    } catch {
      done();
    }
  }
}

function paintUsage(): void {
  const root = document.getElementById('usage');
  if (!root) return;
  root.replaceChildren();

  const head = el('div', 'u-head');
  head.append(el('span', 'block-h', 'API 사용량'));

  const right = el('div', 'u-head-r');
  if (usage) {
    const d = new Date(usage.periodStart);
    right.append(el('span', 'u-since', `${d.getUTCMonth() + 1}월 1일부터`));
  }
  const reload = el('button', 'u-link', usageBusy ? '…' : '갱신');
  reload.addEventListener('click', () => loadUsage(true));
  const gear = el('button', 'u-link', keysOpen ? '접기' : '키');
  gear.addEventListener('click', () => {
    keysOpen = !keysOpen;
    paintUsage();
  });
  right.append(reload, gear);
  head.append(right);
  root.append(head);

  if (keysOpen) {
    root.append(renderKeyForm());
    return;
  }

  if (!usage) {
    root.append(el('div', 'u-sub u-quiet', usageLoading ? '읽는 중…' : '사용량을 읽지 못했어요'));
    return;
  }

  for (const entry of usage.entries) root.append(renderUsageEntry(entry));

  if (usage.totalUsd) {
    root.append(el('div', 'u-total', `이달 합계 ${usage.totalUsd}`));
  }
}

function loadUsage(force = false): void {
  usageBusy = force;
  paintUsage();
  try {
    chrome.runtime.sendMessage({ type: 'GET_API_USAGE', force }, (snap?: UsageSnapshot | null) => {
      usageLoading = false;
      usageBusy = false;
      if (chrome.runtime.lastError || !snap) {
        paintUsage();
        return;
      }
      usage = snap;
      paintUsage();
    });
  } catch {
    usageLoading = false;
    usageBusy = false;
    paintUsage();
  }
}

// ── 뼈대 ────────────────────────────────────────────────────
//
//   ┌─────────────────────────────────┐
//   │ #notice  (신원 경고 — 가로 전체) │
//   ├──────────────────┬──────────────┤
//   │ #session         │ #usage       │
//   │ 지금 쌓이는 세션  │ API 사용량    │
//   └──────────────────┴──────────────┘
//
// 칸을 **한 번만** 만들고 각자 안쪽만 갈아 끼운다. #app 을 통째로 지우면
// 매 초(REFRESH_MS) 오른쪽 칸도 같이 날아가는데, 그러면 키를 입력하는 중에
// 입력칸이 사라진다 — 한 글자도 못 친다.

function shell(): { notice: HTMLElement; session: HTMLElement } | null {
  const root = document.getElementById('app');
  if (!root) return null;
  let notice = document.getElementById('notice');
  if (!notice) {
    notice = el('div');
    notice.id = 'notice';

    const session = el('div');
    session.id = 'session';
    const usageBox = el('div', 'usage');
    usageBox.id = 'usage';

    const cols = el('div', 'cols');
    cols.append(session, usageBox);
    root.append(notice, cols);
  }
  return { notice, session: document.getElementById('session') as HTMLElement };
}

function render(snap: SessionSnapshot): void {
  const parts = shell();
  if (!parts) return;
  parts.session.replaceChildren();

  // 세션보다 먼저다 — 신원이 갈렸으면 그 아래 숫자는 다 엉뚱한 계정 것이다.
  lastSnap = snap;
  // 키 칸이 열려 있으면 위 칸은 손대지 않는다 — 매 초 지워지면 붙여넣던 키가
  // 사라진다(오른쪽 API 키 칸을 keysOpen 으로 막는 것과 같은 이유).
  if (!restoreOpen) repaintNotice();

  if (snap.draft) renderDraft(parts.session, snap);
  else renderNoSession(parts.session, snap);

  renderFooter(parts.session, snap);
}

function renderError(): void {
  const parts = shell();
  if (!parts) return;
  parts.session.replaceChildren();
  const empty = el('div', 'empty');
  empty.append(
    el('div', 'empty-mark', '!'),
    el('div', 'empty-t', '상태를 읽지 못했어요'),
    el('div', 'empty-s', '확장을 새로고침한 직후라면 잠시 뒤 다시 열어보세요'),
  );
  parts.session.append(empty);
}

function refresh(): void {
  try {
    chrome.runtime.sendMessage({ type: 'GET_SESSION_SNAPSHOT' }, (snap?: SessionSnapshot) => {
      // 서비스 워커가 아직 안 깨어났거나 확장이 리로드된 직후
      if (chrome.runtime.lastError || !snap) {
        renderError();
        return;
      }
      render(snap);
    });
  } catch {
    renderError();
  }
}

shell();
paintUsage();
loadUsage();
refresh();
const timer = setInterval(refresh, REFRESH_MS);
// 팝업이 닫히면 문서째 사라지지만, 명시적으로 정리해둔다.
window.addEventListener('unload', () => clearInterval(timer));
