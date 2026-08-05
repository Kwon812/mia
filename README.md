# Project NA

현실의 나를 통해 성장하는 AI 육성 게임. 브라우저 활동을 관찰해 세션 → 경험 → 기억으로 압축하고, 그걸 먹고 자라는 캐릭터를 키운다. 설계는 `docs/na-plan.html` 참고.

## 구조 (npm workspaces)

| 경로 | 패키지 | 역할 |
|---|---|---|
| `apps/web` | `@na/web` | 사이트 + API Route Handlers — Next.js, Vercel 배포 |
| `apps/extension` | `@na/extension` | 크롬 확장(MV3) — Vite + Dexie, 수집·압축·세션화 |
| `apps/batch` | `@na/batch` | 야간 배치 — Render Cron(`render.yaml`), 일기·성격·레벨 |
| `packages/db` | `@na/db` | Drizzle 스키마 + 클라이언트 (쿼리 레이어) |
| `packages/shared` | `@na/shared` | Zod 검증 스키마, 공용 타입 |
| `supabase/` | — | **DDL 의 진실.** SQL 마이그레이션 (drizzle-kit 으로 생성 금지) |

## 시작하기

```bash
npm install
cp .env.example ..env.local        # Supabase 키 채우기
npx supabase start                # 로컬 DB (Docker) — 마이그레이션 자동 적용
npm run dev                       # 사이트 http://localhost:3000
npm run build -w @na/extension    # 확장 빌드 → apps/extension/dist 를 chrome://extensions 에 로드
```

호스팅 Supabase 사용 시: `npx supabase link --project-ref <ref> && npx supabase db push`

## 검증

```bash
npm run typecheck   # 전 워크스페이스
npm run build       # 전 워크스페이스
npm run lint
```

## 배포 리전

`apps/web/vercel.json` 이 함수 리전을 `icn1`(서울)로 고정한다. Supabase 가
`ap-northeast-2`(서울)에 있어서 함수가 다른 대륙에서 돌면 쿼리마다 태평양을
왕복한다 — 기본값(`iad1`, 워싱턴DC)일 때 홈 화면의 순차 왕복 4번이 800ms 넘게
들었다. 함수와 DB는 같은 리전에 둔다.

Next 16 에서 `preferredRegion` 라우트 설정은 deprecated 라 `vercel.json` 으로
지정한다. Vercel 프로젝트(`mia-web`)의 Root Directory 가 `apps/web` 이라
`vercel.json` 도 거기 있어야 읽힌다 (Vercel 대시보드 Project Settings → Functions 에서도 같은 값을 바꿀 수 있다).
