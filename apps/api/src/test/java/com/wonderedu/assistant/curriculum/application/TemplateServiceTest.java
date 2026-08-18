package com.wonderedu.assistant.curriculum.application;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wonderedu.assistant.curriculum.api.TemplateCommands;
import com.wonderedu.assistant.curriculum.persistence.TemplateRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TemplateServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-16T00:00:00Z");
    private static final UUID VERSION_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID TEMPLATE_ID = UUID.fromString("21000000-0000-0000-0000-000000000001");

    @Mock TemplateRepository repository;

    TemplateService service;

    @BeforeEach
    void setUp() {
        BusinessClock clock = () -> NOW;
        service = new TemplateService(repository, clock, () -> TEMPLATE_ID);
    }

    @Test
    void rejectsPublishedVersionMutation() {
        when(repository.findVersion(VERSION_ID))
                .thenReturn(
                        Optional.of(
                                new TemplateRepository.TemplateVersionState(
                                        VERSION_ID, TEMPLATE_ID, 1, "PUBLISHED", 30)));

        TemplateCommands.ReplaceItems command =
                new TemplateCommands.ReplaceItems(
                        List.of(new TemplateCommands.Item(1, "D1", "Day 1", null, 30, false, null, null, true)),
                        null);

        assertThatThrownBy(() -> service.replaceItems(VERSION_ID, command))
                .isInstanceOf(DomainException.class)
                .hasMessage("已发布模板版本不可修改");
        verify(repository, never()).replaceItems(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void rejectsNonContiguousDraftOrdinals() {
        when(repository.findVersion(VERSION_ID))
                .thenReturn(
                        Optional.of(
                                new TemplateRepository.TemplateVersionState(
                                        VERSION_ID, TEMPLATE_ID, 1, "DRAFT", 0)));
        TemplateCommands.ReplaceItems command =
                new TemplateCommands.ReplaceItems(
                        List.of(new TemplateCommands.Item(2, "D2", "Day 2", null, 30, false, null, null, true)),
                        null);

        assertThatThrownBy(() -> service.replaceItems(VERSION_ID, command))
                .isInstanceOf(DomainException.class)
                .hasMessage("模板单元序号必须从 1 连续排列且标题不能为空");
    }
}
