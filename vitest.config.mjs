import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['backup-file/**', 'nnnnew/**', 'release/**', 'node_modules/**', 'dist/**', 'scratch/**'],
    fileParallelism: false
  }
});
