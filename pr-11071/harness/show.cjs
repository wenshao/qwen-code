const r=require(require('path').resolve(process.argv[2]));
console.log('=== '+r.arm+' / '+r.scenario+(r.error?' ERROR '+r.error.split('\n')[0]:''));
for (const s of r.steps){ const {t,label,...rest}=s;
  const c=rest.control; if (c) rest.control={sel:c.selection&&(c.selection.names||c.selection.mode),tr:c.transition,workers:c.workers.map(w=>`${w.ws}:${w.channels}:${w.pid}:${w.alive?'alive':'dead'}`)};
  if (rest.settingsA) rest.settingsA={channels:Object.keys(rest.settingsA.channels||{}),serve:rest.settingsA.serve};
  console.log('## '+label+' @'+t+'  '+JSON.stringify(rest).slice(0,900)); }
