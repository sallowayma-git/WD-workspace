package com.wonderedu.assistant.student.api;

import java.time.Instant;
import java.util.UUID;

/**
 * Read model for a student subject preference row (SDD §8.4, FR-PROFILE-006). Mirrors the
 * {@code student_subject_preference} table; returned by the profile endpoint and embedded in
 * {@link StudentView} when the profile is fetched.
 */
public record SubjectPreferenceView(
        UUID id,
        String subjectCode,
        int priority,
        java.math.BigDecimal targetRatio,
        String note,
        long version,
        Instant updatedAt) {}
