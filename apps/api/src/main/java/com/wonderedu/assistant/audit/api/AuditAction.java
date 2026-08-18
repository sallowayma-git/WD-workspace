package com.wonderedu.assistant.audit.api;

/**
 * Canonical audit action codes persisted to {@code audit_event.action}.
 *
 * <p>The string values are stored verbatim, so renaming a constant is safe but renaming
 * its {@link #toString()} payload would require a data migration. New actions can be added
 * freely; unknown values read back from the database are returned as plain strings rather
 * than failing the query.
 */
public enum AuditAction {

    TASK_COMPLETED,
    TASK_REOPENED,
    TASK_CARRIED_OVER,
    TASK_CARRYOVER_UNDONE,
    TASK_RESCHEDULED,
    TASK_CANCELLED,
    TASK_LOCKED,
    TASK_UNLOCKED,
    TASK_UPDATED,
    TASK_DUPLICATED,
    TASK_SUBTASK_CREATED,
    TASK_LINKED,
    TASK_DELETED,
    TASK_REORDERED,
    TRACK_MOUNTED,
    EXPORT_GENERATED,
    /** Generic fallback for ad-hoc events that do not fit a dedicated code. */
    CUSTOM
}
