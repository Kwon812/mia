export * from './schema';

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

// Supabase Transaction Pooler(6543) 는 prepared statement 미지원 → prepare: false
export function createDb(url: string = process.env.DATABASE_URL!) {
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
