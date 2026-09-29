const P = 'src/main/java/com/alibaba/qwen/code/runtimebroker/';
export default [
  { id: 'M21', what: 'page read failure swallowed: scan returns the context (the resilience wrap R1-18 warns about)', file: P + 'RuntimeBrokerService.java',
    find: '        List<ToolExecutionRecord> batch = executionRepository.findUnsettled(\n                session, afterExecutionCallId, 100);\n',
    rep: '        List<ToolExecutionRecord> batch;\n        try {\n            batch = executionRepository.findUnsettled(session, afterExecutionCallId, 100);\n        } catch (RuntimeException swallowed) {\n            return CompletableFuture.completedFuture(context);\n        }\n' },
];
