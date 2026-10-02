// s14: which statements a 16 MiB Shell publication and one full 16 MiB download issue (general_log, head vs base).
import * as L from './lib.mjs';
const ARM = process.env.ARM, SIZE = 16 * 1024 * 1024;
L.openLog(`s14-${ARM}`);
const on = () => L.sql("SET GLOBAL log_output='TABLE'; SET GLOBAL general_log='OFF'; TRUNCATE TABLE mysql.general_log; SET GLOBAL general_log='ON'", 'mysql');
const off = () => L.sql("SET GLOBAL general_log='OFF'", 'mysql');
const norm = (s) => s.replace(/^[\x00-\x20]+/, '').replace(/'(?:[^'\\]|\\.)*'/g, '?').replace(/\b\d+\b/g, '?').replace(/\s+/g, ' ').replace(/\(\?(?:, ?\?)+\)/g, '(?..)').slice(0, 120);
function top(label) {
  const rows = L.sql("SELECT REPLACE(REPLACE(CONVERT(argument USING utf8mb4), '\\n', ' '), '\\t', ' ') FROM mysql.general_log WHERE command_type IN ('Query','Execute') AND argument NOT LIKE '%general_log%'", 'mysql').map((r) => norm(r[0]));
  const m = new Map(); for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1);
  const list = [...m.entries()].sort((a, b) => b[1] - a[1]);
  L.say(label, { total: rows.length, perMiB: +(rows.length / 16).toFixed(1), top: list.slice(0, 14).map(([k, v]) => `${v} ${k}`) });
}
on();
const m = await L.makeOutput('breakdown', `ws-bd-${ARM}-${Date.now().toString(36)}`, process.env.ST ?? 'st-s58', L.genCmd(`bd${ARM}`, SIZE, 0, 0));
off(); top('write-16MiB');
const a = m.arts.find((x) => x.stream_role === 'stdout');
on();
const d = await L.streamDownload(m.session, a);
off(); top(`download-16MiB status=${d.status} sha=${d.sha256 === a.sha256}`);
