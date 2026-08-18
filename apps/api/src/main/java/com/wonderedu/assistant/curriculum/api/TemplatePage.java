package com.wonderedu.assistant.curriculum.api;

import java.util.List;

public record TemplatePage(List<TemplateView> items, int page, int size, long total, boolean hasNext) {}
