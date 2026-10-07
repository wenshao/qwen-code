import com.alibaba.qwen.code.managedagent.store.ManagedExtensionProjection;
public class RegistryKeys {
    public static void main(String[] a) {
        System.out.println("java RECORD_BODIES size=" + ManagedExtensionProjection.RECORD_BODIES.size() + " keys=" + new java.util.TreeSet<>(ManagedExtensionProjection.RECORD_BODIES.keySet()));
        System.out.println("java channel taskKind route=" + ManagedExtensionProjection.RECORD_BODIES.get("channel_route").taskKindOf().apply(null) + " delivery=" + ManagedExtensionProjection.RECORD_BODIES.get("channel_delivery").taskKindOf().apply(null));
    }
}
