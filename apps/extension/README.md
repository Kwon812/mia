# @na/extension

Project NA 크롬 확장 (MV3). 브라우징 활동을 관찰해 세션화하고 서버로 전송한다.

## 빌드

```
npm run build -w @na/extension
```

`dist/` 가 생성된다. `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드합니다" 에서 `apps/extension/dist` 폴더를 선택한다.

## 알람 구조

`sessionCheck`(1분) · `compress`(5분) · `retry`(10분) · `diary`(매일 새벽 3시) — 서비스 워커는 30초 유휴 시 종료되므로 `setInterval` 대신 `chrome.alarms` + IndexedDB(Dexie)로 상태를 유지한다.
