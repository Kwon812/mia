// 툴바 아이콘을 누르면 뜨는 창 — 지금 쌓이고 있는 세션을 보여준다.
//
// 네트워크를 쓰지 않는다. 서버에 아직 가지 않은(어쩌면 영영 가지 않을) 상태를
// 보는 것이 목적이고, 그 진실은 전부 로컬 IndexedDB 에 있다.
//
// 값 import 가 하나도 없다 (타입만 import 한다). sw.js 와 공유 청크가 생기지
// 않도록 하기 위함이며, 데이터는 전부 서비스 워커에 물어서 받는다 — 세션 규칙을
// 여기에 복제하지 않기 위해서다 (sw.ts 의 buildSessionSnapshot 주석 참고).

import type { SessionSnapshot } from './snapshot';

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

function render(snap: SessionSnapshot): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.replaceChildren();

  // 세션보다 먼저다 — 신원이 갈렸으면 그 아래 숫자는 다 엉뚱한 계정 것이다.
  renderKeyNotice(root, snap);

  if (snap.draft) renderDraft(root, snap);
  else renderNoSession(root, snap);

  renderFooter(root, snap);
}

function renderError(): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.replaceChildren();
  const empty = el('div', 'empty');
  empty.append(
    el('div', 'empty-mark', '!'),
    el('div', 'empty-t', '상태를 읽지 못했어요'),
    el('div', 'empty-s', '확장을 새로고침한 직후라면 잠시 뒤 다시 열어보세요'),
  );
  root.append(empty);
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

refresh();
const timer = setInterval(refresh, REFRESH_MS);
// 팝업이 닫히면 문서째 사라지지만, 명시적으로 정리해둔다.
window.addEventListener('unload', () => clearInterval(timer));
