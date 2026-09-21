package com.alibaba.qwen.code.runtimebroker;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Calendar;
import java.util.TimeZone;

/** Tries clock-read candidates on one connection and reports skew vs the real clock. */
public final class FixProbe {
    public static void main(String[] args) throws Exception {
        SimpleDs ds = SimpleDs.of(args[0]);
        String label = args[1];
        String[][] candidates = {
            {"PR: CURRENT_TIMESTAMP + UTC calendar", "SELECT CURRENT_TIMESTAMP", "cal"},
            {"UTC_TIMESTAMP(6) + UTC calendar", "SELECT UTC_TIMESTAMP(6)", "cal"},
            {"CURRENT_TIMESTAMP(6) as OffsetDateTime", "SELECT CURRENT_TIMESTAMP(6)", "odt"},
            {"UNIX_TIMESTAMP(CURRENT_TIMESTAMP(6))", "SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(6))", "epoch"},
        };
        try (Connection connection = ds.getConnection();
                Statement statement = connection.createStatement()) {
            for (String[] candidate : candidates) {
                String outcome;
                try (ResultSet rs = statement.executeQuery(candidate[1])) {
                    rs.next();
                    Instant value;
                    if ("cal".equals(candidate[2])) {
                        value = rs.getTimestamp(1, Calendar.getInstance(
                                TimeZone.getTimeZone("UTC"))).toInstant();
                    } else if ("odt".equals(candidate[2])) {
                        value = rs.getObject(1, OffsetDateTime.class)
                                .toInstant();
                    } else {
                        BigDecimal epoch = rs.getBigDecimal(1);
                        long micros = epoch.movePointRight(6).longValue();
                        value = Instant.ofEpochSecond(micros / 1_000_000L,
                                (micros % 1_000_000L) * 1000L);
                    }
                    long skew = Duration.between(Instant.now(), value)
                            .toMillis();
                    outcome = String.format("skew=%7d ms  nanos=%09d  %s",
                            skew, value.getNano(),
                            Math.abs(skew) < 2000 ? "OK" : "WRONG");
                } catch (Exception failure) {
                    String message = String.valueOf(failure.getMessage());
                    outcome = "FAILS: " + message.substring(0,
                            Math.min(90, message.length())).replace('\n', ' ');
                }
                System.out.printf("[%-22s] %-40s %s%n", label, candidate[0],
                        outcome);
            }
        }
    }
}
