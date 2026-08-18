package com.wonderedu.assistant.student.api;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class StudentCommands {

    private StudentCommands() {}

    public record StudentTagInput(String code, String name) {}

    /** FR-PROFILE-006 学科倾向输入。{@code priority} 1-5, {@code targetRatio} 0-100。 */
    public record SubjectPreferenceInput(
            String subjectCode,
            int priority,
            java.math.BigDecimal targetRatio,
            String note) {}

    public record Create(
            String studentCode,
            String name,
            String alias,
            String defaultDevicePolicy,
            UUID primaryAssistantId,
            String classType,
            LocalDate enrollmentDate,
            String note,
            List<StudentTagInput> tags,
            List<SubjectPreferenceInput> subjectPreferences) {}

    public record Update(
            String name,
            String alias,
            String status,
            String defaultDevicePolicy,
            UUID primaryAssistantId,
            String classType,
            LocalDate enrollmentDate,
            String note,
            List<StudentTagInput> tags,
            List<SubjectPreferenceInput> subjectPreferences,
            long expectedVersion) {}
}
