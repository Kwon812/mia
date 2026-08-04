// 사이트 자동 연결 content script — manifest 에서 사이트 오리진의 /connect
// 경로에만 주입된다 (미연결 사용자가 리다이렉트로 도착하는 곳 = 정확히 연결이
// 필요한 순간). SW 에게 익명 키를 받아 same-origin POST /api/connect 로
// httpOnly 쿠키를 세팅하고 홈으로 보낸다. 사용자는 아무것도 입력하지 않는다.
//
// content.ts 와 동일하게 import 문 금지 (classic script 주입 — vite.config.ts 참고).

(() => {
  if (location.pathname !== '/connect') return;

  try {
    chrome.runtime.sendMessage({ type: 'GET_EXTENSION_KEY' }, (res) => {
      // SW 미기동·확장 리로드 등으로 응답이 없으면 조용히 포기 — 수동 폼이 폴백.
      if (chrome.runtime.lastError || !res?.key) return;

      void fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension_key: res.key }),
      }).then((r) => {
        if (r.ok) location.href = '/';
      });
    });
  } catch {
    // 확장 컨텍스트 무효화 — 수동 폼 폴백
  }
})();
