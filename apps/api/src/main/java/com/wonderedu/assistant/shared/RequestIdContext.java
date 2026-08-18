package com.wonderedu.assistant.shared;

import java.util.UUID;

/** Request-scoped correlation id used by HTTP responses, logs and audit records. */
public final class RequestIdContext {

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private RequestIdContext() {}

    public static String currentOrCreate() {
        String current = CURRENT.get();
        if (current == null || current.isBlank()) {
            current = UUID.randomUUID().toString();
            CURRENT.set(current);
        }
        return current;
    }

    public static void set(String requestId) {
        CURRENT.set(requestId);
    }

    public static void clear() {
        CURRENT.remove();
    }
}
