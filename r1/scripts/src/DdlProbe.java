package com.alibaba.qwen.code.runtimebroker;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

public final class DdlProbe {
    public static void main(String[] args) throws Exception {
        String[] variants = {
            "CREATE TABLE ddl_a (id VARCHAR(512) PRIMARY KEY) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin",
            "CREATE TABLE ddl_b (id VARCHAR(512) PRIMARY KEY) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
            "CREATE TABLE ddl_c (id VARCHAR(512) COLLATE utf8mb4_bin PRIMARY KEY)",
            "CREATE TABLE ddl_d (id VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY)",
        };
        try (Connection c = SimpleDs.of(args[0]).getConnection();
                Statement s = c.createStatement()) {
            for (String ddl : variants) {
                String table = ddl.substring(13, 18);
                try {
                    s.execute("DROP TABLE IF EXISTS " + table);
                    s.execute(ddl);
                    s.execute("INSERT INTO " + table + " VALUES ('Abc')");
                    String second;
                    try {
                        s.execute("INSERT INTO " + table + " VALUES ('abc')");
                        second = "case-sensitive (Abc and abc coexist)";
                    } catch (Exception dup) {
                        second = "STILL case-insensitive";
                    }
                    System.out.printf("[%s] ACCEPTED %-24s %s%n", args[1], second, ddl.substring(19));
                } catch (Exception failure) {
                    System.out.printf("[%s] REJECTED %-24s %s%n", args[1], "", ddl.substring(19));
                }
            }
        }
    }
}
