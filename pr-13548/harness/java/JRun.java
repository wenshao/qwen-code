import java.util.Arrays;
import org.junit.platform.launcher.LauncherDiscoveryRequest;
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder;
import org.junit.platform.launcher.core.LauncherFactory;
import org.junit.platform.launcher.listeners.SummaryGeneratingListener;
import static org.junit.platform.engine.discovery.DiscoverySelectors.selectClass;

/** Minimal JUnit Platform runner: prints found/ok/fail and the first failures. */
public class JRun {
    public static void main(String[] args) {
        LauncherDiscoveryRequest request = LauncherDiscoveryRequestBuilder.request()
                .selectors(Arrays.stream(args).map(c -> selectClass(c)).toList()).build();
        SummaryGeneratingListener listener = new SummaryGeneratingListener();
        LauncherFactory.create().execute(request, listener);
        var s = listener.getSummary();
        System.out.println("RUN=" + s.getTestsFoundCount() + " OK=" + s.getTestsSucceededCount() + " FAIL=" + s.getTotalFailureCount());
        s.getFailures().stream().limit(3).forEach(f -> {
            String m = String.valueOf(f.getException().getMessage()).replace('\n', ' ');
            System.out.println("F " + f.getTestIdentifier().getDisplayName() + " :: " + m.substring(0, Math.min(160, m.length())));
        });
        System.exit(0);
    }
}
