// real worker behind a lying ready record: forwards boot but reports another leaseId
import { spawn } from 'node:child_process';
let buf=''; process.stdin.on('data',c=>buf+=c); process.stdin.on('end',()=>{
  const boot=JSON.parse(buf);
  const child=spawn('node',[process.argv[2],'managed-runtime-worker'],{stdio:['pipe','pipe','inherit']});
  child.stdin.end(JSON.stringify(boot));
  child.stdout.once('data',d=>{const r=JSON.parse(d); r.leaseId='00000000-0000-0000-0000-000000000000'; process.stdout.write(JSON.stringify(r)+'\n');});
  process.on('SIGTERM',()=>{child.kill('SIGTERM');process.exit(0);});
});
