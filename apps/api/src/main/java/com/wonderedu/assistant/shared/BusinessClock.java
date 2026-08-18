package com.wonderedu.assistant.shared;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

public interface BusinessClock {

    Instant now();

    /**
     * Business date in the given timezone, applying the configured day-close boundary.
     *
     * <p>Per PRD FR-EXEC-005/BR-014, when the wall-clock time has not yet crossed
     * {@code day_close_time}, the business day still belongs to the previous calendar
     * day. For example, with {@code day_close_time=05:00} and execution at 00:30, the
     * business date is yesterday.
     *
     * <p>This default overload assumes a midnight boundary (i.e. no day-close offset)
     * so that simple test doubles returning a fixed {@link Instant} keep their legacy
     * behaviour. Production code should rely on {@link SystemBusinessClock}, which
     * injects the configured {@code day_close_time}.
     */
    default LocalDate businessDate(ZoneId zoneId) {
        return businessDate(zoneId, LocalTime.MIDNIGHT);
    }

    /**
     * Business date in the given timezone for the supplied day-close boundary.
     *
     * <p>If the current wall-clock time in {@code zoneId} is before {@code dayCloseTime},
     * the business date is the previous calendar day; otherwise it is the current
     * calendar day.
     */
    default LocalDate businessDate(ZoneId zoneId, LocalTime dayCloseTime) {
        var zoned = now().atZone(zoneId);
        LocalDate calendarDate = zoned.toLocalDate();
        if (dayCloseTime != null && zoned.toLocalTime().isBefore(dayCloseTime)) {
            return calendarDate.minusDays(1);
        }
        return calendarDate;
    }
}
