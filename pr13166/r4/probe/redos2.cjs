const path=require("path");
const g=require.resolve("glob",{paths:["/Users/wenshao/pr13166-rig/wt-cand3/packages/core"]});
const {minimatch,Minimatch}=require(require.resolve("minimatch",{paths:[path.dirname(g)]}));
const [pat,name]=[process.argv[2],process.argv[3]];
const re=new Minimatch(pat,{nocase:true,dot:true}).makeRe();
const t0=performance.now(); const r=minimatch(name,pat,{nocase:true,dot:true});
console.log(`${pat} name=${name} (${name.length}) regex=${re.source.slice(0,50)} match=${r} ms=${Math.round(performance.now()-t0)}`);
