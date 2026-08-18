package com.wonderedu.assistant.search.application;

import com.wonderedu.assistant.search.api.SearchViews;
import com.wonderedu.assistant.search.api.SearchViews.SearchResultGroup;
import com.wonderedu.assistant.search.api.SearchViews.SearchResultItem;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.TenantContext;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Unified search across STUDENT / TEMPLATE / TEMPLATE_ITEM / TASK_INSTANCE documents.
 *
 * <p>Tenant isolation is always enforced via {@code organization_id}. Row-level visibility
 * for ASSISTANT actors is additionally constrained by {@code student.primary_assistant_id}
 * (the local-app surrogate for the {@code student_access} table described in §13.3 of the SDD),
 * so an assistant can only surface students and task instances they are responsible for.
 * LEAD_TEACHER / ADMIN / VIEWER see all in-organization rows.
 *
 * <p>The full {@code student_access} EXISTS predicate and the {@code search_document}
 * projection read-model are deferred to P3-SEC-002; see DevDataScope notes in CLAUDE.md.
 */
@Service
public class SearchService {

    private static final String ROLE_PREFIX = "ROLE_";

    private final NamedParameterJdbcTemplate jdbc;
    private final DateQueryParser dateParser;
    private final BusinessClock clock;
    private final String timezone;

    public SearchService(
            NamedParameterJdbcTemplate jdbc,
            DateQueryParser dateParser,
            BusinessClock clock,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this.jdbc = jdbc;
        this.dateParser = dateParser;
        this.clock = clock;
        this.timezone = properties.businessTimezone();
    }

    @Transactional(readOnly = true)
    public SearchViews.SearchResponse search(String query, List<String> types, int limit) {
        int safeLimit = Math.min(Math.max(limit, 1), 50);
        UUID orgId = TenantContext.requireOrganizationId();
        LocalDate businessDate = clock.businessDate(ZoneId.of(timezone));

        var parsedDate = dateParser.parse(query, businessDate, ZoneId.of(timezone));
        String dateHint = parsedDate.map(DateQueryParser.ParsedDate::hint).orElse(null);

        ActorContext.Actor actor = ActorContext.current();
        UUID actorId = actor == null ? null : actor.id();
        boolean assistantScoped = isAssistant();

        List<SearchResultGroup> groups = new ArrayList<>();
        String searchTerm = "%" + (query != null ? query.trim() : "") + "%";

        if (types == null || types.isEmpty() || types.contains("STUDENT")) {
            groups.add(searchStudents(orgId, searchTerm, safeLimit, actorId, assistantScoped));
        }
        if (types == null || types.isEmpty() || types.contains("TEMPLATE")) {
            groups.add(searchTemplates(orgId, searchTerm, safeLimit));
        }
        if (types == null || types.isEmpty() || types.contains("TEMPLATE_ITEM")) {
            groups.add(searchTemplateItems(orgId, searchTerm, safeLimit));
        }
        if (types == null || types.isEmpty() || types.contains("TASK_INSTANCE")) {
            groups.add(searchTasks(orgId, searchTerm, safeLimit, actorId, assistantScoped));
        }
        if (parsedDate.isPresent()) {
            groups.add(searchDate(orgId, parsedDate.get().date(), actorId, assistantScoped));
        }

        return new SearchViews.SearchResponse(query, groups, dateHint);
    }

