package com.wonderedu.assistant.curriculum.api;

import java.util.UUID;

public record TemplateItemView(
        UUID id,
        int ordinal,
        String itemCode,
        String title,
        String shortTitle,
        Integer durationMinutes,
        Boolean requiresDevice,
        String contentRef,
        String instructions,
        boolean active) {}
