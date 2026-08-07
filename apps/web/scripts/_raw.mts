import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local', 'utf8');
const g = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'));
const { data, error } = await sb.storage.from('na-raw').list('raw', { limit: 10 });
console.log('users:', error ?? data?.map((d) => d.name));
if (data?.[0]) {
  const u = data[0].name;
  const days = await sb.storage.from('na-raw').list(`raw/${u}`, { limit: 10 });
  console.log('days:', days.data?.map((d) => d.name));
  const d0 = days.data?.[0]?.name;
  if (d0) {
    const files = await sb.storage.from('na-raw').list(`raw/${u}/${d0}`, { limit: 20 });
    console.log('files:', files.data?.map((f) => `${f.name} ${f.metadata?.size}B`));
  }
}
process.exit(0);
