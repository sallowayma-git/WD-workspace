package com.wonderedu.assistant.shared;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

class SystemBusinessClockTest {

    private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");

    @Test
    void rollsBackToPreviousDayBeforeDayClose() {
        // 2026-08-15T16:30:00Z == 2026-08-16 00:30 Asia/Shanghai
        Clock fixed = Clock.fixed(Instant.parse("2026-08-15T16:30:00Z"), Clock.systemUTC().getZone());
        SystemBusinessClock clock = new SystemBusinessClock(fixed, LocalTime.of(5, 0));
        assertThat(clock.businessDate(SHANGHAI)).isEqualTo(java.time.LocalDate.of(2026, 8, 15));
    }

    @Test
    void keepsSameDayAtOrAfterDayClose() {
        // 2026-08-15T21:00:00Z == 2026-08-16 05:00 Asia/Shanghai (exactly at boundary)
        Clock fixed = Clock.fixed(Instant.parse("2026-08-15T21:00:00Z"), Clock.systemUTC().getZone());
        SystemBusinessClock clock = new SystemBusinessClock(fixed, LocalTime.of(5, 0));
        assertThat(clock.businessDate(SHANGHAI)).isEqualTo(java.time.LocalDate.of(2026, 8, 16));
    }

    @Test
    void midnightBoundaryKeepsLegacyBehaviour() {
        // With MIDNIGHT boundary, business date == calendar date (no rollback)
        Clock fixed = Clock.fixed(Instant.parse("2026-08-15T16:30:00Z"), Clock.systemUTC().getZone());
        SystemBusinessClock clock = new SystemBusinessClock(fixed, LocalTime.MIDNIGHT);
        assertThat(clock.businessDate(SHANGHAI)).isEqualTo(java.time.LocalDate.of(2026, 8, 16));
    }
}
