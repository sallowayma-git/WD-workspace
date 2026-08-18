package com.wonderedu.assistant.student.web;

import com.wonderedu.assistant.student.api.ScheduleImpactView;
import com.wonderedu.assistant.student.api.StudentCommands;
import com.wonderedu.assistant.student.api.StudentPage;
import com.wonderedu.assistant.student.api.StudentView;
import com.wonderedu.assistant.student.api.SubjectPreferenceView;
import com.wonderedu.assistant.student.api.WeekPlanCommands;
import com.wonderedu.assistant.student.api.WeekPlanView;
import com.wonderedu.assistant.student.api.WeeklyPatternView;
import com.wonderedu.assistant.student.application.ScheduleImpactAnalyzer;
import com.wonderedu.assistant.student.application.StudentService;
import com.wonderedu.assistant.student.application.WeekPlanService;
import java.net.URI;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/students")
public class StudentController {

    private final StudentService service;
    private final WeekPlanService weekPlanService;
    private final ScheduleImpactAnalyzer scheduleImpactAnalyzer;

    public StudentController(
            StudentService service,
            WeekPlanService weekPlanService,
            ScheduleImpactAnalyzer scheduleImpactAnalyzer) {
        this.service = service;
        this.weekPlanService = weekPlanService;
        this.scheduleImpactAnalyzer = scheduleImpactAnalyzer;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public StudentPage list(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return service.list(query, status, page, size);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public StudentView get(@PathVariable UUID id) {
        return service.get(id);
    }

    @GetMapping("/{id}/subject-preferences")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public List<SubjectPreferenceView> listSubjectPreferences(@PathVariable UUID id) {
        return service.listSubjectPreferences(id);
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ResponseEntity<StudentView> create(@RequestBody StudentCommands.Create command) {
        StudentView created = service.create(command);
        return ResponseEntity.created(URI.create("/api/v1/students/" + created.id())).body(created);
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public StudentView update(@PathVariable UUID id, @RequestBody StudentCommands.Update command) {
        return service.update(id, command);
    }

    @GetMapping("/{id}/weekly-pattern")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public WeeklyPatternView getWeeklyPattern(@PathVariable UUID id) {
        return weekPlanService.getWeeklyPattern(id);
    }

    @PutMapping("/{id}/weekly-pattern")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public WeeklyPatternView saveWeeklyPattern(
            @PathVariable UUID id, @RequestBody WeekPlanCommands.SaveWeeklyPattern command) {
        return weekPlanService.saveWeeklyPattern(id, command);
    }

    @GetMapping("/{id}/week-plans/{weekStart}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public WeekPlanView getWeekPlan(
            @PathVariable UUID id,
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate weekStart) {
        return weekPlanService.getWeekPlan(id, weekStart);
    }

    @PutMapping("/{id}/week-plans/{weekStart}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ResponseEntity<WeekPlanView> saveWeekPlan(
            @PathVariable UUID id,
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate weekStart,
            @RequestBody WeekPlanCommands.SaveWeekPlan command) {
        WeekPlanView saved = weekPlanService.saveWeekPlan(id, weekStart, command);
        return ResponseEntity.ok()
                .location(
                        URI.create(
                                "/api/v1/students/" + id + "/week-plans/" + weekStart))
                .body(saved);
    }

    @GetMapping("/{id}/schedule-impact")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public ScheduleImpactView scheduleImpact(
            @PathVariable UUID id,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return scheduleImpactAnalyzer.analyzeImpact(id, from, to);
    }
}
