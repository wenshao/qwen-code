package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.store.PublicationObjectProbeSupport;
import com.alibaba.qwen.code.managedagent.store.PublicationRecoveryProbeSupport;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Verification-only (not part of the PR). The repository's committed foreground-capture flow on a real
 * MySQL/MariaDB schema, then production retirement and the production O4-2 collector (round-3 probe),
 * then publicationObject() reads of every catalogued object.
 */
class PublicationObjectProbe {
    @Test
    void probe() {
        String url = System.getProperty("mysql.url");
        String user = System.getProperty("mysql.user");
        String password = System.getProperty("mysql.password", "");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "probe_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE DATABASE " + schema);
        DataSource source = new DriverManagerDataSource(url.replaceFirst("/[^/?]+(?=\\?|$)", "/" + schema), user, password);
        try {
            var fixture = new ToolPublicationStoreTest() {
                @Override
                DataSource publicationDataSource() {
                    return source;
                }
            };
            fixture.setup();
            fixture.publishesImmutableSegmentAndResourceUnderOriginalAuthorization("intact");
            for (String line : PublicationObjectProbeSupport.read(source, "tenant-1", "workspace-1", "session-1")) {
                System.out.println("PROBE before " + line);
            }
            for (String line : PublicationRecoveryProbeSupport.run(source, "tenant-1", "workspace-1", "session-1")) {
                System.out.println("PROBE " + line);
            }
            for (String line : PublicationObjectProbeSupport.read(source, "tenant-1", "workspace-1", "session-1")) {
                System.out.println("PROBE after " + line);
            }
        } finally {
            admin.execute("DROP DATABASE " + schema);
        }
    }
}
