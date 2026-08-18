package com.wonderedu.assistant.shared;

import java.util.List;
import java.util.Map;

public class DomainException extends RuntimeException {

    private final int status;
    private final String code;
    private final List<ApiProblem.FieldError> fieldErrors;
    private final Map<String, Object> current;

    public DomainException(int status, String code, String message) {
        this(status, code, message, List.of(), Map.of());
    }

    public DomainException(
            int status,
            String code,
            String message,
            List<ApiProblem.FieldError> fieldErrors,
            Map<String, Object> current) {
        super(message);
        this.status = status;
        this.code = code;
        this.fieldErrors = List.copyOf(fieldErrors);
        this.current = Map.copyOf(current);
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    public List<ApiProblem.FieldError> fieldErrors() {
        return fieldErrors;
    }

    public Map<String, Object> current() {
        return current;
    }
}
