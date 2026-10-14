import { mergeConfig } from 'vitest/config';
import base from './vitest.config';

export default mergeConfig(base, {
  test: {
    setupFiles: ['./pr14178-slow-fsync.setup.ts'],
  },
});
