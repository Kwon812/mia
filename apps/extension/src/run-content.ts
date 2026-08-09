// 사이트 ↔ 확장 다리 — "이 절차를 돌려줘".
//
// 사이트 스크립트는 chrome.runtime 에 직접 닿을 수 없다(격리된 세계). 그래서
// 사이트는 window.postMessage 로 말하고 이 스크립트가 옮긴다.
//
// **사람이 버튼을 눌러야만 시작한다.** 스스로 시작하는 길은 없다 — 바꾸는
// 조작이 든 절차를 사람 모르게 돌리면 틀렸다는 걸 아는 시점이 실행 뒤다.
//
// content.ts 와 동일하게 import 문 금지 (classic script 주입).

(() => {
  window.addEventListener('message', (e) => {
    // 같은 창이 보낸 것만 받는다. iframe 이나 다른 오리진이 절차를 돌리게 할
    // 이유가 없다 — 이 다리는 사이트의 버튼 하나를 위해서만 있다.
    if (e.source !== window || !e.data || e.data.__na !== 'run') return;

    try {
      chrome.runtime.sendMessage({ type: 'START_RUN', run: e.data.run }, (res) => {
        window.postMessage(
          {
            __na: 'run-ack',
            ok: !chrome.runtime.lastError && res?.ok === true,
            error: chrome.runtime.lastError?.message ?? res?.error ?? null,
          },
          '*',
        );
      });
    } catch {
      window.postMessage({ __na: 'run-ack', ok: false, error: '확장에 닿지 못했어' }, '*');
    }
  });

  // 진행 상황을 사이트가 물을 수 있게 한다. 절차가 도는 동안 화면이 조용하면
  // 멈춘 건지 도는 건지 알 수 없다.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__na !== 'run-status') return;
    try {
      chrome.runtime.sendMessage({ type: 'RUN_STATUS' }, (res) => {
        window.postMessage({ __na: 'run-status-ack', run: res?.run ?? null }, '*');
      });
    } catch {
      window.postMessage({ __na: 'run-status-ack', run: null }, '*');
    }
  });
})();
