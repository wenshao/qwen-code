const fs=require('fs');const f='JdbcRuntimeBindingRepository.java';let s=fs.readFileSync(f,'utf8');
const a1=`            // of the lock silently reopens the race, and H2 would not show it.
            RuntimeSessionRecord current = JdbcRuntimeSessionRepository.selectSession(`;
const n1=`            // of the lock silently reopens the race, and H2 would not show it.
            // MUTANT M2: the execution read hoisted ahead of the locking read.
            boolean active = JdbcToolExecutionRepository.hasActiveByRuntimeSession(connection,
                    expected.getBindingId(), expected.getRuntimeGeneration(),
                    expected.getRuntimeSessionId());
            RuntimeSessionRecord current = JdbcRuntimeSessionRepository.selectSession(`;
const a2=`            if (JdbcToolExecutionRepository.hasActiveByRuntimeSession(connection,
                    current.getBindingId(), current.getRuntimeGeneration(),
                    current.getRuntimeSessionId())) {
                throw new RuntimeBrokerException(409, "runtime_session_busy",`;
const n2=`            if (active) {
                throw new RuntimeBrokerException(409, "runtime_session_busy",`;
for (const [a] of [[a1],[a2]]) { const c=s.split(a).length-1; if(c!==1) throw new Error('anchor count '+c); }
s=s.replace(a1,n1).replace(a2,n2); fs.writeFileSync(f,s); console.log('M2 applied');
