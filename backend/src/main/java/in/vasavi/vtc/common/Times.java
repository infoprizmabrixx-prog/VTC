package in.vasavi.vtc.common;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

public final class Times {

    public static final ZoneOffset IST_OFFSET = ZoneOffset.ofHoursMinutes(5, 30);
    public static final ZoneId IST_ZONE = ZoneId.of("Asia/Kolkata");
    private static volatile Clock clock = Clock.systemUTC();

    private Times() {
    }

    public static void setClock(Clock c) {
        clock = c != null ? c : Clock.systemUTC();
    }

    public static Instant now() {
        return Instant.now(clock);
    }

    public static String stamp() {
        return stamp(now());
    }

    public static String stamp(Instant t) {
        return t.truncatedTo(ChronoUnit.SECONDS).toString();
    }

    public static String later(long minutes) {
        return stamp(now().plus(Duration.ofMinutes(minutes)));
    }

    public static Instant parse(String iso) {
        if (iso == null || iso.isBlank()) {
            return null;
        }
        String s = iso.trim();
        if (s.endsWith("Z")) {
            return Instant.parse(s);
        }
        if (s.contains("T")) {
            return OffsetDateTime.parse(s).toInstant();
        }
        // SQLite/MySQL "YYYY-MM-DD HH:MM:SS[.ffffff]"
        String norm = s.replace(' ', 'T') + "Z";
        return Instant.parse(norm);
    }

    public static LocalDate todayIst() {
        return ZonedDateTime.now(clock.withZone(IST_OFFSET)).toLocalDate();
    }

    public static String isoDayIst() {
        return todayIst().toString();
    }

    public static String compactDayIst() {
        return todayIst().format(DateTimeFormatter.ofPattern("yyMMdd"));
    }

    /**
     * Converts an IST calendar day (YYYY-MM-DD) into [startUtcIso, endUtcIso) bounds.
     */
    public static String[] istDayBounds(String dayStr) {
        LocalDate d;
        if (dayStr == null || dayStr.isBlank()) {
            d = todayIst();
        } else {
            try {
                d = LocalDate.parse(dayStr.trim());
            } catch (Exception e) {
                throw new ApiException("INVALID_DATE", 400);
            }
        }
        Instant start = d.atStartOfDay(IST_OFFSET).toInstant();
        Instant end = start.plus(Duration.ofDays(1));
        return new String[]{stamp(start), stamp(end), d.toString()};
    }
}
