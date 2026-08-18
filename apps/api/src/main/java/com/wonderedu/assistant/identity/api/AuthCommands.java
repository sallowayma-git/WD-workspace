package com.wonderedu.assistant.identity.api;

public final class AuthCommands {

    private AuthCommands() {}

    public record Login(String username, String password, String organizationCode) {

        public Login(String username, String password) {
            this(username, password, null);
        }
    }

    public record Refresh(String refreshToken) {}

    public record Logout(String refreshToken) {}
}
