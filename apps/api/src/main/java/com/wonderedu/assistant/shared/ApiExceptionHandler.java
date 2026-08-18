package com.wonderedu.assistant.shared;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(DomainException.class)
    ResponseEntity<ApiProblem> handleDomain(DomainException exception, HttpServletRequest request) {
        return problem(
                exception.status(),
                exception.code(),
                exception.getMessage(),
                exception.fieldErrors(),
                exception.current(),
                request);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiProblem> handleMalformedJson(
            HttpMessageNotReadableException exception, HttpServletRequest request) {
        System.getLogger("ApiExceptionHandler")
                .log(System.Logger.Level.WARNING, "Malformed request body for " + request.getMethod() + " " + request.getRequestURI(), exception);
        return problem(
                HttpStatus.BAD_REQUEST.value(),
                "MALFORMED_REQUEST",
                "请求体格式无效",
                List.of(),
                Map.of(),
                request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiProblem> handleValidation(
            MethodArgumentNotValidException exception, HttpServletRequest request) {
        List<ApiProblem.FieldError> fieldErrors =
                exception.getBindingResult().getFieldErrors().stream()
                        .map(
                                fieldError ->
                                        new ApiProblem.FieldError(
                                                fieldError.getField(),
                                                fieldError.getDefaultMessage() == null
                                                        ? "字段无效"
                                                        : fieldError.getDefaultMessage()))
                        .toList();
        return problem(
                HttpStatus.UNPROCESSABLE_CONTENT.value(),
                "VALIDATION_FAILED",
                "请求字段未通过校验",
                fieldErrors,
                Map.of(),
                request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiProblem> handleUnexpected(Exception exception, HttpServletRequest request) {
        // Log the full stack trace so unexpected failures are diagnosable.
        // Without this the exception is silently swallowed and the only
        // signal is a generic 500 body with "服务暂时不可用".
        System.getLogger("ApiExceptionHandler")
                .log(System.Logger.Level.ERROR, "Unhandled exception for " + request.getMethod() + " " + request.getRequestURI(), exception);
        return problem(
                HttpStatus.INTERNAL_SERVER_ERROR.value(),
                "INTERNAL_ERROR",
                "服务暂时不可用，请稍后重试",
                List.of(),
                Map.of(),
                request);
    }

    private ResponseEntity<ApiProblem> problem(
            int status,
            String code,
            String detail,
            List<ApiProblem.FieldError> fieldErrors,
            Map<String, Object> current,
            HttpServletRequest request) {
        String title = title(status);
        String requestId = RequestIdContext.currentOrCreate();
        ApiProblem body =
                new ApiProblem(
                        URI.create("https://errors.wonderedu.com/" + code.toLowerCase()),
                        title,
                        status,
                        detail,
                        code,
                        requestId,
                        fieldErrors,
                        current);
        return ResponseEntity.status(status)
                .header(RequestIdFilter.HEADER_NAME, requestId)
                .header("Content-Type", "application/problem+json")
                .body(body);
    }

    private String title(int status) {
        HttpStatus httpStatus = HttpStatus.resolve(status);
        return httpStatus == null ? "请求失败" : httpStatus.getReasonPhrase();
    }
}
