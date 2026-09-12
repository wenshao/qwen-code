E=$(dirname $0)
count() { # bash processes descending from daemon pid $1
  node -e '
  const fs=require("fs"); const root=Number(process.argv[1]); const par={}; const comm={};
  for (const p of fs.readdirSync("/proc")) { if(!/^\d+$/.test(p)) continue; try { const st=fs.readFileSync(`/proc/${p}/stat`,"utf8"); const m=st.match(/^\d+ \((.*)\) \S+ (\d+)/); par[p]=Number(m[2]); comm[p]=m[1]; } catch {} }
  let n=0; for (const p of Object.keys(par)) { if (comm[p]!=="bash") continue; let q=Number(p); while (q>1) { q=par[q]; if (q===root) { n++; break; } } } console.log(n);' $1; }
HP=$(ss -ltnp | grep ':4411 ' | sed -E 's/.*pid=([0-9]+).*/\1/'); BP=$(ss -ltnp | grep ':4412 ' | sed -E 's/.*pid=([0-9]+).*/\1/')
echo "headDaemon=$HP baseDaemon=$BP"
echo "old-client->new-daemon: bash under head daemon before=$(count $HP)"
ARM=oldclient-newdaemon URL=http://localhost:5421 OUT=$E/out-legacy/oldclient-newdaemon SCEN=legacy node $E/e2e2.cjs
echo "old-client->new-daemon: bash under head daemon after=$(count $HP)"
echo "new-client->old-daemon: bash under base daemon before=$(count $BP)"
ARM=newclient-olddaemon URL=http://localhost:5422 OUT=$E/out-legacy/newclient-olddaemon SCEN=legacy node $E/e2e2.cjs
echo "new-client->old-daemon: bash under base daemon after=$(count $BP)"
echo LEGACY_DONE
