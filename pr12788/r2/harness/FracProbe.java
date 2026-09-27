import java.sql.*;
import java.time.Instant;
import java.util.Calendar;
import java.util.TimeZone;

/** Does a fractional-second Timestamp survive a write/read round trip? */
public class FracProbe {
    public static void main(String[] args) throws Exception {
        String[][] targets = {
            {"mysql", "jdbc:mysql://127.0.0.1:23788/?allowPublicKeyRetrieval=true&useSSL=false", "root", ""},
            {"mysql nofrac", "jdbc:mysql://127.0.0.1:23788/?allowPublicKeyRetrieval=true&useSSL=false&sendFractionalSeconds=false", "root", ""},
            {"mariadb", "jdbc:mysql://127.0.0.1:23789/?allowPublicKeyRetrieval=true&useSSL=false", "root", "runtime-broker"},
        };
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        Instant value = Instant.parse("2026-09-27T07:00:00.123456Z");
        for (String[] t : targets) {
            try (Connection c = DriverManager.getConnection(t[1], t[2], t[3])) {
                DatabaseMetaData md = c.getMetaData();
                try (Statement s = c.createStatement()) {
                    s.execute("CREATE DATABASE IF NOT EXISTS fracprobe");
                    s.execute("DROP TABLE IF EXISTS fracprobe.t");
                    s.execute("CREATE TABLE fracprobe.t (v DATETIME(6))");
                }
                try (PreparedStatement p = c.prepareStatement("INSERT INTO fracprobe.t VALUES (?)")) {
                    p.setTimestamp(1, Timestamp.from(value), utc);
                    p.execute();
                }
                String stored;
                try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT CAST(v AS CHAR) FROM fracprobe.t")) {
                    r.next(); stored = r.getString(1);
                }
                System.out.printf("%-13s driver=%s %s | server reports '%s' (major.minor %d.%d) | wrote %s -> stored %s%n",
                    t[0], md.getDriverName(), md.getDriverVersion(), md.getDatabaseProductVersion(),
                    md.getDatabaseMajorVersion(), md.getDatabaseMinorVersion(), value, stored);
            }
        }
    }
}
