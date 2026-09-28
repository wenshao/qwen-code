// Production mutants for the bundled Hosted Harness (dist/chunks/server-AFMNU4MZ.js).
module.exports = {
  P1: { what: 'Harness waits for Runtime readiness before inference (serial provisioning)', edits: [
    [':void 0;let state="completed";let stopReason="end_turn";try{const result=await runHostedHarnessTextTurn(',
     ':void 0;await toolTurn?.warmed;let state="completed";let stopReason="end_turn";try{const result=await runHostedHarnessTextTurn('] ] },
  P2: { what: 'Provisioning starts only when the first tool call arrives (lazy warm)', edits: [
    ['this.warmed=this.broker.warm();void this.warmed.catch(()=>void 0)}', '}'],
    ['await Promise.race([this.warmed,', 'await Promise.race([this.warmed??=this.broker.warm(),'] ] },
  P3: { what: 'Tool dispatch does not wait for Runtime readiness', edits: [
    ['await Promise.race([this.warmed,', 'await Promise.race([Promise.resolve(),'] ] },
  P4: { what: 'Continuation drops the original model context', edits: [
    ['request2=await input.toolTurn.execute(calls,parts,config.getModel(),input.signal)}',
     'request2=await input.toolTurn.execute(calls,parts,config.getModel(),input.signal);client.getChat().setHistory([])}'] ] },
  P5: { what: 'Tool execution is started twice', edits: [
    ['const result=await this.broker.execute(executionCallId,request2.payloadJson,signal,request2.isShell?Number(request2.input["timeout"]??12e4)+6e4:void 0)',
     'await this.broker.execute(executionCallId,request2.payloadJson,signal,request2.isShell?Number(request2.input["timeout"]??12e4)+6e4:void 0);const result=await this.broker.execute(executionCallId,request2.payloadJson,signal,request2.isShell?Number(request2.input["timeout"]??12e4)+6e4:void 0)'] ] },
  I1: { what: 'IMPROVEMENT: render the text part of a tool-call assistant record as visible text', edits: [
    ['if(message.type==="tool_result"||message.message?.parts?.some(part=>part.functionCall)){',
     'if(message.type==="tool_result"||message.message?.parts?.some(part=>part.functionCall)&&!text){'] ] },
  I2: { what: 'IMPROVEMENT: I1 + commit the pre-tool assistant text before waiting for readiness', edits: [
    ['if(message.type==="tool_result"||message.message?.parts?.some(part=>part.functionCall)){',
     'if(message.type==="tool_result"||message.message?.parts?.some(part=>part.functionCall)&&!text){'],
    ['let onAbort=__name(()=>void 0,"onAbort");try{await Promise.race([this.warmed',
     'const earlyMessageId=await this.commit("assistant",parts,model);let onAbort=__name(()=>void 0,"onAbort");try{await Promise.race([this.warmed'],
    ['const messageId=await this.commit("assistant",parts,model)', 'const messageId=earlyMessageId'] ] },
};
