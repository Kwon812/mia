# @na/batch

Project NA 야간 배치. 매일 새벽 3시(KST) 실행되어 일기 생성, 성격 축 재계산, 레벨/캐릭터 캐시 갱신, 무활동 thread 정리를 수행한다.

## 로컬 실행

```bash
DATABASE_URL=postgres://... npm start -w @na/batch
```

## 배포

Render 배포는 별도 서비스 설정 없이 루트의 `render.yaml` Blueprint 를 그대로 사용한다 (Render 대시보드에서 Blueprint 로 연결).
