package com.wonderedu.assistant.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "assistant.seed-dev")
public record DevSeedProperties(boolean enabled, String password) {}
