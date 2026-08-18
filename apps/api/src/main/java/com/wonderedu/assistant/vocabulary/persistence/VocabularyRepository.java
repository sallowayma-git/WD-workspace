package com.wonderedu.assistant.vocabulary.persistence;

import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.VocabularyEntryView;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class VocabularyRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;

    public VocabularyRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
    }

    public UUID insertBatch(UUID studentId, LocalDate occurredDate, String sourceType,
                            String subjectCode, String sourceLabel, String note, String rawInput, Instant now) {
        UUID batchId = idGenerator.next();
        UUID actor = actorId();
        jdbc.update(
                "INSERT INTO vocabulary_batch (id, organization_id, student_id, occurred_date, source_type, "
                        + "subject_code, source_label, note, raw_input, created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :orgId, :studentId, :occurredDate, :sourceType, :subjectCode, :sourceLabel, :note, :rawInput, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", batchId)
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("occurredDate", occurredDate)
                        .addValue("sourceType", sourceType)
                        .addValue("subjectCode", subjectCode)
                        .addValue("sourceLabel", sourceLabel)
                        .addValue("note", note)
                        .addValue("rawInput", rawInput)
                        .addValue("now", now)
                        .addValue("actor", actor));
        return batchId;
    }

    public void insertEntry(UUID batchId, UUID studentId, String termOriginal, String termNormalized, Instant now) {
        UUID entryId = idGenerator.next();
        UUID actor = actorId();
        jdbc.update(
                "INSERT INTO vocabulary_entry (id, batch_id, student_id, term_original, term_normalized, status, "
                        + "created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :batchId, :studentId, :original, :normalized, 'ACTIVE', :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", entryId)
                        .addValue("batchId", batchId)
                        .addValue("studentId", studentId)
                        .addValue("original", termOriginal)
                        .addValue("normalized", termNormalized)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public List<VocabularyEntryView> findByStudentAndDateRange(UUID studentId, LocalDate fromDate, LocalDate toDate,
                                                              String subjectCode, int limit) {
        String subjectFilter = (subjectCode == null || subjectCode.isBlank())
                ? "" : "AND vb.subject_code = :subjectCode ";
        return jdbc.query(
                "SELECT ve.id, ve.batch_id, ve.student_id, ve.term_original, ve.term_normalized, ve.status, ve.note, ve.version, ve.created_at "
                        + "FROM vocabulary_entry ve "
                        + "JOIN vocabulary_batch vb ON vb.id = ve.batch_id AND vb.organization_id = :orgId "
                        + "WHERE ve.student_id = :studentId "
                        + "AND vb.occurred_date BETWEEN :fromDate AND :toDate "
                        + "AND ve.status <> 'ARCHIVED' "
                        + subjectFilter
                        + "ORDER BY ve.created_at DESC LIMIT :limit",
                new MapSqlParameterSource()
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("fromDate", fromDate)
                        .addValue("toDate", toDate)
                        .addValue("subjectCode", subjectCode)
                        .addValue("limit", limit),
                VocabularyRepository::mapEntry);
    }

    public int countByStudentThisWeek(UUID studentId, LocalDate weekStart) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM vocabulary_entry ve "
                        + "JOIN vocabulary_batch vb ON vb.id = ve.batch_id AND vb.organization_id = :orgId "
                        + "WHERE ve.student_id = :studentId "
                        + "AND vb.occurred_date >= :weekStart "
                        + "AND ve.status <> 'ARCHIVED'",
                new MapSqlParameterSource()
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("weekStart", weekStart),
                Integer.class);
        return count == null ? 0 : count;
    }

    public List<String> findExistingTerms(UUID studentId, List<String> normalizedTerms) {
        return jdbc.queryForList(
                "SELECT DISTINCT ve.term_normalized FROM vocabulary_entry ve "
                        + "JOIN vocabulary_batch vb ON vb.id = ve.batch_id AND vb.organization_id = :orgId "
                        + "WHERE ve.student_id = :studentId AND ve.term_normalized IN (:terms)",
                new MapSqlParameterSource()
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("terms", normalizedTerms),
                String.class);
    }

    /**
     * Loads a single {@code vocabulary_entry} for update, enforcing tenant isolation via
     * the parent {@code vocabulary_batch.organization_id} (BR-013 / SDD §18.3) — the entry
     * table itself has no organization_id column.
     */
    public Optional<VocabularyEntryView> findEntryByIdInTenant(UUID entryId) {
        List<VocabularyEntryView> rows = jdbc.query(
                "SELECT ve.id, ve.batch_id, ve.student_id, ve.term_original, ve.term_normalized, ve.status, ve.note, ve.version, ve.created_at "
                        + "FROM vocabulary_entry ve "
                        + "JOIN vocabulary_batch vb ON vb.id = ve.batch_id AND vb.organization_id = :orgId "
                        + "WHERE ve.id = :entryId",
                new MapSqlParameterSource()
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("entryId", entryId),
                VocabularyRepository::mapEntry);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * Optimistic-lock update of an entry's status and/or note. Returns empty when the
     * row's {@code version} no longer matches {@code expectedVersion} (or the row is not
     * visible to this tenant), so the caller can raise a 409 with the current snapshot.
     */
    public Optional<VocabularyEntryView> updateEntry(
            UUID entryId, String status, String note, boolean updateStatus, boolean updateNote, long expectedVersion, Instant now) {
        UUID actor = actorId();
        StringBuilder sql = new StringBuilder("UPDATE vocabulary_entry SET ");
        List<String> sets = new ArrayList<>();
        if (updateStatus) {
            sets.add("status = :status");
        }
        if (updateNote) {
            sets.add("note = :note");
        }
        sets.add("updated_at = :now");
        sets.add("updated_by = :actor");
        sets.add("version = version + 1");
        sql.append(String.join(", ", sets));
        sql.append(" WHERE id = :entryId AND version = :expectedVersion "
                + "AND EXISTS (SELECT 1 FROM vocabulary_batch vb WHERE vb.id = vocabulary_entry.batch_id "
                + "AND vb.organization_id = :orgId)");
        int updated = jdbc.update(sql.toString(),
                new MapSqlParameterSource()
                        .addValue("entryId", entryId)
                        .addValue("status", status)
                        .addValue("note", note)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor)
                        .addValue("orgId", TenantContext.requireOrganizationId()));
        if (updated == 0) {
            return Optional.empty();
        }
        return findEntryByIdInTenant(entryId);
    }

    private static VocabularyEntryView mapEntry(ResultSet rs, int rowNum) throws SQLException {
        return new VocabularyEntryView(
                rs.getObject("id", UUID.class),
                rs.getObject("batch_id", UUID.class),
                rs.getObject("student_id", UUID.class),
                rs.getString("term_original"),
                rs.getString("term_normalized"),
                rs.getString("status"),
                rs.getString("note"),
                rs.getLong("version"),
                rs.getObject("created_at", java.time.OffsetDateTime.class).toInstant());
    }

    private static UUID actorId() {
        ActorContext.Actor actor = ActorContext.current();
        return actor == null ? SYSTEM_ACTOR : actor.id();
    }
}
