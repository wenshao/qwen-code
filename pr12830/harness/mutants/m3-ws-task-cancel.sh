mkdir -p $1/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/probe
cat > $1/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/probe/ProbeController.java <<'JAVA'
package com.alibaba.qwen.code.managedagent.probe;

import org.springframework.web.bind.annotation.*;

@RestController
public class ProbeController {
    @PostMapping("/api/agent/web-shell/v1/tasks/cancel")
    public String probe() {
        return "probe";
    }
}
JAVA
