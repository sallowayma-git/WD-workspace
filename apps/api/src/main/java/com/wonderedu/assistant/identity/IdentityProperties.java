package com.wonderedu.assistant.identity;

import java.time.LocalTime;
import java.time.ZoneId;
import java.util.UUID;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties(prefix = "assistant")
@Validated
public record IdentityProperties(
        @NotBlank String businessTimezone,
        @NotNull LocalTime dayCloseTime,
        @NotNull UUID organizationId,
        @NotBlank String organizationCode,
        @NotBlank String organizationName,
        @NotBlank String clientMinCompatibleVersion) {

    @AssertTrue(message = "assistant.business-timezone must be a valid IANA timezone")
    public boolean isBusinessTimezoneValid() {
        try {
            ZoneId.of(businessTimezone);
            return true;
        } catch (java.time.DateTimeException exception) {
            return false;
        }
    }
}
