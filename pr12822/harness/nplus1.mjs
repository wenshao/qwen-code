// Create N Sessions in one tenant, then time GET /v1/agents/sessions?limit=100.
const [base, tenant, n, mode] = process.argv.slice(2);
const H = { 'X-Qwen-Tenant-Id': tenant, 'content-type': 'application/json', accept: 'application/json' };
if (mode === 'seed') {
  for (let i = 0; i < Number(n); i += 10) {
    await Promise.all(Array.from({ length: 10 }, (_, j) => fetch(`${base}/v1/agents/sessions`, { method: 'POST', headers: { ...H, 'Idempotency-Key': `seed-${i + j}` }, body: JSON.stringify({ agent_id: 'rig-agent', input: [] }) }).then((r) => r.status)));
  }
  console.log('seeded', n);
} else if (mode === 'once') {
  const r = await fetch(`${base}/v1/agents/sessions?limit=100`, { headers: H });
  const j = await r.json();
  console.log('listed', j.data.length);
} else {
  const times = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    const r = await fetch(`${base}/v1/agents/sessions?limit=100`, { headers: H });
    await r.json();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(`p50=${times[15].toFixed(1)}ms p90=${times[27].toFixed(1)}ms`);
}
