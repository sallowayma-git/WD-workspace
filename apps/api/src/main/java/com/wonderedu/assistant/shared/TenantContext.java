package com.wonderedu.assistant.shared;

import java.util.UUID;

/** Immutable tenant boundary for the lifetime of a request. */
public final class TenantContext {

    private static final ThreadLocal<UUID> CURRENT = new ThreadLocal<>();

    private TenantContext() {}

    public static void set(UUID organizationId) {
        if (organizationId == null) {
            throw new IllegalArgumentException("organizationId must not be null");
        }
        CURRENT.set(organizationId);
    }

    public static UUID requireOrganizationId() {
        UUID organizationId = CURRENT.get();
        if (organizationId == null) {
            throw new IllegalStateException("TenantContext has not been initialized");
        }
        return organizationId;
    }

    public static UUID currentOrganizationId() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }
}
