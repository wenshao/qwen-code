public class IsoProbe {
    public static void main(String[] a) throws Exception {
        org.h2.jdbcx.JdbcDataSource ds = new org.h2.jdbcx.JdbcDataSource();
        ds.setURL("jdbc:h2:mem:iso-" + java.util.UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1");
        try (var c = ds.getConnection()) {
            var md = c.getMetaData();
            System.out.println(md.getDatabaseProductName() + " " + md.getDatabaseProductVersion()
                + " isolation=" + c.getTransactionIsolation() + " (2=READ_COMMITTED, 4=REPEATABLE_READ)");
        }
    }
}
