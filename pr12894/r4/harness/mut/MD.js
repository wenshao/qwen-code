const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const from="if (stream === 'stderr') stderrTail?.add(data);";
if(!s.includes(from))throw new Error('pattern not found');
fs.writeFileSync(f,s.replace(from,"if (stream === 'stdout') stderrTail?.add(data);"));
