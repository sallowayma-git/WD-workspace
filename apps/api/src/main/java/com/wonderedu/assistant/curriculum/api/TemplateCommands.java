package com.wonderedu.assistant.curriculum.api;

import java.util.List;

public final class TemplateCommands {

    private TemplateCommands() {}

    public record Create(
            String templateCode,
            String name,
            String shortName,
            String subjectCode,
            String categoryCode,
            String unitLabel,
            Integer defaultDurationMinutes,
            boolean defaultRequiresDevice,
            String description) {}

    public record Item(
            int ordinal,
            String itemCode,
            String title,
            String shortTitle,
            Integer durationMinutes,
            Boolean requiresDevice,
            String contentRef,
            String instructions,
            boolean active) {}

    public record ReplaceItems(List<Item> items, String changeNote) {}
}
