// apply-cand.cjs <tree>  -- the review thread R1-1 suggestion, applied as written:
// when the final owner release is refused with 503 runtime_reconciliation_required,
// acquire the owner once (the Broker adopts the Session) and release again.
const fs = require('fs');
const p = process.argv[2] + '/packages/cli/src/serve/hosted-mcp-session.ts';
let t = fs.readFileSync(p, 'utf8');
const find = `        releaseState: 'drained',
      });
    }
    await this.broker.release();
    await this.markReleased(configurations);
  }`;
if (t.split(find).length !== 2) throw new Error('anchor not unique');
t = t.replace(find, `        releaseState: 'drained',
      });
    }
    try {
      await this.broker.release();
    } catch (cause) {
      // A replaced Broker no longer holds this Session in memory; acquiring adopts it.
      if (
        !(cause instanceof HostedWorkspaceBrokerRejection) ||
        cause.status !== 503 ||
        cause.code !== 'runtime_reconciliation_required'
      )
        throw cause;
      await this.acquireOwner();
      await this.broker.release();
    }
    await this.markReleased(configurations);
  }`);
fs.writeFileSync(p, t);
console.log('candidate applied');
