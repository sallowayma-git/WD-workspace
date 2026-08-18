package com.wonderedu.assistant.identity.api;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ContextView(
        UserView user,
        OrganizationView organization,
        LocalDate businessDate,
        String timezone,
        LocalTime dayCloseTime,
        List<String> permissions,
        Map<String, Boolean> featureFlags,
        String clientMinCompatibleVersion) {

    public record UserView(UUID id, String displayName, List<String> roles) {}

    public record OrganizationView(UUID id, String code, String name) {}
}
