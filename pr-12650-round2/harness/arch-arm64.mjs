// Simulate an unsupported-architecture host (e.g. linux/arm64) for scripts/lint.js only:
// vitest/rollup keep seeing the real x64 so their native bindings still load.
const real = process.arch;
Object.defineProperty(process, 'arch', {
  get() { return new Error().stack.includes('/scripts/lint.js') ? 'arm64' : real; },
});
