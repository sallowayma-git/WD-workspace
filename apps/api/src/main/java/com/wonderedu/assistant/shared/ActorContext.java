package com.wonderedu.assistant.shared;

import java.util.UUID;

/** Request-scoped actor information for authorization and audit. */
public final class ActorContext {

    private static final ThreadLocal<Actor> CURRENT = new ThreadLocal<>();

    private ActorContext() {}

    public static void set(UUID actorId, String username) {
        CURRENT.set(new Actor(actorId, username));
    }

    public static Actor current() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }

    public record Actor(UUID id, String username) {}
}
