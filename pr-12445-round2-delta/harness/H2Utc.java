import java.sql.*;
public class H2Utc { public static void main(String[] a) throws Exception {
  try (Connection c = DriverManager.getConnection("jdbc:h2:mem:t;MODE=MySQL", "sa", "")) {
    for (String q : new String[]{"SELECT UTC_TIMESTAMP()", "SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(6))"}) {
      try (ResultSet r = c.createStatement().executeQuery(q)) { r.next(); System.out.println(q + " -> " + r.getObject(1) + " (" + r.getObject(1).getClass().getSimpleName() + ")"); }
      catch (SQLException e) { System.out.println(q + " -> " + e.getMessage().split("\n")[0]); }
    }
  }}}
