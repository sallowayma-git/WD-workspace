package com.wonderedu.assistant.student.application;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.student.api.StudentCommands;
import com.wonderedu.assistant.student.api.StudentView;
import com.wonderedu.assistant.student.persistence.StudentRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class StudentServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-15T16:30:00Z");
    private static final UUID STUDENT_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");

    @Mock StudentRepository repository;

    StudentService service;

    @BeforeEach
    void setUp() {
        BusinessClock clock = () -> NOW;
        IdentityProperties properties =
                new IdentityProperties(
                        "Asia/Shanghai",
                        LocalTime.of(5, 0),
                        UUID.fromString("00000000-0000-0000-0000-000000000001"),
                        "TEST",
                        "Test Organization",
                        "0.1.0");
        service = new StudentService(repository, clock, properties, () -> STUDENT_ID);
    }

    @Test
    void createsStudentAndDefaultSevenDayPattern() {
        StudentCommands.Create command =
                new StudentCommands.Create(
                        "S001", "林同学", null, "CONFIRM", null, "强化班", null, null, null, null);
        StudentView created =
                new StudentView(
                        STUDENT_ID,
                        "S001",
                        "林同学",
                        null,
                        "ACTIVE",
                        "强化班",
                        null,
                        "CONFIRM",
                        null,
                        null,
                        java.util.List.of(),
                        java.util.List.of(),
                        0,
                        NOW);
        when(repository.insert(any(UUID.class), any(), any())).thenReturn(created);

        service.create(command);

        verify(repository).createDefaultWeeklyPattern(STUDENT_ID, LocalDate.of(2026, 8, 16), NOW);
    }

    @Test
    void rejectsMissingStudentNameBeforePersistence() {
        StudentCommands.Create command =
                new StudentCommands.Create(
                        "S001", " ", null, "CONFIRM", null, null, null, null, null, null);

        assertThatThrownBy(() -> service.create(command))
                .isInstanceOf(DomainException.class)
                .hasMessage("学生编号和姓名不能为空");
        verify(repository, never()).insert(any(), any(), any());
    }
}
