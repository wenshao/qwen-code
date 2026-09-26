package com.alibaba.qwen.code.runtimebroker;

import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;

final class ScaleProbeSupport {
    private ScaleProbeSupport() {
    }

    static DataSource dataSource() {
        String mysql = System.getProperty("probe.mysql.url");
        if (mysql != null && !mysql.isBlank()) {
            return new DriverManagerDataSource(mysql,
                    System.getProperty("probe.mysql.user", "root"),
                    System.getProperty("probe.mysql.password", ""));
        }
        JdbcDataSource h2 = new JdbcDataSource();
        h2.setURL("jdbc:h2:file:" + System.getProperty("probe.h2.file")
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE");
        return h2;
    }

    static Map<String, BigDecimal> cases() {
        Map<String, BigDecimal> cases = new LinkedHashMap<>();
        cases.put("scale 2048: 0.1{2048}",
                new BigDecimal("0." + "1".repeat(2048)));
        cases.put("scale 2049: 0.1{2049}",
                new BigDecimal("0." + "1".repeat(2049)));
        cases.put("scale 2049: 0.5 setScale(2049)",
                new BigDecimal("0.5").setScale(2049));
        cases.put("scale 3001: 1E-3001",
                new BigDecimal("1E-3001"));
        cases.put("scale 32768: 1E-32768",
                new BigDecimal("1E-32768"));
        cases.put("scale -100000: 1E+100000",
                new BigDecimal("1E+100000"));
        return cases;
    }

    static String describe(Object read, BigDecimal expected) {
        if (read == null) {
            return "null";
        }
        BigDecimal value;
        if (read instanceof BigDecimal decimal) {
            value = decimal;
        } else if (read instanceof BigInteger integer) {
            value = new BigDecimal(integer);
        } else if (read instanceof Number number) {
            value = new BigDecimal(number.toString());
        } else {
            return "non-number " + read.getClass().getSimpleName();
        }
        if (value.compareTo(expected) == 0) {
            return "equal";
        }
        return "WRONG value " + value.stripTrailingZeros().toString();
    }

    static String failure(Throwable error) {
        Throwable actual = error;
        while (actual.getCause() != null
                && !(actual instanceof com.alibaba.fastjson2.JSONException)
                && !(actual instanceof IllegalArgumentException)) {
            actual = actual.getCause();
        }
        String message = String.valueOf(actual.getMessage());
        if (message.length() > 60) {
            message = message.substring(0, 60) + "...";
        }
        return "THROWS " + actual.getClass().getSimpleName() + ": " + message;
    }

    static synchronized void emit(String kind, String caseName, String step,
            String outcome) {
        String line = "PROBE|" + System.getProperty("probe.arm") + "|"
                + System.getProperty("probe.db") + "|" + kind + "|"
                + caseName + "|" + step + "|" + outcome;
        System.out.println(line);
        String out = System.getProperty("probe.out");
        if (out != null) {
            try (PrintWriter writer = new PrintWriter(
                    new FileWriter(out, true))) {
                writer.println(line);
            } catch (IOException ignored) {
                // stdout still carries the line
            }
        }
    }
}
