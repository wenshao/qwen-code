package com.alibaba.qwen.code.managedagent;

import java.nio.file.Path;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Local two-phase upgrade probe: phase 1 and phase 2 run in different builds. */
class UpgradeProbeMySqlIT {
    private static DataSource schema(boolean recreate) {
        String url = System.getProperty("mysql.url");
        String user = System.getProperty("mysql.user");
        String password = System.getProperty("mysql.password", "");
        String name = System.getProperty("probe.schema");
        if (recreate) {
            JdbcTemplate admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
            admin.execute("DROP DATABASE IF EXISTS " + name);
            admin.execute("CREATE DATABASE " + name);
        }
        return new DriverManagerDataSource(url.replaceFirst("/[^/?]+(?=\\?|$)", "/" + name), user, password);
    }

    @Test
    void phase1() throws Exception {
        DataSource source = schema(true);
        ToolPublicationStoreTest fixture = new ToolPublicationStoreTest() {
            @Override
            DataSource publicationDataSource() {
                return source;
            }
        };
        fixture.setup();
        fixture.upgradeProbePhase1(Path.of(System.getProperty("probe.state")));
    }

    @Test
    void phase2() throws Exception {
        ToolPublicationStoreTest.upgradeProbePhase2(schema(false), Path.of(System.getProperty("probe.state")),
                System.getProperty("probe.order"), Path.of(System.getProperty("probe.out")));
    }
}
