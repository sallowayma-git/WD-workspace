package com.wonderedu.assistant.student.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record StudentView(
        UUID id,
        String studentCode,
        String name,
        String alias,
        String status,
        String classType,
        LocalDate enrollmentDate,
        String defaultDevicePolicy,
        UUID primaryAssistantId,
        String note,
        List<StudentTag> tags,
        List<SubjectPreferenceView> subjectPreferences,
        long version,
        Instant updatedAt) {

    public record StudentTag(String code, String name) {}
}
