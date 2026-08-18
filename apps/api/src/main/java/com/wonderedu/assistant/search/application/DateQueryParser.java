package com.wonderedu.assistant.search.application;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class DateQueryParser {

    private static final Pattern ISO_DATE = Pattern.compile("(\\d{4})-(\\d{1,2})-(\\d{1,2})");
    private static final Pattern SLASH_DATE = Pattern.compile("(\\d{4})/(\\d{1,2})/(\\d{1,2})");
    private static final Pattern CN_DATE = Pattern.compile("(\\d{1,2})月(\\d{1,2})日");
    private static final Pattern SHORT_DATE = Pattern.compile("(\\d{1,2})/(\\d{1,2})");

    public record ParsedDate(LocalDate date, String hint) {}

    public Optional<ParsedDate> parse(String query, LocalDate businessDate, ZoneId timezone) {
        if (query == null || query.isBlank()) return Optional.empty();
        String trimmed = query.trim();

        if (trimmed.contains("今天") || trimmed.contains("今日")) {
            return Optional.of(new ParsedDate(businessDate, "今天 → " + businessDate));
        }
        if (trimmed.contains("明天") || trimmed.contains("明日")) {
            return Optional.of(new ParsedDate(businessDate.plusDays(1), "明天 → " + businessDate.plusDays(1)));
        }
        if (trimmed.contains("昨天")) {
            return Optional.of(new ParsedDate(businessDate.minusDays(1), "昨天 → " + businessDate.minusDays(1)));
        }
        if (trimmed.contains("下周一")) {
            LocalDate next = businessDate;
            while (next.getDayOfWeek().getValue() != 1) next = next.plusDays(1);
            if (!next.isAfter(businessDate)) next = next.plusWeeks(1);
            return Optional.of(new ParsedDate(next, "下周一 → " + next));
        }

        Matcher m = ISO_DATE.matcher(trimmed);
        if (m.find()) {
            LocalDate d = LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            return Optional.of(new ParsedDate(d, trimmed + " → " + d));
        }

        m = SLASH_DATE.matcher(trimmed);
        if (m.find()) {
            LocalDate d = LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            return Optional.of(new ParsedDate(d, trimmed + " → " + d));
        }

        m = CN_DATE.matcher(trimmed);
        if (m.find()) {
            int month = Integer.parseInt(m.group(1));
            int day = Integer.parseInt(m.group(2));
            int year = businessDate.getYear();
            LocalDate d = LocalDate.of(year, month, day);
            if (d.isBefore(businessDate.minusMonths(6))) d = d.plusYears(1);
            return Optional.of(new ParsedDate(d, trimmed + " → " + d));
        }

        m = SHORT_DATE.matcher(trimmed);
        if (m.find()) {
            int month = Integer.parseInt(m.group(1));
            int day = Integer.parseInt(m.group(2));
            int year = businessDate.getYear();
            LocalDate d = LocalDate.of(year, month, day);
            if (d.isBefore(businessDate.minusMonths(6))) d = d.plusYears(1);
            return Optional.of(new ParsedDate(d, trimmed + " → " + d));
        }

        return Optional.empty();
    }
}
