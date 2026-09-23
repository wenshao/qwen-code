const fs=require("fs");
const lead=c=>c.replace(/^\s*cd\s+\S+\s*&&\s*/,"").trim().split(/[\s;|&]+/)[0];
const RD=new Set(["cat","grep","rg","find","ls","head","tail","wc","sed","awk","tree","for","stat","file"]);
const out={};
for(const t of process.argv.slice(2)) for(const d of fs.readdirSync("runs/"+t)){const [arm,rep]=d.split("-");
 const cmds=[];let ded=0,ok=false;for(const l of fs.readFileSync(`runs/${t}/${d}/out.jsonl`,"utf8").split("\n")){try{const e=JSON.parse(l);if(e.type==="result")ok=e.subtype==="success";if(e.type==="assistant")for(const c of e.message.content)if(c.type==="tool_use"){if(c.name==="run_shell_command")cmds.push(c.input.command);if(["read_file","grep_search","glob","list_directory"].includes(c.name))ded++;}}catch{}}
 const k=`${t}/${arm}`;const a=out[k]??={n:0,ok:0,shell:0,readLed:0,runsWith:0,ded:0,leads:{}};a.n++;a.ok+=ok;a.shell+=cmds.length;a.ded+=ded;const r=cmds.filter(c=>RD.has(lead(c)));a.readLed+=r.length;a.runsWith+=r.length>0;for(const c of r)a.leads[lead(c)]=(a.leads[lead(c)]||0)+1;}
for(const[k,a] of Object.entries(out))console.log(k.padEnd(12),`n=${a.n} ok=${a.ok} dedicatedCalls=${a.ded} shellCalls=${a.shell} shellRead/List=${a.readLed} runsWithShellRead=${a.runsWith}/${a.n}`,JSON.stringify(a.leads));
