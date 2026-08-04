// classic script 로 주입된다 (manifest content_scripts, "type" module 아님).
// 반드시 import 문이 하나도 없어야 한다 — 모든 로직은 이 파일 안에서 자급자족한다.

(() => {
  let scrolls = 0;
  let clicks = 0;
  let keys = 0;

  document.addEventListener('scroll', () => scrolls++, { passive: true });
  document.addEventListener('click', () => clicks++, { passive: true });
  document.addEventListener('keydown', () => keys++, { passive: true });

  // content script 는 페이지 컨텍스트에서 계속 살아있으므로 setInterval 사용이
  // 안전하다 (서비스 워커에서는 절대 금지 — chrome.alarms 사용).
  setInterval(() => {
    if (scrolls === 0 && clicks === 0 && keys === 0) return;

    try {
      chrome.runtime.sendMessage({
        type: 'ACTIVITY',
        scrolls,
        clicks,
        keys,
        url: location.hostname,
      });
    } catch {
      // chrome.runtime 부재 또는 확장 컨텍스트 무효화(reload 등) 시 무시한다.
    }

    scrolls = 0;
    clicks = 0;
    keys = 0;
  }, 10000);
})();
