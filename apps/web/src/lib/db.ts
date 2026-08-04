import 'server-only';

import { createDb, type Db } from '@na/db';

// 서버리스(Vercel) 환경에서는 요청마다 모듈이 새로 평가되는 게 아니라
// 같은 컨테이너가 여러 요청을 재사용한다. 그런데 Next dev/HMR 환경에서는
// 모듈이 다시 로드될 수 있으므로, globalThis 에 캐시해 재요청/핫리로드마다
// 새 postgres 커넥션 풀이 생기는 것을 막는다.
const globalForDb = globalThis as unknown as { __naDb?: Db };

export const db: Db = globalForDb.__naDb ?? createDb();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__naDb = db;
}
