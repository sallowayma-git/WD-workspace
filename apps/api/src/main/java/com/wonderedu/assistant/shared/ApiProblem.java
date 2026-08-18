package com.wonderedu.assistant.shared;

import java.net.URI;
import java.util.List;
import java.util.Map;

public record ApiProblem(
        URI type,
        String title,
        int status,
        String detail,
        String code,
        String requestId,
        List<FieldError> fieldErrors,
        Map<String, Object> current) {

    public record FieldError(String field, String message) {}
}
