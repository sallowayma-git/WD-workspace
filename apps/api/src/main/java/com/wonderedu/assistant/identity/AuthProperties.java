package com.wonderedu.assistant.identity;

import java.net.URI;
import java.util.List;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties(prefix = "assistant.auth")
@Validated
public record AuthProperties(
        @NotEmpty List<String> allowedOrigins,
        @Min(60) long accessTokenTtlSeconds,
        @Min(300) long refreshTokenTtlSeconds,
        @Min(1) int maxLoginFailures,
        @Min(60) long lockDurationSeconds) {

    @AssertTrue(message = "assistant.auth.allowed-origins must contain only explicit http(s) or tauri origins")
    public boolean isAllowedOriginsValid() {
        return allowedOrigins != null
                && allowedOrigins.stream()
                        .allMatch(
                                value -> {
                                    try {
                                        URI origin = URI.create(value);
                                        return !value.contains("*")
                                                && List.of("http", "https", "tauri")
                                                        .contains(origin.getScheme())
                                                && origin.getHost() != null;
                                    } catch (IllegalArgumentException exception) {
                                        return false;
                                    }
                                });
    }
}
