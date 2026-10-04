// usage: node sum.js <result.json...>  — compact per-run summary
for (const f of process.argv.slice(2)) {
  let r; try { r = require(require('path').resolve(f)); } catch (e) { console.log(f, 'UNREADABLE', String(e).slice(0, 80)); continue; }
  const loads = (r.loadReplies || []).map((l) => `${l.status}${l.dropped ? '(dropped)' : ''}${l.identicalToDropped === true ? '=' : l.identicalToDropped === false ? '≠' : ''}${l.status !== 200 && !l.dropped ? ':' + ((/"code":"([a-z_]+)"/.exec(l.body) || [])[1] || '') : ''}`).join(' ');
  const brokerB = (r.harnessBToBroker || []).map((l) => { const m = / (GET|POST) \/internal\/runtime-broker\/v1\/([^ ?#]+)[^ ]* #\d+ -> (\S+)/.exec(l); return m ? `${m[2].replace(/tool-sessions\/[^/:]+/, 'ts').replace(/executions\/[^/:?]+/, 'ex')}=${m[3]}${m[3] !== '200' ? ':' + ((/"code":"([a-z_]+)"/.exec(l) || [])[1] || '') : ''}` : l.slice(0, 60); }).join(' ');
  console.log(JSON.stringify({
    label: r.label, terminal: r.terminal, msReadyToTerminal: r.msReplacementReadyToTerminal,
    turn: (r.after?.turn || []).join('/'), exec: (r.after?.executions || []).map((e) => e.slice(1).join('/')).join(';'),
    model: `${r.after?.modelRequestsInitial}+${r.after?.modelRequestsWithToolResult}`, fsAfterCrash: r.after?.fsEventsAfterCrash,
    text: r.after?.publicText, leaseAfterTurn: r.after?.lease, loads, counters: { loads: r.counters?.loads, continues: r.counters?.continues, cancels: r.counters?.cancels, starts: r.counters?.replacementStarts, acquires: r.counters?.acquires, acquireFails: r.counters?.acquireFails },
    second: r.secondSessionOnSameWorkspace ? `${r.secondSessionOnSameWorkspace.terminal} lease=${r.secondSessionOnSameWorkspace.leaseAfter}` : null,
    brokerB,
    probe: r.probe ? { concurrent: r.probe.concurrentRedrives?.map((c) => `${c.status}${c.identicalToDropped ? '=' : '≠'}`), plain: r.probe.plainLoad?.status + ':' + ((/"code":"([a-z_]+)"/.exec(r.probe.plainLoad?.body || '') || [])[1] || ''), create: r.probe.create?.status + ':' + ((/"code":"([a-z_]+)"/.exec(r.probe.create?.body || '') || [])[1] || ''), err: r.probe.error, acq: r.probe.acquiresAfterProbe, starts: r.probe.startsAfterProbe } : undefined,
    watermark: (() => { const ls = (r.loadReplies || []).filter((l) => l.status === 200); const d = ls.find((l) => l.dropped); if (!d) return undefined; const strip = (b) => { try { const o = JSON.parse(b); const w = o.lastEventId; delete o.lastEventId; return [JSON.stringify(o), w]; } catch { return [b, null]; } }; const [db, dw] = strip(d.body); return ls.filter((l) => !l.dropped).map((l) => { const [b, w] = strip(l.body); return `${b === db ? "same-except-lastEventId" : "DIFFERENT"} ${dw}->${w}`; }); })(),
    acquireReplies: (r.brokerAcquireReplies || []).map((a) => { try { const o = JSON.parse(a.body); return `${a.status} rs=${String(o.runtimeSessionId).slice(0, 8)} acq=${o.acquired} bind=${o.runtime ? String(o.runtime.bindingId).slice(0, 8) + "/g" + o.runtime.generation : "-"}`; } catch { return `${a.status} ${a.body.slice(0, 60)}`; } }),
    stderr: (r.harnessBStderr || []).map((s) => s.slice(0, 160)),
  }));
}
