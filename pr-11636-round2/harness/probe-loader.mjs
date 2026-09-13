// Node loader: two disclosed injections into the daemon's own compiled
// live-task-service.js. Neither touches the code under test
// (`eventWakeReason` / the background-terminal guard in `waitForTarget`).
//  1. capture the LiveTaskService instance the daemon builds, so the probe can
//     call the very same object the Live Voice host would reach over ACP;
//  2. skip the Live-caller authorization check, which the probe cannot satisfy
//     without a Live Voice host process.
const CTOR_FROM = `    constructor(options) {
        this.options = options;
    }`;
const CTOR_TO = `    constructor(options) {
        this.options = options;
        globalThis.__probeLTS = this;
    }`;
const AUTH_FROM = `    async assertLiveCaller(callerSessionId) {
`;
const AUTH_TO = `    async assertLiveCaller(callerSessionId) {
        if (globalThis.__probeBypassLiveCaller) return;
`;

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.includes('live-task-service')) {
    process._rawDebug('[probe-loader] saw', url, 'hasSource', typeof result.source);
  }
  if (!url.endsWith('/serve/live/live-task-service.js')) return result;
  const src = String(result.source ?? '');
  if (!src.includes(CTOR_FROM) || !src.includes(AUTH_FROM)) {
    throw new Error('probe-loader: anchors not found in live-task-service.js');
  }
  return {
    ...result,
    source: src.replace(CTOR_FROM, CTOR_TO).replace(AUTH_FROM, AUTH_TO),
  };
}
