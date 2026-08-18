package com.wonderedu.assistant.shared;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class SystemBusinessClock implements BusinessClock {

    private final Clock clock;
    private final LocalTime dayCloseTime;

    /**
     * Primary Spring constructor: injects the configured {@code assistant.day-close-time}
     * (default 05:00:00) and uses {@link Clock#systemUTC()} for the wall clock.
     */
    @Autowired
    public SystemBusinessClock(@Value("${assistant.day-close-time:05:00:00}") LocalTime dayCloseTime) {
        this(Clock.systemUTC(), dayCloseTime);
    }

    /** Test constructor with an explicit clock and midnight boundary. */
    SystemBusinessClock(Clock clock) {
        this(clock, LocalTime.MIDNIGHT);
    }

    /** Test constructor with an explicit clock and day-close boundary. */
    SystemBusinessClock(Clock clock, LocalTime dayCloseTime) {
        this.clock = clock;
        this.dayCloseTime = dayCloseTime;
    }

    @Override
    public Instant now() {
        return clock.instant();
    }

    @Override
    public LocalDate businessDate(ZoneId zoneId) {
        return businessDate(zoneId, dayCloseTime);
    }
}
