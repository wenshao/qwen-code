// VERIFICATION RIG ONLY: summarize surefire XML for one (variant, mutation) run.
import fs from 'node:fs';
const [variant, mutation, rc, dir, log, suite] = process.argv.slice(2);
const out = { variant, mutation, suite, rc: Number(rc), tests: 0, failures: 0, errors: 0, skipped: 0, failed: [] };
if (!fs.existsSync(dir)) {
  const text = fs.readFileSync(log, 'utf8');
  out.state = /COMPILATION ERROR/.test(text) ? 'COMPILE_ERROR' : 'NO_REPORT';
} else {
  for (const f of fs.readdirSync(dir).filter((n) => n.startsWith('TEST-') && n.endsWith('.xml'))) {
    const xml = fs.readFileSync(`${dir}/${f}`, 'utf8');
    const head = xml.match(/<testsuite [^>]*>/)[0];
    for (const k of ['tests', 'failures', 'errors', 'skipped']) out[k] += Number(head.match(new RegExp(` ${k}="(\\d+)"`))?.[1] ?? 0);
    const cls = head.match(/ name="([^"]+)"/)[1].split('.').pop();
    for (const m of xml.matchAll(/<testcase name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const body = m[3] ?? '';
      if (/<(failure|error)[ >]/.test(body)) {
        const name = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        out.failed.push(suite === 'full' ? `${cls}.${name}` : name);
      }
    }
  }
  out.state = out.failures + out.errors === 0 ? 'GREEN' : 'RED';
}
console.log('RESULT ' + JSON.stringify(out));
