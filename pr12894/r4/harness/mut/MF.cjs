const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const from='maxBufferedOutputBytes - previewHeadBytes - stderrTailBytes,';
if(!s.includes(from))throw new Error('pattern not found');
fs.writeFileSync(f,s.replace(from,'maxBufferedOutputBytes - previewHeadBytes,'));
