package com.wonderedu.assistant.student.api;

import java.util.List;

public record StudentPage(List<StudentView> items, int page, int size, long total, boolean hasNext) {}
