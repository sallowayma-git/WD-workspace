package com.wonderedu.assistant.curriculum.web;

import com.wonderedu.assistant.curriculum.api.TemplateCommands;
import com.wonderedu.assistant.curriculum.api.TemplateDetailView;
import com.wonderedu.assistant.curriculum.api.TemplateItemUsageView;
import com.wonderedu.assistant.curriculum.api.TemplateItemView;
import com.wonderedu.assistant.curriculum.api.TemplatePage;
import com.wonderedu.assistant.curriculum.api.TemplateUsageView;
import com.wonderedu.assistant.curriculum.api.TemplateView;
import com.wonderedu.assistant.curriculum.application.TemplateService;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class TemplateController {

    private final TemplateService service;

    public TemplateController(TemplateService service) {
        this.service = service;
    }

    @GetMapping("/templates")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public TemplatePage list(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return service.list(query, status, page, size);
    }

    @GetMapping("/templates/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public TemplateDetailView get(@PathVariable UUID id) {
        return service.findDetail(id);
    }

    @GetMapping("/template-versions/{versionId}/items")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public List<TemplateItemView> listItems(@PathVariable UUID versionId) {
        return service.findItems(versionId);
    }

    @GetMapping("/templates/{id}/usage")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public List<TemplateUsageView> templateUsage(@PathVariable UUID id) {
        return service.getTemplateUsage(id);
    }

    @GetMapping("/template-items/{id}/usage")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public List<TemplateItemUsageView> templateItemUsage(@PathVariable UUID id) {
        return service.getTemplateItemUsage(id);
    }

    @PostMapping("/templates")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public TemplateView create(@RequestBody TemplateCommands.Create command) {
        return service.create(command);
    }

    @PostMapping("/templates/{id}/drafts")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER')")
    public TemplateView createDraft(@PathVariable UUID id) {
        return service.createDraft(id);
    }

    @PutMapping("/template-versions/{versionId}/items")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public void replaceItems(
            @PathVariable UUID versionId, @RequestBody TemplateCommands.ReplaceItems command) {
        service.replaceItems(versionId, command);
    }

    @PostMapping("/template-versions/{versionId}/publish")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER')")
    public TemplateView publish(@PathVariable UUID versionId) {
        return service.publish(versionId);
    }
}
