package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.store.PublicationRecoveryProbeSupport;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Verification-only (not part of the PR). Runs the repository's own committed foreground-capture flow
 * (ToolPublicationStoreTest#publishesImmutableSegmentAndResourceUnderOriginalAuthorization("intact"):
 * segments, page, manifest, finish, admission, receipt with the manifest resource) on a real MySQL/MariaDB
 * schema, then the production retirement, O4-2 collector and recovery reader.
 */
class PublicationRecoveryProbe {
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
            for (String line : PublicationRecoveryProbeSupport.run(source, "tenant-1", "workspace-1", "session-1")) {
                System.out.println("PROBE " + line);
            }
            for (String line : PublicationRecoveryProbeSupport.demoteMarkerAndRead(source, "tenant-1", "workspace-1",
                    "session-1", "VERIFIED")) {
                System.out.println("PROBE " + line);
            }
        } finally {
            admin.execute("DROP DATABASE " + schema);
        }
    }
}
