package com.wonderedu.assistant.curriculum.application;

import com.wonderedu.assistant.curriculum.api.TemplateCommands;
import com.wonderedu.assistant.curriculum.api.TemplateDetailView;
import com.wonderedu.assistant.curriculum.api.TemplateItemUsageView;
import com.wonderedu.assistant.curriculum.api.TemplateItemView;
import com.wonderedu.assistant.curriculum.api.TemplatePage;
import com.wonderedu.assistant.curriculum.api.TemplateUsageView;
import com.wonderedu.assistant.curriculum.api.TemplateView;
import com.wonderedu.assistant.curriculum.api.TemplateVersionView;
import com.wonderedu.assistant.curriculum.persistence.TemplateRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.CodeNormalizer;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TemplateService {

    private final TemplateRepository repository;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;

    public TemplateService(
            TemplateRepository repository, BusinessClock clock, IdGenerator idGenerator) {
        this.repository = repository;
        this.clock = clock;
        this.idGenerator = idGenerator;
    }

    @Transactional(readOnly = true)
    public TemplatePage list(String search, String status, int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), 100);
        List<TemplateView> items = repository.findPage(search, status, safeSize, safePage * safeSize);
        long total = repository.count(search, status);
        return new TemplatePage(items, safePage, safeSize, total, (safePage + 1L) * safeSize < total);
    }

    @Transactional(readOnly = true)
    public TemplateDetailView findDetail(UUID id) {
        return repository
                .findDetailById(id)
                .orElseThrow(() -> new DomainException(404, "TEMPLATE_NOT_FOUND", "模板不存在"));
    }

    @Transactional(readOnly = true)
    public List<TemplateItemView> findItems(UUID versionId) {
        return repository.findItemsByVersion(versionId);
    }

    @Transactional(readOnly = true)
    public List<TemplateUsageView> getTemplateUsage(UUID templateId) {
        return repository.findTemplateUsage(templateId);
    }

    @Transactional(readOnly = true)
    public List<TemplateItemUsageView> getTemplateItemUsage(UUID itemId) {
        return repository.findTemplateItemUsage(itemId);
    }

    @Transactional
    public TemplateView createDraft(UUID templateId) {
        TemplateView template = repository
                .findById(templateId)
                .orElseThrow(() -> new DomainException(404, "TEMPLATE_NOT_FOUND", "模板不存在"));
        if (template.currentPublishedVersionId() == null) {
            throw new DomainException(422, "TEMPLATE_NO_PUBLISHED_VERSION", "模板尚无已发布版本，无法创建新草稿");
        }
        if (repository.findVersionsByTemplate(templateId).stream()
                .anyMatch(version -> "DRAFT".equals(version.status()))) {
            throw new DomainException(409, "TEMPLATE_DRAFT_EXISTS", "模板已存在草稿版本");
        }
        repository.createDraftFromPublished(templateId, template.currentPublishedVersionId(), clock.now());
        return repository
                .findById(templateId)
                .orElseThrow(() -> new DomainException(404, "TEMPLATE_NOT_FOUND", "模板不存在"));
    }

    @Transactional
    public TemplateView create(TemplateCommands.Create command) {
        validateCreate(command);
        TemplateCommands.Create normalized = new TemplateCommands.Create(
                CodeNormalizer.normalize(command.templateCode()),
                command.name(),
                command.shortName(),
                command.subjectCode(),
                command.categoryCode(),
                command.unitLabel(),
                command.defaultDurationMinutes(),
                command.defaultRequiresDevice(),
                command.description());
        try {
            return repository.insert(idGenerator.next(), idGenerator.next(), normalized, clock.now());
        } catch (DataIntegrityViolationException exception) {
            throw new DomainException(409, "TEMPLATE_CODE_CONFLICT", "模板编码已存在");
        }
    }

    @Transactional
    public void replaceItems(UUID versionId, TemplateCommands.ReplaceItems command) {
        TemplateRepository.TemplateVersionState version = requireDraft(versionId);
        validateItems(command.items());
        repository.replaceItems(versionId, command, checksum(command.items()), clock.now());
    }

    @Transactional
    public TemplateView publish(UUID versionId) {
        // Acquire row-level locks on the template + version rows so concurrent
        // publish calls on the same draft serialize at the DB layer (BR-012).
        repository.lockForPublish(versionId);
        TemplateRepository.TemplateVersionState version = requireDraft(versionId);
        if (version.itemCount() == 0) {
            throw new DomainException(422, "TEMPLATE_EMPTY_VERSION", "模板至少需要一个有效单元");
        }
        // SDD §9.2 step 2: the version must have at least one active item; the
        // denormalized item_count alone does not guarantee an active row exists.
        int activeItems = repository.countActiveItems(versionId);
        if (activeItems == 0) {
            throw new DomainException(422, "TEMPLATE_NO_ACTIVE_ITEM", "模板至少需要一个启用的单元");
        }
        validatePublishedItemOrdinals(versionId);
        repository.publish(versionId, clock.now());
        return repository
                .findById(version.templateId())
                .orElseThrow(() -> new DomainException(404, "TEMPLATE_NOT_FOUND", "模板不存在"));
    }

    /**
     * Re-validates that persisted items have contiguous ordinals starting at 1
     * before publication. The replace-items path already enforces this, but the
     * version may have transitioned through drafts or imports; a final DB-level
     * check guards against any drift before the PUBLISHED transition.
     */
    private void validatePublishedItemOrdinals(UUID versionId) {
        List<TemplateItemView> items = repository.findItemsByVersion(versionId);
        for (int index = 0; index < items.size(); index++) {
            TemplateItemView item = items.get(index);
            if (item.ordinal() != index + 1) {
                throw new DomainException(422, "TEMPLATE_ITEMS_NOT_CONTIGUOUS", "模板单元序号必须从 1 连续排列");
            }
            if (item.title() == null || item.title().isBlank()) {
                throw new DomainException(422, "TEMPLATE_ITEMS_NOT_CONTIGUOUS", "模板单元标题不能为空");
            }
        }
    }

    private TemplateRepository.TemplateVersionState requireDraft(UUID versionId) {
        TemplateRepository.TemplateVersionState version =
                repository
                        .findVersion(versionId)
                        .orElseThrow(() -> new DomainException(404, "TEMPLATE_VERSION_NOT_FOUND", "模板版本不存在"));
        if (!"DRAFT".equals(version.status())) {
            throw new DomainException(409, "TEMPLATE_VERSION_IMMUTABLE", "已发布模板版本不可修改");
        }
        return version;
    }

    private void validateCreate(TemplateCommands.Create command) {
        if (command == null || blank(command.templateCode()) || blank(command.name()) || blank(command.subjectCode())) {
            throw new DomainException(422, "TEMPLATE_REQUIRED_FIELDS", "模板编码、名称和学科不能为空");
        }
        if (command.defaultDurationMinutes() != null && (command.defaultDurationMinutes() < 1 || command.defaultDurationMinutes() > 1440)) {
            throw new DomainException(422, "TEMPLATE_DURATION_INVALID", "默认时长必须在 1 到 1440 分钟之间");
        }
    }

    private void validateItems(List<TemplateCommands.Item> items) {
        if (items == null || items.isEmpty()) {
            throw new DomainException(422, "TEMPLATE_ITEMS_REQUIRED", "模板至少需要一个单元");
        }
        HashSet<String> codes = new HashSet<>();
        for (int index = 0; index < items.size(); index++) {
            TemplateCommands.Item item = items.get(index);
            if (item.ordinal() != index + 1 || blank(item.title())) {
                throw new DomainException(422, "TEMPLATE_ITEMS_NOT_CONTIGUOUS", "模板单元序号必须从 1 连续排列且标题不能为空");
            }
            if (item.itemCode() != null && !item.itemCode().isBlank() && !codes.add(item.itemCode())) {
                throw new DomainException(422, "TEMPLATE_ITEM_CODE_DUPLICATE", "模板单元编码不能重复");
            }
            if (item.durationMinutes() != null && (item.durationMinutes() < 1 || item.durationMinutes() > 1440)) {
                throw new DomainException(422, "TEMPLATE_ITEM_DURATION_INVALID", "单元时长必须在 1 到 1440 分钟之间");
            }
        }
    }

    private String checksum(List<TemplateCommands.Item> items) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String normalized =
                    items.stream()
                            .map(item -> item.ordinal() + "|" + item.itemCode() + "|" + item.title() + "|" + item.shortTitle() + "|" + item.durationMinutes() + "|" + item.requiresDevice() + "|" + item.active())
                            .reduce((left, right) -> left + "\n" + right)
                            .orElse("");
            return java.util.HexFormat.of().formatHex(digest.digest(normalized.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required", exception);
        }
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
