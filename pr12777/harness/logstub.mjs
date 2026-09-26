// Stands in for core's debugLogger.js, so each arm's "Failed to compile schema" line is captured.
globalThis.__logs ??= [];
const push = (level) => (...a) => globalThis.__logs.push(`[${level}] ${a.map(String).join(' ')}`);
export function createDebugLogger() { return { debug() {}, info() {}, warn: push('WARN'), error: push('ERROR') }; }
