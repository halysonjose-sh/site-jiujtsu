import { spawnSync } from 'node:child_process'
// Only an already-running, disposable local Supabase is accepted.
const status = spawnSync(
  process.execPath,
  ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'],
  { encoding: 'utf8' },
)
if (status.status !== 0) {
  console.error(
    'Supabase local indisponível. Inicie o Docker Desktop, execute npx supabase start e npx supabase db reset antes deste teste.',
  )
  process.exit(1)
}
const values = Object.fromEntries(
  [...status.stdout.matchAll(/^([A-Z_]+)="(.*)"$/gm)].map((m) => [m[1], m[2]]),
)
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.supabase.config.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LOCAL_SUPABASE_URL: values.API_URL,
      LOCAL_SUPABASE_ANON_KEY: values.ANON_KEY,
      LOCAL_SUPABASE_SERVICE_KEY: values.SERVICE_ROLE_KEY,
      LOCAL_DB_URL: values.DB_URL,
    },
  },
)
process.exit(result.status ?? 1)
