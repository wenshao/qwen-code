// Preload for the real bundled worker: models a worker wedged on SIGTERM (e.g. a stuck graceful
// shutdown). Installs a no-op SIGTERM listener and drops any SIGTERM listener the worker adds later.
process.on('SIGTERM', () => {});
for (const name of ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']) {
  const original = process[name].bind(process);
  process[name] = (event, listener) => (event === 'SIGTERM' ? process : original(event, listener));
}
