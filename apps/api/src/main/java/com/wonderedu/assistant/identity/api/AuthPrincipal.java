package com.wonderedu.assistant.identity.api;

import java.security.Principal;
import java.time.LocalTime;
import java.util.UUID;

public record AuthPrincipal(
        UUID userId,
        UUID organizationId,
        String organizationCode,
        String organizationName,
        String businessTimezone,
        LocalTime dayCloseTime,
        String username,
        String displayName)
        implements Principal {

    @Override
    public String getName() {
        return username;
    }
}
