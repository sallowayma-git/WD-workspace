package com.wonderedu.assistant.student.persistence;

import com.wonderedu.assistant.student.api.StudentCommands;
import com.wonderedu.assistant.student.api.StudentView;
import com.wonderedu.assistant.student.api.SubjectPreferenceView;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class StudentRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;

    public StudentRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
    }

    public List<StudentView> findPage(String search, String status, int limit, int offset) {
        StringBuilder sql =
                new StringBuilder(
                        "SELECT id, student_code, name, alias, status, class_type, enrollment_date, "
                                + "default_device_policy, primary_assistant_id, note, version, updated_at "
                                + "FROM student WHERE organization_id = :organizationId");
        MapSqlParameterSource params =
                new MapSqlParameterSource("organizationId", TenantContext.requireOrganizationId());
        if (search != null && !search.isBlank()) {
            sql.append(" AND (name ILIKE :search OR alias ILIKE :search OR student_code ILIKE :search)");
            params.addValue("search", "%" + search.trim() + "%");
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = :status");
            params.addValue("status", status);
        } else {
            sql.append(" AND status <> 'ARCHIVED'");
        }
        sql.append(" ORDER BY name, id LIMIT :limit OFFSET :offset");
        params.addValue("limit", limit);
        params.addValue("offset", offset);
        List<StudentView> students = jdbc.query(sql.toString(), params, StudentRepository::mapRow);
        return attachTagsAndPreferences(students);
    }

    public long count(String search, String status) {
        StringBuilder sql =
                new StringBuilder(
                        "SELECT count(*) FROM student WHERE organization_id = :organizationId");
        MapSqlParameterSource params =
                new MapSqlParameterSource("organizationId", TenantContext.requireOrganizationId());
        if (search != null && !search.isBlank()) {
            sql.append(" AND (name ILIKE :search OR alias ILIKE :search OR student_code ILIKE :search)");
            params.addValue("search", "%" + search.trim() + "%");
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = :status");
            params.addValue("status", status);
        } else {
            sql.append(" AND status <> 'ARCHIVED'");
        }
        Long count = jdbc.queryForObject(sql.toString(), params, Long.class);
        return count == null ? 0 : count;
    }

    public Optional<StudentView> findById(UUID id) {
        List<StudentView> students =
                jdbc.query(
                                "SELECT id, student_code, name, alias, status, class_type, enrollment_date, "
                                        + "default_device_policy, primary_assistant_id, note, version, updated_at "
                                        + "FROM student WHERE organization_id = :organizationId AND id = :id",
                                new MapSqlParameterSource("organizationId", TenantContext.requireOrganizationId())
                                        .addValue("id", id),
                                StudentRepository::mapRow);
        List<StudentView> withTags = attachTagsAndPreferences(students);
        return withTags.isEmpty() ? Optional.empty() : Optional.of(withTags.get(0));
    }

    public StudentView insert(UUID id, StudentCommands.Create command, Instant now) {
        UUID actor = actorId();
        jdbc.update(
                "INSERT INTO student (id, organization_id, student_code, name, alias, status, class_type, "
                        + "enrollment_date, default_device_policy, primary_assistant_id, note, search_text, "
                        + "created_at, created_by, updated_at, updated_by, version) VALUES "
                        + "(:id, :organizationId, :studentCode, :name, :alias, 'ACTIVE', :classType, "
                        + ":enrollmentDate, :devicePolicy, :assistantId, :note, :searchText, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("studentCode", command.studentCode())
                        .addValue("name", command.name())
                        .addValue("alias", command.alias())
                        .addValue("classType", command.classType())
                        .addValue("enrollmentDate", command.enrollmentDate())
                        .addValue("devicePolicy", command.defaultDevicePolicy())
                        .addValue("assistantId", command.primaryAssistantId())
                        .addValue("note", command.note())
                        .addValue("searchText", searchText(command))
                        .addValue("now", now)
                        .addValue("actor", actor));
        replaceTags(id, command.tags(), now, actor);
        replaceSubjectPreferences(id, command.subjectPreferences(), now, actor);
        return findById(id).orElseThrow();
    }

    public Optional<StudentView> update(UUID id, StudentCommands.Update command, Instant now) {
        UUID actor = actorId();
        int updated =
                jdbc.update(
                        "UPDATE student SET name = :name, alias = :alias, status = :status, "
                                + "default_device_policy = :devicePolicy, primary_assistant_id = :assistantId, "
                                + "class_type = :classType, enrollment_date = :enrollmentDate, note = :note, "
                                + "search_text = :searchText, updated_at = :now, updated_by = :actor, version = version + 1 "
                                + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("id", id)
                                .addValue("name", command.name())
                                .addValue("alias", command.alias())
                                .addValue("status", command.status())
                                .addValue("devicePolicy", command.defaultDevicePolicy())
                                .addValue("assistantId", command.primaryAssistantId())
                                .addValue("classType", command.classType())
                                .addValue("enrollmentDate", command.enrollmentDate())
                                .addValue("note", command.note())
                                .addValue("searchText", String.join(" ", command.name(), command.alias() == null ? "" : command.alias()))
                                .addValue("now", now)
                                .addValue("actor", actor)
                                .addValue("expectedVersion", command.expectedVersion()));
        if (updated == 0) {
            return Optional.empty();
        }
        replaceTags(id, command.tags(), now, actor);
        replaceSubjectPreferences(id, command.subjectPreferences(), now, actor);
        return findById(id);
    }

    public void createDefaultWeeklyPattern(UUID studentId, LocalDate effectiveFrom, Instant now) {
        UUID patternId = idGenerator.next();
        UUID actor = actorId();
        jdbc.update(
                "INSERT INTO student_weekly_pattern (id, student_id, effective_from, status, created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :studentId, :effectiveFrom, 'ACTIVE', :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", patternId)
                        .addValue("studentId", studentId)
                        .addValue("effectiveFrom", effectiveFrom)
                        .addValue("now", now)
                        .addValue("actor", actor));
        for (int day = 1; day <= 7; day++) {
            jdbc.update(
                    "INSERT INTO student_weekly_pattern_day (pattern_id, day_of_week, available, available_minutes) "
                            + "VALUES (:patternId, :day, true, 0)",
                    Map.of("patternId", patternId, "day", day));
        }
    }

    private static StudentView mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new StudentView(
                rs.getObject("id", UUID.class),
                rs.getString("student_code"),
                rs.getString("name"),
                rs.getString("alias"),
                rs.getString("status"),
                rs.getString("class_type"),
                rs.getObject("enrollment_date", LocalDate.class),
                rs.getString("default_device_policy"),
                rs.getObject("primary_assistant_id", UUID.class),
                rs.getString("note"),
                List.of(),
                List.of(),
                rs.getLong("version"),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant());
    }

    private List<StudentView> attachTagsAndPreferences(List<StudentView> students) {
        if (students.isEmpty()) {
            return students;
        }
        List<UUID> ids = students.stream().map(StudentView::id).toList();
        Map<UUID, List<StudentView.StudentTag>> tagsByStudent = loadTags(ids);
        Map<UUID, List<SubjectPreferenceView>> prefsByStudent = loadSubjectPreferences(ids);
        return students.stream()
                .map(student -> new StudentView(
                        student.id(),
                        student.studentCode(),
                        student.name(),
                        student.alias(),
                        student.status(),
                        student.classType(),
                        student.enrollmentDate(),
                        student.defaultDevicePolicy(),
                        student.primaryAssistantId(),
                        student.note(),
                        tagsByStudent.getOrDefault(student.id(), List.of()),
                        prefsByStudent.getOrDefault(student.id(), List.of()),
                        student.version(),
                        student.updatedAt()))
                .toList();
    }

    private Map<UUID, List<StudentView.StudentTag>> loadTags(List<UUID> studentIds) {
        Map<UUID, List<StudentView.StudentTag>> tagsByStudent = new LinkedHashMap<>();
        if (studentIds.isEmpty()) {
            return tagsByStudent;
        }
        MapSqlParameterSource params = new MapSqlParameterSource("ids", studentIds);
        jdbc.query(
                "SELECT student_id, tag_code, tag_name_snapshot FROM student_tag "
                        + "WHERE student_id IN (:ids) ORDER BY student_id, tag_code",
                params,
                (rs, rowNum) -> {
                    UUID studentId = rs.getObject("student_id", UUID.class);
                    tagsByStudent
                            .computeIfAbsent(studentId, key -> new ArrayList<>())
                            .add(new StudentView.StudentTag(rs.getString("tag_code"), rs.getString("tag_name_snapshot")));
                    return null;
                });
        return tagsByStudent;
    }

    private void replaceTags(UUID studentId, List<StudentCommands.StudentTagInput> tags, Instant now, UUID actor) {
        if (tags == null) {
            return;
        }
        jdbc.update(
                "DELETE FROM student_tag WHERE student_id = :studentId",
                Map.of("studentId", studentId));
        for (StudentCommands.StudentTagInput tag : tags) {
            if (tag == null || tag.code() == null || tag.code().isBlank()) {
                continue;
            }
            String name = tag.name() == null || tag.name().isBlank() ? tag.code() : tag.name();
            jdbc.update(
                    "INSERT INTO student_tag (id, student_id, tag_code, tag_name_snapshot, created_at, created_by) "
                            + "VALUES (:id, :studentId, :code, :name, :now, :actor)",
                    new MapSqlParameterSource()
                            .addValue("id", idGenerator.next())
                            .addValue("studentId", studentId)
                            .addValue("code", tag.code())
                            .addValue("name", name)
                            .addValue("now", now)
                            .addValue("actor", actor));
        }
    }

    /** FR-PROFILE-006 学科倾向:替换式写入(先删后插),保证幂等的全量更新语义。 */
    private void replaceSubjectPreferences(
            UUID studentId,
            List<StudentCommands.SubjectPreferenceInput> preferences,
            Instant now,
            UUID actor) {
        if (preferences == null) {
            return;
        }
        jdbc.update(
                "DELETE FROM student_subject_preference WHERE student_id = :studentId",
                Map.of("studentId", studentId));
        for (StudentCommands.SubjectPreferenceInput preference : preferences) {
            if (preference == null || preference.subjectCode() == null || preference.subjectCode().isBlank()) {
                continue;
            }
            jdbc.update(
                    "INSERT INTO student_subject_preference "
                            + "(id, organization_id, student_id, subject_code, priority, target_ratio, note, "
                            + "created_at, created_by, updated_at, updated_by, version) "
                            + "VALUES (:id, :organizationId, :studentId, :subjectCode, :priority, :targetRatio, :note, "
                            + ":now, :actor, :now, :actor, 0)",
                    new MapSqlParameterSource()
                            .addValue("id", idGenerator.next())
                            .addValue("organizationId", TenantContext.requireOrganizationId())
                            .addValue("studentId", studentId)
                            .addValue("subjectCode", preference.subjectCode())
                            .addValue("priority", preference.priority())
                            .addValue("targetRatio", preference.targetRatio())
                            .addValue("note", preference.note())
                            .addValue("now", now)
                            .addValue("actor", actor));
        }
    }

    private Map<UUID, List<SubjectPreferenceView>> loadSubjectPreferences(List<UUID> studentIds) {
        Map<UUID, List<SubjectPreferenceView>> prefsByStudent = new LinkedHashMap<>();
        if (studentIds.isEmpty()) {
            return prefsByStudent;
        }
        MapSqlParameterSource params = new MapSqlParameterSource("ids", studentIds);
        jdbc.query(
                "SELECT id, student_id, subject_code, priority, target_ratio, note, version, updated_at "
                        + "FROM student_subject_preference WHERE student_id IN (:ids) "
                        + "ORDER BY student_id, priority, subject_code",
                params,
                (rs, rowNum) -> {
                    UUID studentId = rs.getObject("student_id", UUID.class);
                    prefsByStudent
                            .computeIfAbsent(studentId, key -> new ArrayList<>())
                            .add(new SubjectPreferenceView(
                                    rs.getObject("id", UUID.class),
                                    rs.getString("subject_code"),
                                    rs.getInt("priority"),
                                    rs.getObject("target_ratio", BigDecimal.class),
                                    rs.getString("note"),
                                    rs.getLong("version"),
                                    rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant()));
                    return null;
                });
        return prefsByStudent;
    }

    private static UUID actorId() {
        ActorContext.Actor actor = ActorContext.current();
        return actor == null ? SYSTEM_ACTOR : actor.id();
    }

    private static String searchText(StudentCommands.Create command) {
        return String.join(" ", command.studentCode(), command.name(), command.alias() == null ? "" : command.alias());
    }
}
