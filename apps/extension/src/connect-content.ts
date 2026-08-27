// 사이트 자동 연결 content script — manifest 에서 사이트 오리진의 /connect*
// 경로에 주입된다. 두 화면이 걸린다.
//
//   /connect         미연결 사용자가 리다이렉트로 도착하는 곳. SW 에게 익명
//                    키를 받아 same-origin POST /api/connect 로 httpOnly 쿠키를
//                    세팅하고 홈으로 보낸다. 사용자는 아무것도 입력하지 않는다.
//
//   /connect/google  계정 연결·기기 붙이기 화면. 여기서는 **키만 넘기고 끝낸다.**
//                    기기의 주인을 바꾸는 것은 되돌리기 번거로운 조작이라
//                    사람이 버튼을 눌러야 한다 — 사람 모르게 돌리면 틀렸다는
//                    걸 아는 시점이 이미 실행된 뒤다.
//
// content.ts 와 동일하게 import 문 금지 (classic script 주입 — vite.config.ts 참고).

(() => {
  const path = location.pathname;
  const isConnect = path === '/connect';
  const isGoogle = path === '/connect/google';
  if (!isConnect && !isGoogle) return;

  try {
    chrome.runtime.sendMessage({ type: 'GET_EXTENSION_KEY' }, (res) => {
      // SW 미기동·확장 리로드 등으로 응답이 없으면 조용히 포기 — 수동 폼이 폴백.
      if (chrome.runtime.lastError || !res?.key) return;

      if (isGoogle) {
        // 두 경로로 건넨다. 페이지 스크립트가 먼저 붙었으면 메시지를 받고,
        // 이쪽이 먼저 끝났으면 속성에서 읽는다 — 순서 보장이 없다.
        document.documentElement.setAttribute('data-na-device-key', res.key);
        window.postMessage({ __na: 'device-key', key: res.key }, location.origin);
        return;
      }

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
