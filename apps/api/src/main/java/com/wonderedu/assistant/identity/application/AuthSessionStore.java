package com.wonderedu.assistant.identity.application;

import com.wonderedu.assistant.identity.AuthProperties;
import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.identity.api.AuthCommands;
import com.wonderedu.assistant.identity.api.AuthPrincipal;
import com.wonderedu.assistant.identity.api.AuthView;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Database-backed opaque-token authentication and revocable session service. */
@Service
public class AuthSessionStore {

    private final AuthProperties properties;
    private final IdentityProperties identityProperties;
    private final IdentityRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;
    private final SecureRandom secureRandom = new SecureRandom();

    public AuthSessionStore(
            AuthProperties properties,
            IdentityProperties identityProperties,
            IdentityRepository repository,
            PasswordEncoder passwordEncoder,
            BusinessClock clock,
            IdGenerator idGenerator) {
        this.properties = properties;
        this.identityProperties = identityProperties;
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.clock = clock;
        this.idGenerator = idGenerator;
    }

    @Transactional
    public AuthView login(AuthCommands.Login command) {
        if (command == null
                || blank(command.username())
                || blank(command.password())) {
            throw invalidCredentials();
        }
        String organizationCode =
                blank(command.organizationCode())
                        ? identityProperties.organizationCode()
                        : command.organizationCode().trim();
        var account =
                repository
                        .findByOrganizationCodeAndUsername(organizationCode, command.username().trim())
                        .orElseThrow(this::invalidCredentials);
        Instant now = clock.now();
        if ("DISABLED".equals(account.status())
                || !"ACTIVE".equals(account.organizationStatus())) {
            throw new DomainException(403, "ACCOUNT_DISABLED", "账号或组织已停用");
        }
        if ("LOCKED".equals(account.status())) {
            if (account.lockedUntil() == null || account.lockedUntil().isAfter(now)) {
                throw new DomainException(423, "ACCOUNT_LOCKED", "账号暂时锁定，请稍后重试");
            }
            repository.clearExpiredLock(account.id(), now);
        }
        if (!passwordEncoder.matches(command.password(), account.passwordHash())) {
            repository.recordLoginFailure(
                    account.id(),
                    now,
                    properties.maxLoginFailures(),
                    now.plusSeconds(properties.lockDurationSeconds()));
            throw invalidCredentials();
        }
        repository.recordLoginSuccess(account.id(), now);
        return issueSession(account, now);
    }

    @Transactional
    public AuthView refresh(AuthCommands.Refresh command) {
        if (command == null || blank(command.refreshToken())) {
            throw invalidRefreshToken();
        }
        Instant now = clock.now();
        String refreshHash = tokenHash(command.refreshToken());
        var oldSession = repository.lockByRefreshTokenHash(refreshHash).orElse(null);
        if (oldSession == null || !oldSession.refreshExpiresAt().isAfter(now)) {
            throw invalidRefreshToken();
        }
        var account = repository.findById(oldSession.userId()).orElse(null);
        if (account == null || !account.isActive()) {
            throw invalidRefreshToken();
        }
        return issueRotatedSession(account, oldSession, now);
    }

    @Transactional
    public void logout(String accessToken, AuthCommands.Logout command) {
        String accessHash = blank(accessToken) ? null : tokenHash(accessToken);
        String refreshHash =
                command == null || blank(command.refreshToken())
                        ? null
                        : tokenHash(command.refreshToken());
        if (accessHash != null || refreshHash != null) {
            repository.revokeSession(accessHash, refreshHash, clock.now());
        }
    }

    @Transactional(readOnly = true)
    public Authentication authenticateAccessToken(String accessToken) {
        if (blank(accessToken)) return null;
        var authenticated = repository.findByAccessTokenHash(tokenHash(accessToken)).orElse(null);
        if (authenticated == null) return null;
        Instant now = clock.now();
        if (!authenticated.session().accessExpiresAt().isAfter(now)
                || !authenticated.account().isActive()) {
            return null;
        }
        var account = authenticated.account();
        var principal =
                new AuthPrincipal(
                        account.id(),
                        account.organizationId(),
                        account.organizationCode(),
                        account.organizationName(),
                        account.businessTimezone(),
                        account.dayCloseTime(),
                        account.username(),
                        account.displayName());
        return new UsernamePasswordAuthenticationToken(
                principal,
                null,
                account.roles().stream()
                        .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                        .toList());
    }

    private AuthView issueSession(IdentityRepository.Account account, Instant now) {
        String accessToken = token();
        String refreshToken = token();
        var session =
                new IdentityRepository.Session(
                        idGenerator.next(),
                        account.organizationId(),
                        account.id(),
                        tokenHash(accessToken),
                        tokenHash(refreshToken),
                        now.plusSeconds(properties.accessTokenTtlSeconds()),
                        now.plusSeconds(properties.refreshTokenTtlSeconds()),
                        null);
        repository.createSession(session);
        return view(account, accessToken, refreshToken);
    }

    private AuthView issueRotatedSession(
            IdentityRepository.Account account, IdentityRepository.Session oldSession, Instant now) {
        String accessToken = token();
        String refreshToken = token();
        var replacement =
                new IdentityRepository.Session(
                        idGenerator.next(),
                        account.organizationId(),
                        account.id(),
                        tokenHash(accessToken),
                        tokenHash(refreshToken),
                        now.plusSeconds(properties.accessTokenTtlSeconds()),
                        now.plusSeconds(properties.refreshTokenTtlSeconds()),
                        oldSession.id());
        repository.rotateSession(oldSession.id(), replacement, now);
        return view(account, accessToken, refreshToken);
    }

    private AuthView view(
            IdentityRepository.Account account, String accessToken, String refreshToken) {
        return new AuthView(
                accessToken,
                refreshToken,
                properties.accessTokenTtlSeconds(),
                new AuthView.UserView(account.username(), account.displayName(), account.roles()));
    }

    private String token() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String tokenHash(String token) {
        try {
            byte[] digest =
                    MessageDigest.getInstance("SHA-256")
                            .digest(token.getBytes(StandardCharsets.US_ASCII));
            StringBuilder value = new StringBuilder(digest.length * 2);
            for (byte part : digest) value.append(String.format("%02x", part));
            return value.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required", exception);
        }
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private DomainException invalidCredentials() {
        return new DomainException(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    private DomainException invalidRefreshToken() {
        return new DomainException(401, "INVALID_REFRESH_TOKEN", "刷新令牌无效或已过期");
    }
}
