package in.vasavi.vtc.area.production;

import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class RoastLogController {

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;

    public RoastLogController(Db db, SessionService sessionService, PermissionService permissionService) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
    }

    private YearMonth parseMonth(String v) {
        if (v == null || v.isBlank()) {
            return YearMonth.now(Times.IST_ZONE);
        }
        try {
            String[] parts = v.trim().split("-");
            int y = Integer.parseInt(parts[0]);
            int m = Integer.parseInt(parts[1]);
            if (y < 2020 || y > 2100 || m < 1 || m > 12) {
                throw new ApiException("INVALID_DATE");
            }
            return YearMonth.of(y, m);
        } catch (Exception e) {
            throw new ApiException("INVALID_DATE");
        }
    }

    private String[] monthBounds(YearMonth ym) {
        LocalDate start = ym.atDay(1);
        LocalDate end = ym.plusMonths(1).atDay(1);
        String lo = start.atStartOfDay(Times.IST_ZONE).toInstant().toString();
        String hi = end.atStartOfDay(Times.IST_ZONE).toInstant().toString();
        return new String[]{lo, hi};
    }

    @GetMapping("/roasts/month-record")
    public Map<String, Object> monthRecord(@RequestParam(required = false) String month, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "roast.view", "roast.execute");

        YearMonth ym = parseMonth(month);
        String key = ym.toString();
        String[] bounds = monthBounds(ym);

        Map<String, Object> r = db.one(
                "SELECT COUNT(*) n, COALESCE(SUM(input_kg),0) kin, COALESCE(SUM(output_kg),0) kout, " +
                "COALESCE(SUM(CASE WHEN qc_status='REJECTED' THEN 1 ELSE 0 END),0) rejected " +
                "FROM roast_batches WHERE created_at>=? AND created_at<?", bounds[0], bounds[1]
        );

        Map<String, Object> meter = db.one("SELECT * FROM roast_meter WHERE month=?", key);
        if (meter == null) {
            meter = Map.of();
        }

        List<Map<String, Object>> cyl = db.rows(
                "SELECT g.*, u.full_name by_name FROM gas_cylinders g JOIN users u ON u.id=g.created_by " +
                "WHERE fitted_on LIKE ? ORDER BY fitted_on, id", key + "%"
        );

        double gas = 0.0;
        for (Map<String, Object> c : cyl) {
            gas += ((Number) c.get("kg")).doubleValue();
        }
        gas = Math.round(gas * 100.0) / 100.0;

        Integer startR = meter.get("start_reading") != null ? ((Number) meter.get("start_reading")).intValue() : null;
        Integer endR = meter.get("end_reading") != null ? ((Number) meter.get("end_reading")).intValue() : null;
        Integer meterCount = (startR != null && endR != null) ? (endR - startR) : null;

        long roasts = r.get("n") != null ? ((Number) r.get("n")).longValue() : 0L;
        double kin = r.get("kin") != null ? ((Number) r.get("kin")).doubleValue() : 0.0;
        double kout = r.get("kout") != null ? ((Number) r.get("kout")).doubleValue() : 0.0;
        long rejected = r.get("rejected") != null ? ((Number) r.get("rejected")).longValue() : 0L;

        Double perRoast = (gas > 0 && roasts > 0) ? Math.round((gas / roasts) * 100.0) / 100.0 : null;
        Double lossPct = kin > 0 ? Math.round(((kin - kout) / kin * 100.0) * 100.0) / 100.0 : null;
        Double gasPer100 = (gas > 0 && kin > 0) ? Math.round((gas / kin * 100.0) * 100.0) / 100.0 : null;

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("month", key);
        res.put("batches", roasts);
        res.put("input_kg", Math.round(kin * 1000.0) / 1000.0);
        res.put("output_kg", Math.round(kout * 1000.0) / 1000.0);
        res.put("loss_pct", lossPct);
        res.put("rejected", rejected);
        res.put("start_reading", startR);
        res.put("end_reading", endR);
        res.put("meter_count", meterCount);
        res.put("meter_gap", meterCount != null ? (meterCount - roasts) : null);
        res.put("cylinders", cyl);
        res.put("gas_kg", gas);
        res.put("gas_kg_per_roast", perRoast);
        res.put("gas_kg_per_100kg", gasPer100);

        return res;
    }

    @PutMapping("/roasts/meter")
    public Map<String, Object> setMeter(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "roast.execute");
        Map<String, Object> body = d != null ? d : Map.of();

        YearMonth ym = parseMonth((String) body.get("month"));
        String key = ym.toString();

        Integer startReading = null;
        Integer endReading = null;
        boolean hasAny = false;

        if (body.get("start_reading") != null && !body.get("start_reading").toString().isBlank()) {
            double v = ValidationUtils.number(body, "start_reading", true);
            if (v != (int) v) throw new ApiException("READING_MUST_BE_WHOLE");
            startReading = (int) v;
            hasAny = true;
        }
        if (body.get("end_reading") != null && !body.get("end_reading").toString().isBlank()) {
            double v = ValidationUtils.number(body, "end_reading", true);
            if (v != (int) v) throw new ApiException("READING_MUST_BE_WHOLE");
            endReading = (int) v;
            hasAny = true;
        }

        if (!hasAny) {
            throw new ApiException("NOTHING_TO_CHANGE");
        }

        final Integer finalStart = startReading;
        final Integer finalEnd = endReading;

        return db.tx(() -> {
            Map<String, Object> old = db.one("SELECT * FROM roast_meter WHERE month=?", key);
            Integer s = finalStart != null ? finalStart : (old != null && old.get("start_reading") != null ? ((Number) old.get("start_reading")).intValue() : null);
            Integer e = finalEnd != null ? finalEnd : (old != null && old.get("end_reading") != null ? ((Number) old.get("end_reading")).intValue() : null);

            if (s != null && e != null && e < s) {
                throw new ApiException("END_READING_BELOW_START");
            }

            db.exec(
                    "INSERT INTO roast_meter(month, start_reading, end_reading, updated_by, updated_at) VALUES(?,?,?,?,?) " +
                    "ON DUPLICATE KEY UPDATE start_reading=VALUES(start_reading), end_reading=VALUES(end_reading), " +
                    "updated_by=VALUES(updated_by), updated_at=VALUES(updated_at)",
                    key, s, e, u.getId(), Times.stamp()
            );

            db.audit(u.getId(), "ROAST_METER_READING", "month:" + key, "start " + s + ", end " + e);
            return Map.of("ok", true);
        });
    }

    @PostMapping("/roasts/cylinders")
    public Map<String, Object> addCylinder(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "roast.execute");
        Map<String, Object> body = d != null ? d : Map.of();

        double kg = ValidationUtils.number(body, "kg", false);
        if (kg > 100) {
            throw new ApiException("INVALID_KG");
        }

        String day = body.get("fitted_on") != null ? body.get("fitted_on").toString().trim() : LocalDate.now(Times.IST_ZONE).toString();
        String note = body.get("note") != null ? body.get("note").toString().trim() : "";
        if (note.length() > 120) {
            note = note.substring(0, 120);
        }

        final String finalNote = note;
        return db.tx(() -> {
            db.insert("INSERT INTO gas_cylinders(fitted_on, kg, note, created_by, created_at) VALUES(?,?,?,?,?)",
                    day, kg, finalNote, u.getId(), Times.stamp());
            db.audit(u.getId(), "GAS_CYLINDER_FITTED", "day:" + day, kg + " kg");
            return Map.of("ok", true);
        });
    }
}
