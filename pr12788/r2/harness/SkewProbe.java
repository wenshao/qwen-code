import java.sql.*;
import java.time.Instant;

/** Offset of the database clock from the JVM clock over time. */
public class SkewProbe {
    public static void main(String[] args) throws Exception {
        String url = args[0], pw = args[1];
        long end = System.nanoTime() + 20_000_000_000L;
        try (Connection c = DriverManager.getConnection(url, "root", pw);
             PreparedStatement p = c.prepareStatement(
                 "SELECT UNIX_TIMESTAMP(), EXTRACT(MICROSECOND FROM CURRENT_TIMESTAMP(6))")) {
            long bucketStart = System.nanoTime(); long min = Long.MAX_VALUE, max = Long.MIN_VALUE, rttMax = 0; int n = 0;
            while (System.nanoTime() < end) {
                Instant b = Instant.now();
                long v;
                try (ResultSet r = p.executeQuery()) { r.next(); v = r.getLong(1) * 1_000_000L + r.getLong(2); }
                Instant a = Instant.now();
                long bu = b.getEpochSecond() * 1_000_000L + b.getNano() / 1000, au = a.getEpochSecond() * 1_000_000L + a.getNano() / 1000;
                long off = v - (bu + au) / 2;
                min = Math.min(min, off); max = Math.max(max, off); rttMax = Math.max(rttMax, au - bu); n++;
                if (System.nanoTime() - bucketStart > 1_000_000_000L) {
                    System.out.printf("t+%2ds n=%5d offset(us) min=%8d max=%8d  maxRTT(us)=%d%n",
                        (int) ((System.nanoTime() - (end - 20_000_000_000L)) / 1_000_000_000L), n, min, max, rttMax);
                    bucketStart = System.nanoTime(); min = Long.MAX_VALUE; max = Long.MIN_VALUE; rttMax = 0; n = 0;
                }
            }
        }
    }
}
