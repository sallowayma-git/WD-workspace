package com.wonderedu.assistant.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.wonderedu.assistant.identity.AuthProperties;
import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.identity.api.AuthCommands;
import com.wonderedu.assistant.identity.api.AuthView;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import java.time.Instant;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

class AuthSessionStoreTest {

    private final AtomicReference<Instant> now =
            new AtomicReference<>(Instant.parse("2026-08-16T00:00:00Z"));
    private AuthSessionStore sessions;

    @BeforeEach
    void setUp() {
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AuthProperties properties =
                new AuthProperties(List.of("http://127.0.0.1:5173"), 60, 600, 3, 900);
        IdentityProperties identity =
                new IdentityProperties(
                        "Asia/Shanghai",
                        LocalTime.of(5, 0),
                        FakeIdentityRepository.ORGANIZATION_ID,
                        "TEST",
                        "Test Organization",
                        "0.1.0");
        IdentityRepository repository = new FakeIdentityRepository(encoder.encode("secret"));
        BusinessClock clock = now::get;
        IdGenerator ids = UUID::randomUUID;
        sessions = new AuthSessionStore(properties, identity, repository, encoder, clock, ids);
    }

    @Test
    void rotatesRefreshTokenAndInvalidatesPreviousAccessToken() {
        AuthView first = sessions.login(new AuthCommands.Login("assistant", "secret"));
        AuthView second = sessions.refresh(new AuthCommands.Refresh(first.refreshToken()));

        assertThat(second.accessToken()).isNotEqualTo(first.accessToken());
        assertThat(sessions.authenticateAccessToken(first.accessToken())).isNull();
        assertThat(sessions.authenticateAccessToken(second.accessToken())).isNotNull();
        assertThatThrownBy(() -> sessions.refresh(new AuthCommands.Refresh(first.refreshToken())))
                .isInstanceOf(DomainException.class)
                .hasMessage("刷新令牌无效或已过期");
    }

    @Test
    void expiresAccessTokenWithoutRevokingRefreshToken() {
        AuthView session = sessions.login(new AuthCommands.Login("assistant", "secret"));
        now.set(Instant.parse("2026-08-16T00:01:01Z"));

        assertThat(sessions.authenticateAccessToken(session.accessToken())).isNull();
        assertThat(sessions.refresh(new AuthCommands.Refresh(session.refreshToken()))).isNotNull();
    }

    @Test
    void failedLoginsLockTheDatabaseAccount() {
        for (int attempt = 0; attempt < 3; attempt++) {
            assertThatThrownBy(
                            () -> sessions.login(new AuthCommands.Login("assistant", "wrong")))
                    .isInstanceOf(DomainException.class)
                    .hasMessage("用户名或密码错误");
        }
        assertThatThrownBy(() -> sessions.login(new AuthCommands.Login("assistant", "secret")))
                .isInstanceOf(DomainException.class)
                .hasMessage("账号暂时锁定，请稍后重试");
    }

    private static final class FakeIdentityRepository implements IdentityRepository {

        private static final UUID ORGANIZATION_ID =
                UUID.fromString("00000000-0000-0000-0000-000000000001");
        private static final UUID USER_ID =
                UUID.fromString("00000000-0000-0000-0000-000000000002");

        private Account account;
        private final Map<String, Session> sessionsByAccessHash = new HashMap<>();
        private final Map<String, Session> sessionsByRefreshHash = new HashMap<>();
        private final Map<UUID, Boolean> revoked = new HashMap<>();

        private FakeIdentityRepository(String passwordHash) {
            account =
                    new Account(
                            USER_ID,
                            ORGANIZATION_ID,
                            "TEST",
                            "Test Organization",
                            "Asia/Shanghai",
                            LocalTime.of(5, 0),
                            "assistant",
                            "Test Assistant",
                            passwordHash,
                            "ACTIVE",
                            "ACTIVE",
                            0,
                            null,
                            List.of("ASSISTANT"));
        }

        @Override
        public Optional<Account> findByOrganizationCodeAndUsername(String organizationCode, String username) {
            return organizationCode.equals(account.organizationCode())
                            && username.equalsIgnoreCase(account.username())
                    ? Optional.of(account)
                    : Optional.empty();
        }

        @Override
        public Optional<Account> findById(UUID userId) {
            return USER_ID.equals(userId) ? Optional.of(account) : Optional.empty();
        }

        @Override
        public void clearExpiredLock(UUID userId, Instant now) {
            account = copy("ACTIVE", 0, null);
        }

        @Override
        public void recordLoginFailure(UUID userId, Instant now, int maxFailures, Instant lockedUntil) {
            int attempts = account.failedLoginAttempts() + 1;
            account = copy(attempts >= maxFailures ? "LOCKED" : "ACTIVE", attempts, lockedUntil);
        }

        @Override
        public void recordLoginSuccess(UUID userId, Instant now) {
            account = copy("ACTIVE", 0, null);
        }

        @Override
        public void createSession(Session session) {
            sessionsByAccessHash.put(session.accessTokenHash(), session);
            sessionsByRefreshHash.put(session.refreshTokenHash(), session);
            revoked.put(session.id(), false);
        }

        @Override
        public Optional<Session> lockByRefreshTokenHash(String refreshTokenHash) {
            Session session = sessionsByRefreshHash.get(refreshTokenHash);
            return session != null && !revoked.getOrDefault(session.id(), false)
                    ? Optional.of(session)
                    : Optional.empty();
        }

        @Override
        public Optional<AuthenticatedSession> findByAccessTokenHash(String accessTokenHash) {
            Session session = sessionsByAccessHash.get(accessTokenHash);
            return session != null && !revoked.getOrDefault(session.id(), false)
                    ? Optional.of(new AuthenticatedSession(session, account))
                    : Optional.empty();
        }

        @Override
        public void rotateSession(UUID previousSessionId, Session replacement, Instant now) {
            revoked.put(previousSessionId, true);
            createSession(replacement);
        }

        @Override
        public void revokeSession(String accessTokenHash, String refreshTokenHash, Instant now) {
            sessionsByAccessHash.values().stream()
                    .filter(
                            session ->
                                    session.accessTokenHash().equals(accessTokenHash)
                                            || session.refreshTokenHash().equals(refreshTokenHash))
                    .forEach(session -> revoked.put(session.id(), true));
        }

        private Account copy(String status, int attempts, Instant lockedUntil) {
            return new Account(
                    account.id(),
                    account.organizationId(),
                    account.organizationCode(),
                    account.organizationName(),
                    account.businessTimezone(),
                    account.dayCloseTime(),
                    account.username(),
                    account.displayName(),
                    account.passwordHash(),
                    status,
                    account.organizationStatus(),
                    attempts,
                    lockedUntil,
                    account.roles());
        }
    }
}
