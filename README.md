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
