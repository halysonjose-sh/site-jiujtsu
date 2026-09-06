import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['supabase/integration/**/*.test.ts'],
    environment: 'node',
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
