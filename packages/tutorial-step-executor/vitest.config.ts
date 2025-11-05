import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Use describe, it, expect without imports
    environment: 'node',
    testTimeout: 30000, // For integration tests that may take longer
    // Match test files
    include: ['**/*.{test,spec}.{ts,js}', '**/__tests__/**/*.{ts,js}'],
    // Exclude dist and node_modules
    exclude: ['node_modules', 'dist', '**/*.d.ts'],
  },
});

