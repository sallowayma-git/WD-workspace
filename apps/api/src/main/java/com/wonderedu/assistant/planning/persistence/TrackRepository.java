package com.wonderedu.assistant.planning.persistence;

import com.wonderedu.assistant.planning.api.TrackView;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TrackRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;

    public TrackRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
    }

    public Optional<TrackView> findById(UUID id) {
        return jdbc.query(
                        baseSelect() + " AND t.id = :id",
                        baseParams().addValue("id", id),
                        TrackRepository::mapRow)
                .stream()
                .findFirst();
    }

    /**
     * Acquire a row-level pessimistic lock on the track row before recalculating the pointer, so the
     * read-then-update sequence in {@link TrackService#recalculateAndPersist} is serialized against
     * concurrent recalculations on the same track. Mirrors the optimistic version check but enforces
     * mutual exclusion at the database level per SDD §9.3. Returns silently if the track does not
     * exist; callers rely on the subsequent {@link #findById} to surface a 404.
     */
    public void lockById(UUID trackId) {
        jdbc.query(
                "SELECT id FROM student_task_track WHERE organization_id = :orgId AND id = :id FOR UPDATE",
                baseParams().addValue("id", trackId),
                (rs, rowNum) -> rs.getObject("id", UUID.class));
    }

    public List<TrackView> findByStudent(UUID studentId, String status) {
        StringBuilder sql = new StringBuilder(baseSelect()).append(" AND t.student_id = :studentId");
        MapSqlParameterSource params = baseParams().addValue("studentId", studentId);
        if (status != null && !status.isBlank()) {
            sql.append(" AND t.status = :status");
            params.addValue("status", status);
        }
        sql.append(" ORDER BY t.priority DESC, t.created_at, t.id");
        return jdbc.query(sql.toString(), params, TrackRepository::mapRow);
    }

    public int countActiveByStudentTemplate(UUID studentId, UUID templateId, UUID excludeTrackId) {
        StringBuilder sql =
                new StringBuilder(
                        "SELECT count(*) FROM student_task_track WHERE organization_id = :organizationId "
                                + "AND student_id = :studentId AND template_id = :templateId "
                                + "AND status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED')");
        MapSqlParameterSource params =
                baseParams().addValue("studentId", studentId).addValue("templateId", templateId);
        if (excludeTrackId != null) {
            sql.append(" AND id <> :excludeTrackId");
            params.addValue("excludeTrackId", excludeTrackId);
        }
        Integer count = jdbc.queryForObject(sql.toString(), params, Integer.class);
        return count == null ? 0 : count;
    }

    public TrackView insert(
            UUID id, TrackView view, boolean createFirstInstance, Instant now, UUID actor) {
        jdbc.update(
                "INSERT INTO student_task_track (id, organization_id, student_id, template_id, template_version_id, "
                        + "status, start_ordinal, current_ordinal, end_ordinal, default_units_per_session, "
                        + "start_date, next_candidate_date, priority, allow_parallel_items, scheduling_policy, "
                        + "duration_override_minutes, device_policy_override, note, created_at, created_by, "
                        + "updated_at, updated_by, version) VALUES "
                        + "(:id, :organizationId, :studentId, :templateId, :templateVersionId, :status, "
                        + ":startOrdinal, :currentOrdinal, :endOrdinal, :defaultUnitsPerSession, :startDate, "
                        + ":nextCandidateDate, :priority, :allowParallelItems, :schedulingPolicy, "
                        + ":durationOverrideMinutes, :devicePolicyOverride, :note, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("studentId", view.studentId())
                        .addValue("templateId", view.templateId())
                        .addValue("templateVersionId", view.templateVersionId())
                        .addValue("status", view.status())
                        .addValue("startOrdinal", view.startOrdinal())
                        .addValue("currentOrdinal", view.currentOrdinal())
                        .addValue("endOrdinal", view.endOrdinal())
                        .addValue("defaultUnitsPerSession", view.defaultUnitsPerSession())
                        .addValue("startDate", view.startDate())
                        .addValue("nextCandidateDate", view.nextCandidateDate())
                        .addValue("priority", view.priority())
                        .addValue("allowParallelItems", view.allowParallelItems())
                        .addValue("schedulingPolicy", view.schedulingPolicy())
                        .addValue("durationOverrideMinutes", view.durationOverrideMinutes())
                        .addValue("devicePolicyOverride", view.devicePolicyOverride())
                        .addValue("note", view.note())
                        .addValue("now", now)
                        .addValue("actor", actor));
        return findById(id).orElseThrow();
    }

    public int updatePointer(UUID trackId, int currentOrdinal, String status, Instant completedAt, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE student_task_track SET current_ordinal = :currentOrdinal, status = :status, "
                        + "completed_at = :completedAt, updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :trackId AND version = :expectedVersion",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("trackId", trackId)
                        .addValue("currentOrdinal", currentOrdinal)
                        .addValue("status", status)
                        .addValue("completedAt", completedAt)
                        .addValue("now", now)
                        .addValue("actor", actor)
                        .addValue("expectedVersion", expectedVersion));
    }

    /**
     * SDD §11 — lifecycle status transition for a track (PAUSED / ACTIVE / CANCELLED). Applies
     * optimistic locking via {@code expectedVersion} and is scoped to the current tenant. The
     * caller is responsible for validating that the transition is legal from the current status.
     * Returns the number of affected rows (0 indicates a version conflict or a no-op).
     */
    public int updateStatus(UUID trackId, String status, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE student_task_track SET status = :status, updated_at = :now, updated_by = :actor, "
                        + "version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :trackId AND version = :expectedVersion",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("trackId", trackId)
                        .addValue("status", status)
                        .addValue("now", now)
                        .addValue("actor", actor)
                        .addValue("expectedVersion", expectedVersion));
    }

    public Set<Integer> findCompletedOrdinals(UUID trackId) {
        List<Integer> ordinals =
                jdbc.queryForList(
                        "SELECT DISTINCT ti.item_ordinal FROM task_instance ti "
                                + "WHERE ti.organization_id = :organizationId AND ti.track_id = :trackId "
                                + "AND ti.status = 'COMPLETED' AND ti.item_ordinal IS NOT NULL "
                                + "ORDER BY ti.item_ordinal",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("trackId", trackId),
                        Integer.class);
        java.util.Set<Integer> result = new java.util.TreeSet<>();
        for (Integer ordinal : ordinals) {
            result.add(ordinal);
        }
        return result;
    }

    public long countPendingForTrackOrdinal(UUID trackId, int itemOrdinal) {
        Long count =
                jdbc.queryForObject(
                        "SELECT count(*) FROM task_instance WHERE organization_id = :organizationId "
                                + "AND track_id = :trackId AND item_ordinal = :itemOrdinal AND status = 'PENDING'",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("trackId", trackId)
                                .addValue("itemOrdinal", itemOrdinal),
                        Long.class);
        return count == null ? 0 : count;
    }

    private String baseSelect() {
        return "SELECT t.id, t.student_id, t.template_id, t.template_version_id, t.status, t.start_ordinal, "
                + "t.current_ordinal, t.end_ordinal, t.default_units_per_session, t.start_date, "
                + "t.next_candidate_date, t.priority, t.allow_parallel_items, t.scheduling_policy, "
                + "t.duration_override_minutes, t.device_policy_override, t.note, t.completed_at, t.version, t.updated_at "
                + "FROM student_task_track t WHERE t.organization_id = :organizationId";
    }

    private MapSqlParameterSource baseParams() {
        return new MapSqlParameterSource("organizationId", TenantContext.requireOrganizationId());
    }

    private static TrackView mapRow(ResultSet rs, int rowNum) throws SQLException {
        return TrackView.from(
                rs.getObject("id", UUID.class),
                rs.getObject("student_id", UUID.class),
                rs.getObject("template_id", UUID.class),
                rs.getObject("template_version_id", UUID.class),
                rs.getString("status"),
                rs.getInt("start_ordinal"),
                rs.getInt("current_ordinal"),
                rs.getInt("end_ordinal"),
                rs.getInt("default_units_per_session"),
                rs.getObject("start_date", LocalDate.class),
                rs.getObject("next_candidate_date", LocalDate.class),
                rs.getInt("priority"),
                rs.getBoolean("allow_parallel_items"),
                rs.getString("scheduling_policy"),
                (Integer) rs.getObject("duration_override_minutes"),
                rs.getString("device_policy_override"),
                rs.getString("note"),
                rs.getObject("completed_at") == null
                        ? null
                        : rs.getObject("completed_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getLong("version"),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant());
    }

    public static UUID actorId() {
        ActorContext.Actor actor = ActorContext.current();
        return actor == null ? SYSTEM_ACTOR : actor.id();
    }

    public IdGenerator idGenerator() {
        return idGenerator;
    }
}
