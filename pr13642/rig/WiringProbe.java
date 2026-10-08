package com.alibaba.qwen.code.managedagent.probe;

import javax.sql.DataSource;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;

/** Reads the real Spring beans ToolPublicationConfiguration injects into ToolPublicationStore. */
@Component
public class WiringProbe implements ApplicationRunner {
    private final ApplicationContext context;

    public WiringProbe(ApplicationContext context) {
        this.context = context;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        DataSource source = context.getBean(DataSource.class);
        JdbcTemplate jdbc = context.getBean(JdbcTemplate.class);
        PlatformTransactionManager manager = context.getBean(PlatformTransactionManager.class);
        Object bindings = context.getBean(Class.forName("com.alibaba.qwen.code.runtimebroker.RuntimeBindingRepository"));
        Object executions = context.getBean(Class.forName("com.alibaba.qwen.code.runtimebroker.ToolExecutionRepository"));
        boolean bindingsUse = (boolean) bindings.getClass().getMethod("usesDataSource", DataSource.class).invoke(bindings, source);
        boolean executionsUse = (boolean) executions.getClass().getMethod("usesDataSource", DataSource.class).invoke(executions, source);
        System.out.println("PROBE dataSource=" + source.getClass().getName()
                + " | jdbcTemplate.getDataSource()==dataSource: " + (jdbc.getDataSource() == source)
                + " | txManager=" + manager.getClass().getSimpleName()
                + " txManager.getDataSource()==dataSource: " + (manager instanceof DataSourceTransactionManager m && m.getDataSource() == source)
                + " | bindings=" + bindings.getClass().getSimpleName() + ".usesDataSource: " + bindingsUse
                + " | executions=" + executions.getClass().getSimpleName() + ".usesDataSource: " + executionsUse);
    }
}
