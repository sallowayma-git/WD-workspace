package com.wonderedu.assistant.identity.api;

import java.util.List;

public record AuthView(
        String accessToken,
        String refreshToken,
        long expiresIn,
        UserView user) {

    public record UserView(String username, String displayName, List<String> roles) {}
}
