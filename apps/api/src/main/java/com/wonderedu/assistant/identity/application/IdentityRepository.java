package com.wonderedu.assistant.identity.application;

import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persistence boundary for database-backed identity, role and session state. */
public interface IdentityRepository {

    Optional<Account> findByOrganizationCodeAndUsername(String organizationCode, String username);

    Optional<Account> findById(UUID userId);

    void clearExpiredLock(UUID userId, Instant now);

    void recordLoginFailure(UUID userId, Instant now, int maxFailures, Instant lockedUntil);

    void recordLoginSuccess(UUID userId, Instant now);

    void createSession(Session session);

    Optional<Session> lockByRefreshTokenHash(String refreshTokenHash);

    Optional<AuthenticatedSession> findByAccessTokenHash(String accessTokenHash);

    void rotateSession(UUID previousSessionId, Session replacement, Instant now);

    void revokeSession(String accessTokenHash, String refreshTokenHash, Instant now);

    record Account(
            UUID id,
            UUID organizationId,
            String organizationCode,
            String organizationName,
            String businessTimezone,
            LocalTime dayCloseTime,
            String username,
            String displayName,
            String passwordHash,
            String status,
            String organizationStatus,
            int failedLoginAttempts,
            Instant lockedUntil,
            List<String> roles) {

        public boolean isActive() {
            return "ACTIVE".equals(status) && "ACTIVE".equals(organizationStatus);
        }
    }

    record Session(
            UUID id,
            UUID organizationId,
            UUID userId,
            String accessTokenHash,
            String refreshTokenHash,
            Instant accessExpiresAt,
            Instant refreshExpiresAt,
            UUID rotatedFromSessionId) {}

    record AuthenticatedSession(Session session, Account account) {}
}
