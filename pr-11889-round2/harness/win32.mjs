// Makes this process report Windows. Loaded with --import, i.e. after node's
// own bootstrap has already picked the posix `path` implementation, so only
// runtime `process.platform` reads (the ones the store's gate performs) see it.
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
