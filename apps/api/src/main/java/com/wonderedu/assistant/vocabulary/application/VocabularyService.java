package com.wonderedu.assistant.vocabulary.application;

import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.TenantContext;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.PreviewBatchRequest;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.PreviewBatchResponse;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.PreviewEntry;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.SaveBatchRequest;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.UpdateEntryRequest;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.VocabularyEntryView;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.VocabularyListResponse;
import com.wonderedu.assistant.vocabulary.persistence.VocabularyRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class VocabularyService {

    private final VocabularyRepository repository;
    private final NamedParameterJdbcTemplate jdbc;
    private final BusinessClock clock;
    private final String timezone;

    public VocabularyService(
            VocabularyRepository repository,
            NamedParameterJdbcTemplate jdbc,
            BusinessClock clock,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this.repository = repository;
        this.jdbc = jdbc;
        this.clock = clock;
        this.timezone = properties.businessTimezone();
    }

    /**
     * Guards BR-013 / SDD §18.3 tenant isolation: the {@code studentId} arrives from a
     * {@code @PathVariable} and could reference a student in another organization. Verify the
     * student belongs to the caller's organization before any read/write against vocabulary
     * tables, mirroring the org-scoped {@code loadStudent} guard used by ScheduleService.
     */
    private void requireStudentInTenant(UUID studentId) {
        Integer ok = jdbc.queryForObject(
                "SELECT count(*) FROM student WHERE id = :id AND organization_id = :orgId",
                new MapSqlParameterSource()
                        .addValue("id", studentId)
                        .addValue("orgId", TenantContext.requireOrganizationId()),
                Integer.class);
        if (ok == null || ok == 0) {
            throw new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在");
        }
    }

    @Transactional(readOnly = true)
    public PreviewBatchResponse previewBatch(UUID studentId, PreviewBatchRequest request) {
        requireStudentInTenant(studentId);
        if (request.rawText() == null || request.rawText().isBlank()) {
            throw new DomainException(422, "VOCAB_EMPTY_INPUT", "生词输入不能为空");
        }
        List<String> terms = parseTerms(request.rawText());
        if (terms.size() > 500) {
            throw new DomainException(422, "VOCAB_TOO_MANY", "单批次生词不能超过 500 个");
        }
        List<String> normalized = terms.stream().map(this::normalize).toList();
        List<String> existing = repository.findExistingTerms(studentId, normalized);
        Set<String> existingSet = new HashSet<>(existing);
        Set<String> seenInBatch = new HashSet<>();
        List<PreviewEntry> entries = new ArrayList<>();
        int dupCount = 0;
        for (int i = 0; i < terms.size(); i++) {
            String norm = normalized.get(i);
            boolean isDup = existingSet.contains(norm) || !seenInBatch.add(norm);
            if (isDup) dupCount++;
            entries.add(new PreviewEntry(terms.get(i), norm, isDup));
        }
        return new PreviewBatchResponse(entries, terms.size(), dupCount, existing);
    }

    @Transactional
    public UUID saveBatch(UUID studentId, SaveBatchRequest request) {
        requireStudentInTenant(studentId);
        if (request.terms() == null || request.terms().isEmpty()) {
            throw new DomainException(422, "VOCAB_EMPTY", "生词列表不能为空");
        }
        if (request.terms().size() > 500) {
            throw new DomainException(422, "VOCAB_TOO_MANY", "单批次生词不能超过 500 个");
        }
        LocalDate occurredDate = request.occurredDate() != null
                ? request.occurredDate()
                : clock.businessDate(ZoneId.of(timezone));
        UUID batchId = repository.insertBatch(
                studentId, occurredDate,
                request.sourceType() != null ? request.sourceType() : "MANUAL",
                request.subjectCode(), request.sourceLabel(),
                null, request.rawText(), clock.now());
        for (String term : request.terms()) {
            String trimmed = term.trim();
            if (trimmed.isEmpty()) continue;
            String normalized = normalize(trimmed);
            repository.insertEntry(batchId, studentId, trimmed, normalized, clock.now());
        }
        return batchId;
    }

    @Transactional(readOnly = true)
    public VocabularyListResponse listByStudent(UUID studentId, LocalDate fromDate, LocalDate toDate,
                                                String subjectCode, int limit) {
        requireStudentInTenant(studentId);
        int safeLimit = Math.min(Math.max(limit, 1), 500);
        List<VocabularyEntryView> entries = repository.findByStudentAndDateRange(
                studentId, fromDate, toDate, subjectCode, safeLimit);
        return new VocabularyListResponse(entries, entries.size());
    }

    @Transactional(readOnly = true)
    public int countThisWeek(UUID studentId) {
        requireStudentInTenant(studentId);
        LocalDate today = clock.businessDate(ZoneId.of(timezone));
        LocalDate weekStart = today.minusDays(today.getDayOfWeek().getValue() - 1);
        return repository.countByStudentThisWeek(studentId, weekStart);
    }

    /**
     * PATCH /api/v1/vocabulary/entries/{id} — SDD §11.8 修改状态/备注.
     * <p>Tenant isolation is enforced inside {@link VocabularyRepository#findEntryByIdInTenant}
     * / {@link VocabularyRepository#updateEntry} via the parent {@code vocabulary_batch}
     * organization_id (the entry table itself has no organization column). Optimistic
     * locking (BR-013 / AC-013): a version mismatch yields 409 with the current snapshot
     * so the client can re-apply.
     */
    @Transactional
    public VocabularyEntryView updateEntry(UUID entryId, UpdateEntryRequest request) {
        if (request.expectedVersion() == null) {
            throw new DomainException(422, "VOCAB_VERSION_REQUIRED", "缺少版本号");
        }
        boolean updateStatus = request.status() != null;
        boolean updateNote = request.note() != null;
        if (!updateStatus && !updateNote) {
            throw new DomainException(422, "VOCAB_NOTHING_TO_UPDATE", "状态或备注至少修改一项");
        }
        if (updateStatus) {
            String status = request.status();
            if (!"ACTIVE".equals(status) && !"MASTERED".equals(status) && !"ARCHIVED".equals(status)) {
                throw new DomainException(
                        422,
                        "VOCAB_INVALID_STATUS",
                        "生词状态必须为 ACTIVE / MASTERED / ARCHIVED");
            }
        }
        if (updateNote && request.note().length() > 1000) {
            throw new DomainException(422, "VOCAB_NOTE_TOO_LONG", "备注不能超过 1000 字");
        }
        VocabularyEntryView current = repository
                .findEntryByIdInTenant(entryId)
                .orElseThrow(() -> new DomainException(404, "VOCAB_ENTRY_NOT_FOUND", "生词条目不存在"));
        return repository
                .updateEntry(
                        entryId,
                        request.status(),
                        request.note(),
                        updateStatus,
                        updateNote,
                        request.expectedVersion(),
                        clock.now())
                .orElseThrow(
                        () -> new DomainException(
                                409,
                                "VOCAB_ENTRY_VERSION_CONFLICT",
                                "生词条目已被其他用户修改",
                                List.of(),
                                java.util.Map.of("id", entryId, "version", current.version())));
    }

    public List<String> parseTerms(String rawText) {
        String[] parts = rawText.split("[\\n,，\\t;；]");
        List<String> terms = new ArrayList<>();
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                terms.add(trimmed);
            }
        }
        return terms;
    }

    public String normalize(String term) {
        return term.trim().toLowerCase().replaceAll("\\s+", " ");
    }
}
