package com.alibaba.qwen.code.managedagent.store;

import com.alibaba.qwen.code.managedagent.ManagedAgentServerApplication;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Verification rig: boots the production application; only the OSS adapter is replaced.
 * E2E_OBJECTS=refuse (default) throws on every object-store call; E2E_OBJECTS=memory keeps
 * objects in a map and logs every call (used when the O4-2 publication collector must delete).
 */
public final class E2EBroker {
    public static void main(String[] args) throws Exception {
        boolean memory = "memory".equals(System.getenv("E2E_OBJECTS"));
        ConfigurableApplicationContext context = new SpringApplicationBuilder(ManagedAgentServerApplication.class)
                .initializers(ctx -> ((ConfigurableApplicationContext) ctx).addBeanFactoryPostProcessor(factory -> {
                    var registry = (org.springframework.beans.factory.support.BeanDefinitionRegistry) factory;
                    registry.removeBeanDefinition("toolPublicationObjects");
                    registry.removeBeanDefinition("toolPublicationOss");
                    registry.registerBeanDefinition("toolPublicationObjects",
                            new org.springframework.beans.factory.support.RootBeanDefinition(
                                    ToolPublicationObjectStore.class,
                                    memory ? MemoryObjects::new : RefusingObjects::new));
                    System.out.println("E2E-RIG replaced OSS beans with a " + (memory ? "memory" : "refusing")
                            + " local stub");
                }))
                .run(args);
        try {
            Class<?> type = Class.forName("com.alibaba.qwen.code.managedagent.store.SessionResourceCollectionCollector");
            var field = type.getDeclaredField("owner");
            field.setAccessible(true);
            System.out.println("E2E-RIG collector-owner=" + field.get(context.getBean(type)) + " pid=" + ProcessHandle.current().pid());
        } catch (ClassNotFoundException absent) {
            System.out.println("E2E-RIG no stream-capture collector in this build pid=" + ProcessHandle.current().pid());
        }
    }

    static final class RefusingObjects implements ToolPublicationObjectStore {
        private static UnsupportedOperationException refuse(String op, String key) {
            System.out.println("E2E-RIG object-store-call op=" + op + " key=" + key);
            return new UnsupportedOperationException("E2E rig: object store must not be used (" + op + ")");
        }
        @Override public void putIfAbsent(String key, byte[] bytes) { throw refuse("put", key); }
        @Override public InputStream open(String key) { throw refuse("open", key); }
        @Override public void deleteIfPresent(String key) { throw refuse("delete", key); }
        @Override public void requireUnversioned() { System.out.println("E2E-RIG requireUnversioned no-op"); }
    }

    static final class MemoryObjects implements ToolPublicationObjectStore {
        private final ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        @Override public void putIfAbsent(String key, byte[] bytes) {
            System.out.println("E2E-RIG memory-object op=put key=" + key + " bytes=" + bytes.length);
            objects.putIfAbsent(key, bytes.clone());
        }
        @Override public InputStream open(String key) {
            System.out.println("E2E-RIG memory-object op=open key=" + key);
            return new ByteArrayInputStream(objects.get(key));
        }
        @Override public void deleteIfPresent(String key) {
            System.out.println("E2E-RIG memory-object op=delete key=" + key + " present=" + (objects.remove(key) != null));
        }
        @Override public void requireUnversioned() { }
    }
}
