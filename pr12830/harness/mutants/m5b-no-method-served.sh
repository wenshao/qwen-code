bash $SCRATCH/mut/m5-automations-no-method.sh $1
cat > $1/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/ProbeServedTest.java <<'JAVA'
package com.alibaba.qwen.code.managedagent;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:probe;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "qwen.managed-agent.harness.enabled=false"})
@AutoConfigureMockMvc
@Import(ManagedAgentServerIntegrationTest.FixtureConfiguration.class)
class ProbeServedTest {
    @Autowired
    private MockMvc mvc;

    @Test
    void methodlessMappingAnswersEveryMethod() throws Exception {
        mvc.perform(get("/v1/agent-automations")).andExpect(status().isOk())
                .andExpect(content().string("probe"));
        mvc.perform(delete("/v1/agent-automations")).andExpect(status().isOk())
                .andExpect(content().string("probe"));
    }
}
JAVA
