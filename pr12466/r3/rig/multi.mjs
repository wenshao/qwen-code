const [port, arm, ...scns] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`; const H = { authorization: 'Bearer tok12466', 'content-type': 'application/json' };
const j = async (m, p, b) => (await fetch(base + p, { method: m, headers: H, body: b && JSON.stringify(b) })).json().catch(() => ({}));
const s = await j('POST', '/session', { cwd: `/private/var/tmp/pr12466/${arm}/ws`, sessionScope: 'thread' });
const id = s.sessionId;
for (const scn of scns) {
  await j('POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text: `SCN:${scn} multi-${arm}` }] });
  await new Promise((r) => setTimeout(r, 1500));
  for (let i = 0; i < 80; i++) { const st = await j('GET', `/session/${id}/status`); if (st.hasActivePrompt === false) break; await new Promise((r) => setTimeout(r, 500)); }
}
console.log(arm, id);
