import { defineConfig } from 'drizzle-kit';

// 주의: 이 설정으로 `drizzle-kit generate`/`push` 를 실행해 마이그레이션을
// 만들지 않는다. 마이그레이션의 유일한 진실은
// supabase/migrations/*.sql (Supabase CLI) 이다.
// 이 파일은 drizzle-kit studio 등 쿼리 레이어 개발 도구를 쓰기 위한
// 참고용 설정일 뿐이다.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './.drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
