// Preload (node --import) for the READER process only. It does not touch the
// store's code: after an lstat of a segment directory reports ENOENT, the
// reader sleeps READER_DELAY_MS before continuing, i.e. it is descheduled
// between two syscalls. The writer runs unmodified in another process.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');
const delay = Number(process.env.READER_DELAY_MS ?? 5);
const original = fsp.lstat;
globalThis.__injected = 0;
fsp.lstat = async function (...args) {
  try {
    return await original.apply(this, args);
  } catch (error) {
    if (error?.code === 'ENOENT' && new RegExp(process.env.READER_DELAY_PATTERN ?? 'segment-\\d{5}$').test(String(args[0]))) {
      globalThis.__injected++;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw error;
  }
};
syncBuiltinESMExports();
