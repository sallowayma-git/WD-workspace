package com.wonderedu.assistant.planning.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.wonderedu.assistant.planning.api.TrackView;
import com.wonderedu.assistant.planning.persistence.CurriculumLookup;
import com.wonderedu.assistant.planning.persistence.TrackRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.IdGenerator;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TrackServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-16T00:00:00Z");
    private static final UUID TRACK_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final UUID STUDENT_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID TEMPLATE_ID = UUID.fromString("21000000-0000-0000-0000-000000000001");
    private static final UUID VERSION_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");

    @Mock TrackRepository repository;
    @Mock CurriculumLookup curriculumLookup;
    @Mock SchedulingService schedulingService;

    TrackService service;

    @BeforeEach
    void setUp() {
        BusinessClock clock = () -> NOW;
        service =
                new TrackService(
                        repository,
                        curriculumLookup,
                        schedulingService,
                        clock,
                        () -> UUID.randomUUID(),
                        "Asia/Shanghai");
    }

    private TrackView track(int startOrdinal, int currentOrdinal, int endOrdinal) {
        return TrackView.from(
                TRACK_ID,
                STUDENT_ID,
                TEMPLATE_ID,
                VERSION_ID,
                "ACTIVE",
                startOrdinal,
                currentOrdinal,
                endOrdinal,
                1,
                LocalDate.of(2026, 8, 16),
                LocalDate.of(2026, 8, 16),
                50,
                false,
                "MANUAL",
                null,
                null,
                null,
                null,
                1L,
                NOW);
    }

    @Test
    void pointerAdvancesByOneForSingleCompleted() {
        when(repository.findById(TRACK_ID)).thenReturn(Optional.of(track(1, 1, 10)));
        when(repository.findCompletedOrdinals(TRACK_ID)).thenReturn(Set.of(1));
        assertThat(service.calculateTrackPointer(TRACK_ID)).isEqualTo(2);
    }

    @Test
    void pointerAdvancesThroughContiguousCompleted() {
        when(repository.findById(TRACK_ID)).thenReturn(Optional.of(track(1, 1, 10)));
        when(repository.findCompletedOrdinals(TRACK_ID)).thenReturn(Set.of(1, 2, 3));
        assertThat(service.calculateTrackPointer(TRACK_ID)).isEqualTo(4);
    }

    @Test
    void pointerStopsAtFirstUncompletedEvenWhenLaterCompleted() {
        when(repository.findById(TRACK_ID)).thenReturn(Optional.of(track(1, 1, 10)));
        when(repository.findCompletedOrdinals(TRACK_ID)).thenReturn(Set.of(1, 3, 4));
        // ordinal 2 uncompleted blocks advancement past it
        assertThat(service.calculateTrackPointer(TRACK_ID)).isEqualTo(2);
    }

    @Test
    void pointerHandlesOutOfOrderCompletionSet() {
        when(repository.findById(TRACK_ID)).thenReturn(Optional.of(track(1, 1, 10)));
        // Set does not guarantee order; algorithm must scan contiguously
        Set<Integer> completed = new TreeSet<>();
        completed.add(3);
        completed.add(1);
        completed.add(2);
        when(repository.findCompletedOrdinals(TRACK_ID)).thenReturn(completed);
        assertThat(service.calculateTrackPointer(TRACK_ID)).isEqualTo(4);
    }

    @Test
    void pointerDoesNotAdvanceWhenCurrentUncompleted() {
        when(repository.findById(TRACK_ID)).thenReturn(Optional.of(track(1, 5, 10)));
        when(repository.findCompletedOrdinals(TRACK_ID)).thenReturn(Set.of(1, 2, 3, 4, 6));
        // current is 5, not completed -> stays
        assertThat(service.calculateTrackPointer(TRACK_ID)).isEqualTo(5);
    }

    @Test
    void pointerExceedsEndWhenAllCompleted() {
        when(repository.findById(TRACK_ID)).thenReturn(Optional.of(track(1, 1, 3)));
        when(repository.findCompletedOrdinals(TRACK_ID)).thenReturn(Set.of(1, 2, 3));
        assertThat(service.calculateTrackPointer(TRACK_ID)).isEqualTo(4);
    }

    @Test
    void pointerHandlesReopenByExcludingReopenedOrdinal() {
        when(repository.findById(TRACK_ID)).thenReturn(Optional.of(track(1, 1, 5)));
        // ordinal 2 was reopened (not in completed set), so pointer stops at 2
        when(repository.findCompletedOrdinals(TRACK_ID)).thenReturn(Set.of(1, 3));
        assertThat(service.calculateTrackPointer(TRACK_ID)).isEqualTo(2);
    }
}
