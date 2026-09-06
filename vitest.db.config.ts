import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    maxWorkers: 1,
  },
})
