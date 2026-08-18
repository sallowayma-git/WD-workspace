package com.wonderedu.assistant.identity.application;

import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.identity.api.ContextView;
import com.wonderedu.assistant.identity.api.AuthPrincipal;
import com.wonderedu.assistant.shared.BusinessClock;
import java.time.Clock;
import java.time.ZoneId;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service
public class ContextService {

    private final IdentityProperties properties;
    private final BusinessClock clock;

    @Autowired
    public ContextService(IdentityProperties properties, BusinessClock clock) {
        this.properties = properties;
        this.clock = clock;
    }

    ContextService(IdentityProperties properties, Clock clock) {
        this(properties, clock::instant);
    }

    public ContextView getContext(Authentication authentication) {
        String username = authentication.getName();
        String displayName = username;
        UUID userId = UUID.nameUUIDFromBytes(username.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        UUID organizationId = properties.organizationId();
        String organizationCode = properties.organizationCode();
        String organizationName = properties.organizationName();
        String businessTimezone = properties.businessTimezone();
        java.time.LocalTime dayCloseTime = properties.dayCloseTime();
        if (authentication.getPrincipal() instanceof AuthPrincipal principal) {
            userId = principal.userId();
            displayName = principal.displayName();
            organizationId = principal.organizationId();
            organizationCode = principal.organizationCode();
            organizationName = principal.organizationName();
            businessTimezone = principal.businessTimezone();
            dayCloseTime = principal.dayCloseTime();
        }
        List<String> roles =
                authentication.getAuthorities().stream()
                        .map((authority) -> authority.getAuthority())
                        .map(role -> role.startsWith("ROLE_") ? role.substring(5) : role)
                        .toList();
        List<String> permissions = permissionsFor(roles);
        var businessDate = clock.businessDate(ZoneId.of(businessTimezone));
        return new ContextView(
                new ContextView.UserView(userId, displayName, roles),
                new ContextView.OrganizationView(organizationId, organizationCode, organizationName),
                businessDate,
                businessTimezone,
                dayCloseTime,
                permissions,
                Map.of(),
                properties.clientMinCompatibleVersion());
    }

    private List<String> permissionsFor(List<String> roles) {
        Set<String> permissions = new LinkedHashSet<>();
        for (String role : roles) {
            switch (role) {
                case "ADMIN" ->
                        permissions.addAll(
                                List.of(
                                        "student.read",
                                        "student.write",
                                        "schedule.read",
                                        "schedule.write",
                                        "schedule.override",
                                        "task.complete",
                                        "task.reopen",
                                        "task.skip",
                                        "template.read",
                                        "template.edit_draft",
                                        "template.publish",
                                        "vocabulary.write",
                                        "vocabulary.export",
                                        "admin.day_close.run",
                                        "audit.read"));
                case "LEAD_TEACHER" ->
                        permissions.addAll(
                                List.of(
                                        "student.read",
                                        "student.write",
                                        "schedule.read",
                                        "schedule.write",
                                        "schedule.override",
                                        "task.complete",
                                        "task.reopen",
                                        "template.read",
                                        "template.edit_draft",
                                        "template.publish",
                                        "vocabulary.write",
                                        "vocabulary.export"));
                case "ASSISTANT" ->
                        permissions.addAll(
                                List.of(
                                        "student.read",
                                        "student.write",
                                        "schedule.read",
                                        "schedule.write",
                                        "task.complete",
                                        "task.reopen",
                                        "template.read",
                                        "template.edit_draft",
                                        "vocabulary.write"));
                case "VIEWER" ->
                        permissions.addAll(
                                List.of("student.read", "schedule.read", "template.read"));
                default -> {
                    // Unknown authorities do not gain permissions.
                }
            }
        }
        return List.copyOf(permissions);
    }
}
