const path=require("path");
const g=require.resolve("glob",{paths:["/Users/wenshao/pr13166-rig/wt-cand3/packages/core"]});
const {minimatch,Minimatch}=require(require.resolve("minimatch",{paths:[path.dirname(g)]}));
const [pat,n]=[process.argv[2],Number(process.argv[3])];
const name="a".repeat(n)+"c";
const re=new Minimatch(pat,{nocase:true,dot:true}).makeRe();
const t0=performance.now(); const r=minimatch(name,pat,{nocase:true,dot:true});
console.log(`${pat} n=${n} regex=${re.source.slice(0,60)} match=${r} ms=${Math.round(performance.now()-t0)}`);
