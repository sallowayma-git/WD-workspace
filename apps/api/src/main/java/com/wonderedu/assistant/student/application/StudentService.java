package com.wonderedu.assistant.student.application;

import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.student.api.StudentCommands;
import com.wonderedu.assistant.student.api.StudentPage;
import com.wonderedu.assistant.student.api.StudentView;
import com.wonderedu.assistant.student.api.SubjectPreferenceView;
import com.wonderedu.assistant.student.persistence.StudentRepository;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StudentService {

    private final StudentRepository repository;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;
    private final String timezone;

    @org.springframework.beans.factory.annotation.Autowired
    public StudentService(
            StudentRepository repository,
            BusinessClock clock,
            IdentityProperties properties,
            IdGenerator idGenerator) {
        this(repository, clock, properties.businessTimezone(), idGenerator);
    }

    StudentService(
            StudentRepository repository,
            BusinessClock clock,
            String timezone,
            IdGenerator idGenerator) {
        this.repository = repository;
        this.clock = clock;
        this.timezone = timezone;
        this.idGenerator = idGenerator;
    }

    @Transactional(readOnly = true)
    public StudentPage list(String search, String status, int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), 100);
        List<StudentView> items = repository.findPage(search, status, safeSize, safePage * safeSize);
        long total = repository.count(search, status);
        return new StudentPage(items, safePage, safeSize, total, (safePage + 1L) * safeSize < total);
    }

    @Transactional(readOnly = true)
    public StudentView get(UUID id) {
        return repository
                .findById(id)
                .orElseThrow(() -> new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在"));
    }

    /**
     * FR-PROFILE-006 学科倾向列表。直接复用 {@link #get(UUID)} 返回的 profile 视图中的
     * {@code subjectPreferences} 字段,保持单一数据源。
     */
    @Transactional(readOnly = true)
    public List<SubjectPreferenceView> listSubjectPreferences(UUID id) {
        return get(id).subjectPreferences();
    }

    @Transactional
    public StudentView create(StudentCommands.Create command) {
        validateCreate(command);
        try {
            UUID id = idGenerator.next();
            StudentView student = repository.insert(id, command, clock.now());
            repository.createDefaultWeeklyPattern(
                    student.id(), clock.businessDate(ZoneId.of(timezone)), clock.now());
            return student;
        } catch (DataIntegrityViolationException exception) {
            throw new DomainException(409, "STUDENT_CODE_CONFLICT", "学生编号已存在");
        }
    }

    @Transactional
    public StudentView update(UUID id, StudentCommands.Update command) {
        validateUpdate(command);
        StudentView current = get(id);
        return repository
                .update(id, command, clock.now())
                .orElseThrow(
                        () ->
                                new DomainException(
                                        409,
                                        "STUDENT_VERSION_CONFLICT",
                                        "学生资料已被其他用户修改",
                                        List.of(),
                                        java.util.Map.of("id", id, "version", current.version())));
    }

    private void validateCreate(StudentCommands.Create command) {
        if (command == null || blank(command.studentCode()) || blank(command.name())) {
            throw new DomainException(422, "STUDENT_REQUIRED_FIELDS", "学生编号和姓名不能为空");
        }
        if (command.studentCode().length() > 50 || command.name().length() > 100) {
            throw new DomainException(422, "STUDENT_FIELD_TOO_LONG", "学生编号或姓名过长");
        }
        if (command.defaultDevicePolicy() != null
                && !List.of("ALLOWED", "NOT_ALLOWED", "CONFIRM").contains(command.defaultDevicePolicy())) {
            throw new DomainException(422, "STUDENT_DEVICE_POLICY_INVALID", "设备策略无效");
        }
        validateTags(command.tags());
        validateSubjectPreferences(command.subjectPreferences());
    }

    private void validateUpdate(StudentCommands.Update command) {
        if (command == null || blank(command.name())) {
            throw new DomainException(422, "STUDENT_REQUIRED_FIELDS", "姓名不能为空");
        }
        if (!List.of("ACTIVE", "PAUSED", "ARCHIVED").contains(command.status())) {
            throw new DomainException(422, "STUDENT_STATUS_INVALID", "学生状态无效");
        }
        if (!List.of("ALLOWED", "NOT_ALLOWED", "CONFIRM").contains(command.defaultDevicePolicy())) {
            throw new DomainException(422, "STUDENT_DEVICE_POLICY_INVALID", "设备策略无效");
        }
        if (command.expectedVersion() < 0) {
            throw new DomainException(422, "STUDENT_VERSION_REQUIRED", "必须提供有效版本号");
        }
        validateTags(command.tags());
        validateSubjectPreferences(command.subjectPreferences());
    }

    private void validateTags(List<StudentCommands.StudentTagInput> tags) {
        if (tags == null) {
            return;
        }
        java.util.HashSet<String> codes = new java.util.HashSet<>();
        for (StudentCommands.StudentTagInput tag : tags) {
            if (tag == null || blank(tag.code())) {
                throw new DomainException(422, "STUDENT_TAG_CODE_REQUIRED", "标签编码不能为空");
            }
            if (tag.code().length() > 50 || (tag.name() != null && tag.name().length() > 100)) {
                throw new DomainException(422, "STUDENT_TAG_TOO_LONG", "标签编码或名称过长");
            }
            if (!codes.add(tag.code())) {
                throw new DomainException(422, "STUDENT_TAG_DUPLICATE", "标签编码不能重复");
            }
        }
    }

    /** FR-PROFILE-006 学科倾向校验:subjectCode 非空、priority 1-5、targetRatio 0-100。 */
    private void validateSubjectPreferences(List<StudentCommands.SubjectPreferenceInput> preferences) {
        if (preferences == null) {
            return;
        }
        java.util.HashSet<String> codes = new java.util.HashSet<>();
        for (StudentCommands.SubjectPreferenceInput preference : preferences) {
            if (preference == null || blank(preference.subjectCode())) {
                throw new DomainException(422, "STUDENT_SUBJECT_CODE_REQUIRED", "学科编码不能为空");
            }
            if (preference.subjectCode().length() > 30) {
                throw new DomainException(422, "STUDENT_SUBJECT_CODE_TOO_LONG", "学科编码过长");
            }
            if (preference.priority() < 1 || preference.priority() > 5) {
                throw new DomainException(422, "STUDENT_SUBJECT_PRIORITY_INVALID", "学科优先级必须为1-5");
            }
            if (preference.targetRatio() != null) {
                java.math.BigDecimal ratio = preference.targetRatio();
                if (ratio.signum() < 0 || ratio.compareTo(java.math.BigDecimal.valueOf(100)) > 0) {
                    throw new DomainException(422, "STUDENT_SUBJECT_RATIO_INVALID", "目标比例必须为0-100");
                }
            }
            if (preference.note() != null && preference.note().length() > 500) {
                throw new DomainException(422, "STUDENT_SUBJECT_NOTE_TOO_LONG", "学科倾向备注过长");
            }
            if (!codes.add(preference.subjectCode())) {
                throw new DomainException(422, "STUDENT_SUBJECT_DUPLICATE", "学科编码不能重复");
            }
        }
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
