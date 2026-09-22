const s = process.stdout; const orig = s.write.bind(s); let n = 0;
s.write = function (chunk, ...rest) { n++; const r = orig(chunk, ...rest); if (n <= 6 || n % 20 === 0) process._rawDebug(`[w#${n}] len=${chunk?.length} ret=${r} writableLength=${s.writableLength}`); return r; };
const t = setInterval(() => process._rawDebug(`[tick] writes=${n} errored=${!!s.errored}`), 1000); t.unref();
