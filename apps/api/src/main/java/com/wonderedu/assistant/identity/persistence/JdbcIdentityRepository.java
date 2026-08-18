package com.wonderedu.assistant.identity.persistence;

import com.wonderedu.assistant.identity.application.IdentityRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcIdentityRepository implements IdentityRepository {

    private static final String ACCOUNT_COLUMNS =
            "u.id, u.organization_id, o.code, o.name, o.business_timezone, o.day_close_time, "
                    + "u.username, u.display_name, u.password_hash, u.status, o.status, "
                    + "u.failed_login_attempts, u.locked_until";

    private final JdbcClient jdbc;

    public JdbcIdentityRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<Account> findByOrganizationCodeAndUsername(
            String organizationCode, String username) {
        return jdbc.sql(
                        "SELECT "
                                + ACCOUNT_COLUMNS
                                + " FROM user_account u JOIN organization o ON o.id = u.organization_id "
                                + "WHERE o.code = :organizationCode AND lower(u.username) = lower(:username)")
                .param("organizationCode", organizationCode)
                .param("username", username)
                .query(this::mapAccount)
                .optional()
                .map(this::withRoles);
    }

    @Override
    public Optional<Account> findById(UUID userId) {
        return jdbc.sql(
                        "SELECT "
                                + ACCOUNT_COLUMNS
                                + " FROM user_account u JOIN organization o ON o.id = u.organization_id "
                                + "WHERE u.id = :userId")
                .param("userId", userId)
                .query(this::mapAccount)
                .optional()
                .map(this::withRoles);
    }

    @Override
    public void clearExpiredLock(UUID userId, Instant now) {
        jdbc.sql(
                        "UPDATE user_account SET status = 'ACTIVE', failed_login_attempts = 0, "
                                + "locked_until = NULL, updated_at = :now, updated_by = :userId, version = version + 1 "
                                + "WHERE id = :userId AND status = 'LOCKED' AND locked_until IS NOT NULL AND locked_until <= :now")
                .param("userId", userId)
                .param("now", now)
                .update();
    }

    @Override
    public void recordLoginFailure(UUID userId, Instant now, int maxFailures, Instant lockedUntil) {
        jdbc.sql(
                        "UPDATE user_account SET failed_login_attempts = failed_login_attempts + 1, "
                                + "status = CASE WHEN failed_login_attempts + 1 >= :maxFailures THEN 'LOCKED' ELSE status END, "
                                + "locked_until = CASE WHEN failed_login_attempts + 1 >= :maxFailures THEN :lockedUntil ELSE locked_until END, "
                                + "updated_at = :now, updated_by = :userId, version = version + 1 WHERE id = :userId")
                .param("userId", userId)
                .param("now", now)
                .param("maxFailures", maxFailures)
                .param("lockedUntil", lockedUntil)
                .update();
    }

    @Override
    public void recordLoginSuccess(UUID userId, Instant now) {
        jdbc.sql(
                        "UPDATE user_account SET status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL, "
                                + "last_login_at = :now, updated_at = :now, updated_by = :userId, version = version + 1 "
                                + "WHERE id = :userId")
                .param("userId", userId)
                .param("now", now)
                .update();
    }

    @Override
    public void createSession(Session session) {
        jdbc.sql(
                        "INSERT INTO auth_session (id, organization_id, user_id, access_token_hash, refresh_token_hash, "
                                + "access_expires_at, refresh_expires_at, rotated_from_session_id, created_at, updated_at, version) "
                                + "VALUES (:id, :organizationId, :userId, :accessTokenHash, :refreshTokenHash, "
                                + ":accessExpiresAt, :refreshExpiresAt, :rotatedFromSessionId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)")
                .param("id", session.id())
                .param("organizationId", session.organizationId())
                .param("userId", session.userId())
                .param("accessTokenHash", session.accessTokenHash())
                .param("refreshTokenHash", session.refreshTokenHash())
                .param("accessExpiresAt", session.accessExpiresAt())
                .param("refreshExpiresAt", session.refreshExpiresAt())
                .param("rotatedFromSessionId", session.rotatedFromSessionId())
                .update();
    }

    @Override
    public Optional<Session> lockByRefreshTokenHash(String refreshTokenHash) {
        return jdbc.sql(
                        "SELECT id, organization_id, user_id, access_token_hash, refresh_token_hash, access_expires_at, "
                                + "refresh_expires_at, rotated_from_session_id FROM auth_session "
                                + "WHERE refresh_token_hash = :refreshTokenHash AND revoked_at IS NULL FOR UPDATE")
                .param("refreshTokenHash", refreshTokenHash)
                .query((rs, row) -> mapSession(rs))
                .optional();
    }

    @Override
    public Optional<AuthenticatedSession> findByAccessTokenHash(String accessTokenHash) {
        return jdbc.sql(
                        "SELECT s.id, s.organization_id, s.user_id, s.access_token_hash, s.refresh_token_hash, "
                                + "s.access_expires_at, s.refresh_expires_at, s.rotated_from_session_id, "
                                + ACCOUNT_COLUMNS.replace("u.", "u.")
                                + " FROM auth_session s JOIN user_account u ON u.id = s.user_id "
                                + "JOIN organization o ON o.id = s.organization_id "
                                + "WHERE s.access_token_hash = :accessTokenHash AND s.revoked_at IS NULL")
                .param("accessTokenHash", accessTokenHash)
                .query(
                        (rs, row) ->
                                new AuthenticatedSession(
                                        mapSession(rs), withRoles(mapAccountAt(rs, 9))))
                .optional();
    }

    @Override
    public void rotateSession(UUID previousSessionId, Session replacement, Instant now) {
        createSession(replacement);
        jdbc.sql(
                        "UPDATE auth_session SET revoked_at = :now, revoked_reason = 'ROTATED', replaced_by_session_id = :replacementId, "
                                + "updated_at = :now, version = version + 1 WHERE id = :previousSessionId AND revoked_at IS NULL")
                .param("previousSessionId", previousSessionId)
                .param("replacementId", replacement.id())
                .param("now", now)
                .update();
    }

    @Override
    public void revokeSession(String accessTokenHash, String refreshTokenHash, Instant now) {
        jdbc.sql(
                        "UPDATE auth_session SET revoked_at = :now, revoked_reason = 'LOGOUT', updated_at = :now, version = version + 1 "
                                + "WHERE revoked_at IS NULL AND (access_token_hash = :accessTokenHash OR refresh_token_hash = :refreshTokenHash)")
                .param("accessTokenHash", accessTokenHash)
                .param("refreshTokenHash", refreshTokenHash)
                .param("now", now)
                .update();
    }

    private Account withRoles(Account account) {
        List<String> roles =
                jdbc.sql(
                                "SELECT DISTINCT role_code FROM user_role_assignment "
                                        + "WHERE organization_id = :organizationId AND user_id = :userId "
                                        + "ORDER BY role_code")
                        .param("organizationId", account.organizationId())
                        .param("userId", account.id())
                        .query((rs, row) -> rs.getString(1))
                        .list();
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
                account.status(),
                account.organizationStatus(),
                account.failedLoginAttempts(),
                account.lockedUntil(),
                roles);
    }

    private Account mapAccount(ResultSet rs, int ignored) throws SQLException {
        return mapAccountAt(rs, 1);
    }

    private Account mapAccountAt(ResultSet rs, int offset) throws SQLException {
        return new Account(
                rs.getObject(offset, UUID.class),
                rs.getObject(offset + 1, UUID.class),
                rs.getString(offset + 2),
                rs.getString(offset + 3),
                rs.getString(offset + 4),
                rs.getObject(offset + 5, LocalTime.class),
                rs.getString(offset + 6),
                rs.getString(offset + 7),
                rs.getString(offset + 8),
                rs.getString(offset + 9),
                rs.getString(offset + 10),
                rs.getInt(offset + 11),
                rs.getObject(offset + 12, java.time.OffsetDateTime.class) == null
                        ? null
                        : rs.getObject(offset + 12, java.time.OffsetDateTime.class).toInstant(),
                List.of());
    }

    private Session mapSession(ResultSet rs) throws SQLException {
        return new Session(
                rs.getObject("id", UUID.class),
                rs.getObject("organization_id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("access_token_hash"),
                rs.getString("refresh_token_hash"),
                rs.getObject("access_expires_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getObject("refresh_expires_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getObject("rotated_from_session_id", UUID.class));
    }
}
