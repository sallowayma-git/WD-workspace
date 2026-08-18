package com.wonderedu.assistant.identity;

import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.IdGenerator;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Deterministic local fixture bootstrap; never loaded outside the dev profile. */
@Component
@Profile("dev")
public class DevSeedRunner implements ApplicationRunner {

    private static final UUID ADMIN_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000010");
    private static final UUID ASSISTANT_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000011");
    private static final UUID ORGANIZATION_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000001");

    private final DevSeedProperties properties;
    private final IdentityProperties identityProperties;
    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;
    private final BusinessClock clock;
    private final IdGenerator ids;

    public DevSeedRunner(
            DevSeedProperties properties,
            IdentityProperties identityProperties,
            JdbcClient jdbc,
            PasswordEncoder passwordEncoder,
            BusinessClock clock,
            IdGenerator ids) {
        this.properties = properties;
        this.identityProperties = identityProperties;
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.clock = clock;
        this.ids = ids;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!properties.enabled()) return;
        if (properties.password() == null || properties.password().isBlank()) {
            throw new IllegalStateException("assistant.seed-dev.password is required when seed-dev is enabled");
        }
        seedOrganization();
        seedUser(ADMIN_ID, "admin", "开发管理员", "ADMIN");
        seedUser(ASSISTANT_ID, "assistant", "开发助教", "ASSISTANT");
        seedStudents();
        seedTemplates();
    }

    private void seedOrganization() {
        var now = clock.now();
        jdbc.sql(
                        "MERGE INTO organization (id, code, name, business_timezone, day_close_time, status, created_at, created_by, updated_at, updated_by, version) "
                                + "KEY(id) VALUES (:id, :code, :name, :timezone, :dayClose, 'ACTIVE', :now, :actor, :now, :actor, 0)")
                .param("id", ORGANIZATION_ID)
                .param("code", identityProperties.organizationCode())
                .param("name", identityProperties.organizationName())
                .param("timezone", identityProperties.businessTimezone())
                .param("dayClose", identityProperties.dayCloseTime())
                .param("now", now)
                .param("actor", ADMIN_ID)
                .update();
    }

    private void seedUser(UUID id, String username, String displayName, String role) {
        var now = clock.now();
        jdbc.sql(
                        "MERGE INTO user_account (id, organization_id, username, display_name, password_hash, status, failed_login_attempts, locked_until, created_at, created_by, updated_at, updated_by, version) "
                                + "KEY(id) VALUES (:id, :organizationId, :username, :displayName, :passwordHash, 'ACTIVE', 0, NULL, :now, :actor, :now, :actor, 0)")
                .param("id", id)
                .param("organizationId", ORGANIZATION_ID)
                .param("username", username)
                .param("displayName", displayName)
                .param("passwordHash", passwordEncoder.encode(properties.password()))
                .param("now", now)
                .param("actor", ADMIN_ID)
                .update();
        jdbc.sql(
                        "INSERT INTO user_role_assignment (id, organization_id, user_id, role_code, scope_type, created_at, created_by, updated_at, updated_by, version) "
                                + "SELECT :id, :organizationId, :userId, :role, 'ORGANIZATION', :now, :actor, :now, :actor, 0 "
                                + "WHERE NOT EXISTS (SELECT 1 FROM user_role_assignment WHERE organization_id = :organizationId AND user_id = :userId AND role_code = :role AND scope_type = 'ORGANIZATION' AND scope_id IS NULL)")
                .param("id", UUID.nameUUIDFromBytes((username + role).getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .param("organizationId", ORGANIZATION_ID)
                .param("userId", id)
                .param("role", role)
                .param("now", now)
                .param("actor", ADMIN_ID)
                .update();
    }

    private void seedStudents() {
        List<UUID> ids =
                List.of(
                        UUID.fromString("00000000-0000-4000-8000-000000000101"),
                        UUID.fromString("00000000-0000-4000-8000-000000000102"),
                        UUID.fromString("00000000-0000-4000-8000-000000000103"));
        List<String> names = List.of("Monica", "Leo", "Yuki");
        var now = clock.now();
        for (int index = 0; index < ids.size(); index++) {
            jdbc.sql(
                            "MERGE INTO student (id, organization_id, student_code, name, status, default_device_policy, primary_assistant_id, created_at, created_by, updated_at, updated_by, version) "
                                    + "KEY(id) VALUES (:id, :organizationId, :code, :name, 'ACTIVE', 'ALLOWED', :assistant, :now, :actor, :now, :actor, 0)")
                    .param("id", ids.get(index))
                    .param("organizationId", ORGANIZATION_ID)
                    .param("code", "DEV-" + (index + 1))
                    .param("name", names.get(index))
                    .param("assistant", ASSISTANT_ID)
                    .param("now", now)
                    .param("actor", ADMIN_ID)
                    .update();
            seedDefaultPattern(ids.get(index), now);
        }
    }

    private void seedDefaultPattern(UUID studentId, java.time.Instant now) {
        UUID patternId = UUID.nameUUIDFromBytes(("pattern:" + studentId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        jdbc.sql(
                        "MERGE INTO student_weekly_pattern (id, student_id, effective_from, status, created_at, created_by, updated_at, updated_by, version) "
                                + "KEY(id) VALUES (:id, :studentId, :effectiveFrom, 'ACTIVE', :now, :actor, :now, :actor, 0)")
                .param("id", patternId)
                .param("studentId", studentId)
                .param("effectiveFrom", LocalDate.of(2026, 1, 1))
                .param("now", now)
                .param("actor", ADMIN_ID)
                .update();
        for (short day = 1; day <= 7; day++) {
            jdbc.sql(
                            "MERGE INTO student_weekly_pattern_day (pattern_id, day_of_week, available, available_minutes) KEY(pattern_id, day_of_week) VALUES (:patternId, :day, true, 60)")
                    .param("patternId", patternId)
                    .param("day", day)
                    .update();
        }
    }

    private void seedTemplates() {
        var now = clock.now();
        for (int index = 1; index <= 3; index++) {
            UUID templateId = UUID.nameUUIDFromBytes(("template:DEV-" + index).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            UUID versionId = UUID.nameUUIDFromBytes(("template-version:DEV-" + index).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            String code = "DEV_TEMPLATE_" + index;
            jdbc.sql(
                            "MERGE INTO task_template (id, organization_id, template_code, name, short_name, subject_code, unit_label, default_duration_minutes, status, created_at, created_by, updated_at, updated_by, version) "
                                    + "KEY(id) VALUES (:id, :organizationId, :code, :name, :shortName, 'VOCABULARY', '节', 30, 'ACTIVE', :now, :actor, :now, :actor, 0)")
                    .param("id", templateId)
                    .param("organizationId", ORGANIZATION_ID)
                    .param("code", code)
                    .param("name", "开发模板 " + index)
                    .param("shortName", "开发" + index)
                    .param("now", now)
                    .param("actor", ADMIN_ID)
                    .update();
            jdbc.sql(
                            "MERGE INTO task_template_version (id, template_id, version_number, status, item_count, published_at, published_by, checksum, created_at, created_by, updated_at, updated_by, version) "
                                    + "KEY(id) VALUES (:id, :templateId, 1, 'PUBLISHED', 3, :now, :actor, :checksum, :now, :actor, :now, :actor, 0)")
                    .param("id", versionId)
                    .param("templateId", templateId)
                    .param("now", now)
                    .param("actor", ADMIN_ID)
                    .param("checksum", "dev-checksum-" + index)
                    .update();
            jdbc.sql("UPDATE task_template SET current_published_version_id = :versionId WHERE id = :templateId")
                    .param("versionId", versionId)
                    .param("templateId", templateId)
                    .update();
            for (int ordinal = 1; ordinal <= 3; ordinal++) {
                jdbc.sql(
                                "MERGE INTO task_template_item (id, template_version_id, ordinal, item_code, title, short_title, duration_minutes, created_at, created_by, updated_at, updated_by, version) "
                                        + "KEY(id) VALUES (:id, :versionId, :ordinal, :itemCode, :title, :shortTitle, 30, :now, :actor, :now, :actor, 0)")
                        .param("id", UUID.nameUUIDFromBytes((code + ":" + ordinal).getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                        .param("versionId", versionId)
                        .param("ordinal", ordinal)
                        .param("itemCode", code + "_" + ordinal)
                        .param("title", "开发单元 " + ordinal)
                        .param("shortTitle", "开发" + ordinal)
                        .param("now", now)
                        .param("actor", ADMIN_ID)
                        .update();
            }
        }
    }
}
