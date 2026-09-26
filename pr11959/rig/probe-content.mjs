// Direct probe: how does an endpoint treat string vs array vs image content?
// usage: node probe-content.mjs <envKeyName> <baseUrl> <model>
import { readFileSync } from 'node:fs';
const [keyName, baseUrl, model] = process.argv.slice(2);
const s = JSON.parse(readFileSync(process.env.HOME + '/.qwen/settings.json', 'utf8'));
const key = s.env[keyName];
const png = readFileSync(new URL('./red.png', import.meta.url)).toString('base64');
const variants = {
  string: 'Reply with the single word: ok',
  'array-text': [{ type: 'text', text: 'Reply with the single word: ok' }],
  'array-image': [{ type: 'text', text: 'What color is this image? One word.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }],
};
for (const [name, content] of Object.entries(variants)) {
  const body = { model, max_tokens: 64, messages: [{ role: 'user', content }], stream: false };
  const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let summary = text.slice(0, 260);
  try { const j = JSON.parse(text); summary = j.error ? 'ERROR ' + JSON.stringify(j.error).slice(0, 240) : 'reply=' + JSON.stringify(j.choices?.[0]?.message?.content).slice(0, 80); } catch {}
  console.log(JSON.stringify({ model, variant: name, status: res.status, summary: summary.replaceAll(key, '<redacted>') }));
}