    /**
     * ASSISTANT actors are row-level scoped to their own students; LEAD_TEACHER / ADMIN /
     * VIEWER (and any unauthenticated/system caller) are treated as not-assistant-scoped and
     * see all in-organization rows.
     */
    private boolean isAssistant() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null) {
            return false;
        }
        return auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(a -> a.startsWith(ROLE_PREFIX))
                .map(a -> a.substring(ROLE_PREFIX.length()))
                .anyMatch("ASSISTANT"::equals);
    }

    private SearchResultGroup searchStudents(
            UUID orgId, String term, int limit, UUID actorId, boolean assistantScoped) {
        StringBuilder sql =
                new StringBuilder()
                        .append("SELECT id, name, student_code, alias FROM student ")
                        .append("WHERE organization_id = :orgId AND status <> 'ARCHIVED' ")
                        .append("AND (name ILIKE :term OR alias ILIKE :term OR student_code ILIKE :term) ");
        MapSqlParameterSource params =
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("term", term)
                        .addValue("limit", limit);
        if (assistantScoped) {
            sql.append("AND primary_assistant_id = :actorId ");
            params.addValue("actorId", actorId);
        }
        sql.append("ORDER BY name LIMIT :limit");
        List<SearchResultItem> items =
                jdbc.query(
                        sql.toString(),
                        params,
                        (rs, rowNum) ->
                                new SearchResultItem(
                                        rs.getObject("id", UUID.class),
                                        "STUDENT",
                                        rs.getString("name"),
                                        rs.getString("student_code"),
                                        null,
                                        null));
        return new SearchResultGroup("STUDENT", items);
    }

    private SearchResultGroup searchTemplates(UUID orgId, String term, int limit) {
        List<SearchResultItem> items = jdbc.query(
                "SELECT id, name, template_code, subject_code FROM task_template "
                        + "WHERE organization_id = :orgId AND status <> 'ARCHIVED' "
                        + "AND (name ILIKE :term OR template_code ILIKE :term OR short_name ILIKE :term) "
                        + "ORDER BY name LIMIT :limit",
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("term", term)
                        .addValue("limit", limit),
                (rs, rowNum) -> new SearchResultItem(
                        rs.getObject("id", UUID.class),
                        "TEMPLATE",
                        rs.getString("name"),
                        rs.getString("template_code"),
                        null,
                        rs.getString("subject_code")));
        return new SearchResultGroup("TEMPLATE", items);
    }

    /**
     * TEMPLATE_ITEM group: searches task_template_item titles within the organization.
     * Organization scoping is reached by joining through task_template_version → task_template
     * since task_template_item itself has no organization_id column.
     */
    private SearchResultGroup searchTemplateItems(UUID orgId, String term, int limit) {
        List<SearchResultItem> items = jdbc.query(
                "SELECT tti.id, tti.title, tti.short_title, tti.item_code, tt.subject_code "
                        + "FROM task_template_item tti "
                        + "JOIN task_template_version ttv ON tti.template_version_id = ttv.id "
                        + "JOIN task_template tt ON ttv.template_id = tt.id "
                        + "WHERE tt.organization_id = :orgId "
                        + "AND tti.active = true "
                        + "AND (tti.title ILIKE :term OR tti.short_title ILIKE :term OR tti.item_code ILIKE :term) "
                        + "ORDER BY tti.title LIMIT :limit",
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("term", term)
                        .addValue("limit", limit),
                (rs, rowNum) -> new SearchResultItem(
                        rs.getObject("id", UUID.class),
                        "TEMPLATE_ITEM",
                        rs.getString("title"),
                        rs.getString("item_code"),
                        null,
                        rs.getString("subject_code")));
        return new SearchResultGroup("TEMPLATE_ITEM", items);
    }

    private SearchResultGroup searchTasks(
            UUID orgId, String term, int limit, UUID actorId, boolean assistantScoped) {
        StringBuilder sql =
                new StringBuilder()
                        .append("SELECT ti.id, ti.title_snapshot, ti.status ")
                        .append("FROM task_instance ti ");
        MapSqlParameterSource params =
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("term", term)
                        .addValue("limit", limit);
        if (assistantScoped) {
            sql.append("JOIN student s ON ti.student_id = s.id ");
        }
        sql.append("WHERE ti.organization_id = :orgId ")
                .append("AND (ti.title_snapshot ILIKE :term OR ti.override_reason ILIKE :term) ")
                .append("AND ti.status IN ('PENDING', 'COMPLETED', 'CARRIED_OVER') ");
        if (assistantScoped) {
            sql.append("AND s.primary_assistant_id = :actorId ");
            params.addValue("actorId", actorId);
        }
        sql.append("ORDER BY ti.scheduled_date DESC LIMIT :limit");
        List<SearchResultItem> items =
                jdbc.query(
                        sql.toString(),
                        params,
                        (rs, rowNum) ->
                                new SearchResultItem(
                                        rs.getObject("id", UUID.class),
                                        "TASK_INSTANCE",
                                        rs.getString("title_snapshot"),
                                        null,
                                        rs.getString("status"),
                                        null));
        return new SearchResultGroup("TASK_INSTANCE", items);
    }

    private SearchResultGroup searchDate(
            UUID orgId, LocalDate date, UUID actorId, boolean assistantScoped) {
        StringBuilder sql =
                new StringBuilder()
                        .append("SELECT ti.id, ti.title_snapshot, ti.status ")
                        .append("FROM task_instance ti ");
        MapSqlParameterSource params =
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("date", date);
        if (assistantScoped) {
            sql.append("JOIN student s ON ti.student_id = s.id ");
        }
        sql.append("WHERE ti.organization_id = :orgId AND ti.scheduled_date = :date ");
        if (assistantScoped) {
            sql.append("AND s.primary_assistant_id = :actorId ");
            params.addValue("actorId", actorId);
        }
        sql.append("ORDER BY ti.id LIMIT 20");
        List<SearchResultItem> items =
                jdbc.query(
                        sql.toString(),
                        params,
                        (rs, rowNum) ->
                                new SearchResultItem(
                                        rs.getObject("id", UUID.class),
                                        "TASK_INSTANCE",
                                        rs.getString("title_snapshot"),
                                        date.toString(),
                                        rs.getString("status"),
                                        null));
        return new SearchResultGroup("DATE", items);
    }
}
