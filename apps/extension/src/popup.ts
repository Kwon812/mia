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
  const reasons = Object.entries(snap.queue.skipReasons ?? {}).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) {
    foot.append(
      el(
        'div',
        'foot-row foot-warn',
        reasons.map(([r, n]) => `${SKIP_REASON_LABEL[r] ?? r} ${n}건`).join(' · '),
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
