package com.wonderedu.assistant.student.persistence;

import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import com.wonderedu.assistant.student.api.WeekPlanCommands;
import com.wonderedu.assistant.student.api.WeekPlanView;
import com.wonderedu.assistant.student.api.WeeklyPatternView;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class WeekPlanRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;

    public WeekPlanRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
    }

    // ------------------------------------------------------------------
    // Weekly pattern
    // ------------------------------------------------------------------

    public Optional<WeeklyPatternView> findActivePattern(UUID studentId) {
        Optional<WeeklyPatternView> pattern =
                jdbc.query(
                                "SELECT id, student_id, effective_from, effective_to, status, version, updated_at "
                                        + "FROM student_weekly_pattern "
                                        + "WHERE student_id = :studentId AND status = 'ACTIVE' "
                                        + "AND EXISTS (SELECT 1 FROM student s WHERE s.id = student_id AND s.organization_id = :organizationId)",
                                patternParams(studentId),
                                WeekPlanRepository::mapPatternRow)
                        .stream()
                        .findFirst();
        if (pattern.isEmpty()) {
            return pattern;
        }
        List<WeeklyPatternView.DayItem> days = findPatternDays(pattern.get().id());
        return Optional.of(withDays(pattern.get(), days));
    }

    public List<WeeklyPatternView.DayItem> findPatternDays(UUID patternId) {
        return jdbc.query(
                "SELECT day_of_week, available, available_minutes, device_policy_override "
                        + "FROM student_weekly_pattern_day WHERE pattern_id = :patternId ORDER BY day_of_week",
                Map.of("patternId", patternId),
                WeekPlanRepository::mapPatternDayRow);
    }

    public int retireActivePattern(UUID studentId, LocalDate effectiveTo, Instant now) {
        return jdbc.update(
                "UPDATE student_weekly_pattern SET status = 'RETIRED', effective_to = :effectiveTo, "
                        + "updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE student_id = :studentId AND status = 'ACTIVE' "
                        + "AND EXISTS (SELECT 1 FROM student s WHERE s.id = student_id AND s.organization_id = :organizationId)",
                patternParams(studentId)
                        .addValue("effectiveTo", effectiveTo)
                        .addValue("now", now)
                        .addValue("actor", actorId()));
    }

    public UUID insertPattern(
            UUID studentId,
            LocalDate effectiveFrom,
            List<WeekPlanCommands.SaveWeeklyPattern.DayItem> days,
            Instant now) {
        UUID patternId = idGenerator.next();
        UUID actor = actorId();
        jdbc.update(
                "INSERT INTO student_weekly_pattern (id, student_id, effective_from, status, created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :studentId, :effectiveFrom, 'ACTIVE', :now, :actor, :now, :actor, 0)",
                patternParams(studentId)
                        .addValue("id", patternId)
                        .addValue("effectiveFrom", effectiveFrom)
                        .addValue("now", now)
                        .addValue("actor", actor));
        for (WeekPlanCommands.SaveWeeklyPattern.DayItem day : days) {
            jdbc.update(
                    "INSERT INTO student_weekly_pattern_day (pattern_id, day_of_week, available, available_minutes, device_policy_override) "
                            + "VALUES (:patternId, :dayOfWeek, :available, :availableMinutes, :devicePolicyOverride)",
                    new MapSqlParameterSource()
                            .addValue("patternId", patternId)
                            .addValue("dayOfWeek", day.dayOfWeek())
                            .addValue("available", day.available())
                            .addValue("availableMinutes", day.availableMinutes())
                            .addValue("devicePolicyOverride", day.devicePolicyOverride()));
        }
        return patternId;
    }

    // ------------------------------------------------------------------
    // Week plan
    // ------------------------------------------------------------------

    public Optional<WeekPlanView> findWeekPlan(UUID studentId, LocalDate weekStart) {
        Optional<WeekPlanView> plan =
                jdbc.query(
                                "SELECT p.id, p.student_id, p.week_start_date, p.source_type, p.source_id, p.status, "
                                        + "p.confirmed_at, p.version, p.updated_at "
                                        + "FROM student_week_plan p "
                                        + "JOIN student s ON s.id = p.student_id "
                                        + "WHERE s.organization_id = :organizationId AND p.student_id = :studentId AND p.week_start_date = :weekStart",
                                weekPlanParams(studentId, weekStart),
                                WeekPlanRepository::mapWeekPlanRow)
                        .stream()
                        .findFirst();
        if (plan.isEmpty()) {
            return plan;
        }
        List<WeekPlanView.DayAvailability> days = findDayAvailabilities(plan.get().id());
        return Optional.of(withDays(plan.get(), days));
    }

    public List<WeekPlanView.DayAvailability> findDayAvailabilities(UUID weekPlanId) {
        return jdbc.query(
                "SELECT id, week_plan_id, business_date, available, available_minutes, device_policy_override, note, version "
                        + "FROM student_day_availability WHERE week_plan_id = :weekPlanId ORDER BY business_date",
                Map.of("weekPlanId", weekPlanId),
                WeekPlanRepository::mapDayAvailabilityRow);
    }

    public Optional<WeekPlanView> findPreviousWeekPlan(UUID studentId, LocalDate weekStart) {
        return jdbc.query(
                        "SELECT p.id, p.student_id, p.week_start_date, p.source_type, p.source_id, p.status, "
                                + "p.confirmed_at, p.version, p.updated_at "
                                + "FROM student_week_plan p "
                                + "JOIN student s ON s.id = p.student_id "
                                + "WHERE s.organization_id = :organizationId AND p.student_id = :studentId "
                                + "AND p.week_start_date < :weekStart "
                                + "ORDER BY p.week_start_date DESC LIMIT 1",
                        weekPlanParams(studentId, weekStart),
                        WeekPlanRepository::mapWeekPlanRow)
                .stream()
                .findFirst()
                .map(plan -> withDays(plan, findDayAvailabilities(plan.id())));
    }

    public UUID insertWeekPlan(
            UUID studentId,
            LocalDate weekStart,
            String sourceType,
            UUID sourceId,
            List<DayAvailabilitySeed> days,
            Instant now) {
        UUID planId = idGenerator.next();
        UUID actor = actorId();
        jdbc.update(
                "INSERT INTO student_week_plan (id, student_id, week_start_date, source_type, source_id, status, created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :studentId, :weekStart, :sourceType, :sourceId, 'DRAFT', :now, :actor, :now, :actor, 0)",
                weekPlanParams(studentId, weekStart)
                        .addValue("id", planId)
                        .addValue("sourceType", sourceType)
                        .addValue("sourceId", sourceId)
                        .addValue("now", now)
                        .addValue("actor", actor));
        for (DayAvailabilitySeed day : days) {
            jdbc.update(
                    "INSERT INTO student_day_availability (id, week_plan_id, student_id, business_date, available, available_minutes, device_policy_override, note, created_at, created_by, updated_at, updated_by, version) "
                            + "VALUES (:id, :weekPlanId, :studentId, :businessDate, :available, :availableMinutes, :devicePolicyOverride, :note, :now, :actor, :now, :actor, 0)",
                    new MapSqlParameterSource()
                            .addValue("id", idGenerator.next())
                            .addValue("weekPlanId", planId)
                            .addValue("studentId", studentId)
                            .addValue("businessDate", day.businessDate())
                            .addValue("available", day.available())
                            .addValue("availableMinutes", day.availableMinutes())
                            .addValue("devicePolicyOverride", day.devicePolicyOverride())
                            .addValue("note", day.note())
                            .addValue("now", now)
                            .addValue("actor", actor));
        }
        return planId;
    }

    public void deleteWeekPlan(UUID weekPlanId, Instant now) {
        UUID actor = actorId();
        jdbc.update(
                "DELETE FROM student_day_availability WHERE week_plan_id = :weekPlanId",
                Map.of("weekPlanId", weekPlanId));
        jdbc.update(
                "DELETE FROM student_week_plan WHERE id = :weekPlanId",
                Map.of("weekPlanId", weekPlanId));
    }

    // ------------------------------------------------------------------
    // Row mappers
    // ------------------------------------------------------------------

    private static WeeklyPatternView mapPatternRow(ResultSet rs, int rowNum) throws SQLException {
        return new WeeklyPatternView(
                rs.getObject("id", UUID.class),
                rs.getObject("student_id", UUID.class),
                rs.getObject("effective_from", LocalDate.class),
                rs.getObject("effective_to", LocalDate.class),
                rs.getString("status"),
                List.of(),
                rs.getLong("version"),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant());
    }

    private static WeeklyPatternView.DayItem mapPatternDayRow(ResultSet rs, int rowNum) throws SQLException {
        return new WeeklyPatternView.DayItem(
                rs.getInt("day_of_week"),
                rs.getBoolean("available"),
                rs.getInt("available_minutes"),
                rs.getString("device_policy_override"));
    }

    private static WeekPlanView mapWeekPlanRow(ResultSet rs, int rowNum) throws SQLException {
        java.time.OffsetDateTime confirmedAt = rs.getObject("confirmed_at", java.time.OffsetDateTime.class);
        return new WeekPlanView(
                rs.getObject("id", UUID.class),
                rs.getObject("student_id", UUID.class),
                rs.getObject("week_start_date", LocalDate.class),
                rs.getString("source_type"),
                rs.getObject("source_id", UUID.class),
                rs.getString("status"),
                confirmedAt == null ? null : confirmedAt.toInstant(),
                List.of(),
                rs.getLong("version"),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant());
    }

    private static WeekPlanView.DayAvailability mapDayAvailabilityRow(ResultSet rs, int rowNum) throws SQLException {
        return new WeekPlanView.DayAvailability(
                rs.getObject("id", UUID.class),
                rs.getObject("business_date", LocalDate.class),
                rs.getBoolean("available"),
                rs.getInt("available_minutes"),
                rs.getString("device_policy_override"),
                rs.getString("note"),
                rs.getLong("version"));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private MapSqlParameterSource patternParams(UUID studentId) {
        return new MapSqlParameterSource()
                .addValue("organizationId", TenantContext.requireOrganizationId())
                .addValue("studentId", studentId);
    }

    private MapSqlParameterSource weekPlanParams(UUID studentId, LocalDate weekStart) {
        return patternParams(studentId).addValue("weekStart", weekStart);
    }

    private static WeeklyPatternView withDays(WeeklyPatternView pattern, List<WeeklyPatternView.DayItem> days) {
        return new WeeklyPatternView(
                pattern.id(),
                pattern.studentId(),
                pattern.effectiveFrom(),
                pattern.effectiveTo(),
                pattern.status(),
                days,
                pattern.version(),
                pattern.updatedAt());
    }

    private static WeekPlanView withDays(WeekPlanView plan, List<WeekPlanView.DayAvailability> days) {
        return new WeekPlanView(
                plan.id(),
                plan.studentId(),
                plan.weekStartDate(),
                plan.sourceType(),
                plan.sourceId(),
                plan.status(),
                plan.confirmedAt(),
                days,
                plan.version(),
                plan.updatedAt());
    }

    private static UUID actorId() {
        ActorContext.Actor actor = ActorContext.current();
        return actor == null ? SYSTEM_ACTOR : actor.id();
    }

    /** Seed value for a single student_day_availability row. */
    public record DayAvailabilitySeed(
            LocalDate businessDate,
            boolean available,
            int availableMinutes,
            String devicePolicyOverride,
            String note) {}
}
