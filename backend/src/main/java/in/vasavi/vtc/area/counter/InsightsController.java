package in.vasavi.vtc.area.counter;

import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.PasswordHasher;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class InsightsController {

    private static final int UNLOCK_MINUTES = 15;
    private static final Set<String> METHODS = Set.of("CASH", "UPI", "CARD");

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final PasswordHasher hasher;

    public InsightsController(Db db, SessionService sessionService, PermissionService permissionService, PasswordHasher hasher) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.hasher = hasher;
    }

    private void requireUnlocked(CurrentUser u) {
        permissionService.require(u, "counter.insights");
        Object untilObj = u.get("insights_until");
        if (untilObj == null || untilObj.toString().compareTo(Times.stamp()) < 0) {
            throw new ApiException("INSIGHTS_LOCKED", 423);
        }
    }

    private String todayIst() {
        return LocalDate.now(Times.IST_ZONE).format(DateTimeFormatter.ISO_LOCAL_DATE);
    }

    private String[] istDayBounds(String day) {
        try {
            LocalDate d = LocalDate.parse(day);
            String lo = d.atStartOfDay(Times.IST_ZONE).toInstant().toString();
            String hi = d.plusDays(1).atStartOfDay(Times.IST_ZONE).toInstant().toString();
            return new String[]{lo, hi};
        } catch (Exception e) {
            throw new ApiException("INVALID_DATE");
        }
    }

    private String normPhone(Object v) {
        String digits = v != null ? v.toString().replaceAll("\\D", "") : "";
        if (digits.length() == 12 && digits.startsWith("91")) {
            digits = digits.substring(2);
        }
        return (digits.length() >= 10 && digits.length() <= 13) ? digits : "";
    }

    private String mask(String phone) {
        if (phone == null || phone.length() <= 4) return "";
        return "\u2022".repeat(phone.length() - 4) + phone.substring(phone.length() - 4);
    }

    @PutMapping("/counter/insights/pin")
    public Map<String, Object> setPin(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.insights");
        Map<String, Object> body = d != null ? d : Map.of();

        String pin = body.get("pin") != null ? body.get("pin").toString().trim() : "";
        if (!pin.matches("^\\d{4}$") || pin.chars().distinct().count() == 1
                || "0123456789".contains(pin) || "9876543210".contains(pin)) {
            throw new ApiException("PIN_TOO_SIMPLE");
        }

        return db.tx(() -> {
            Map<String, Object> old = db.one("SELECT `value` FROM secrets WHERE `key`='insights_pin'");
            if (old != null) {
                String cur = body.get("current") != null ? body.get("current").toString() : "";
                if (!hasher.verifySecret(cur, (String) old.get("value"))) {
                    throw new ApiException("CURRENT_SECRET_WRONG");
                }
            }

            db.exec("INSERT INTO secrets(`key`, `value`, changed_by, changed_at) VALUES('insights_pin',?,?,?) " +
                    "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), changed_by=VALUES(changed_by), changed_at=VALUES(changed_at)",
                    hasher.hashSecret(pin), u.getId(), Times.stamp());
            db.audit(u.getId(), "INSIGHTS_PIN_SET", "secrets", "", "access");
            return Map.of("ok", true);
        });
    }

    @PostMapping("/counter/insights/unlock")
    public Map<String, Object> unlock(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.insights");
        Map<String, Object> body = d != null ? d : Map.of();
        String key = "insights_fail:" + u.getId();

        return db.tx(() -> {
            Map<String, Object> pinRow = db.one("SELECT `value` FROM secrets WHERE `key`='insights_pin'");
            if (pinRow == null) {
                throw new ApiException("INSIGHTS_PIN_NOT_SET");
            }
            Map<String, Object> fail = db.one("SELECT `value` FROM secrets WHERE `key`=?", key);
            int n = 0;
            String until = "";
            if (fail != null && fail.get("value") != null) {
                String[] parts = fail.get("value").toString().split("\\|");
                if (parts.length > 0 && !parts[0].isBlank()) n = Integer.parseInt(parts[0]);
                if (parts.length > 1) until = parts[1];
            }
            if (!until.isBlank() && until.compareTo(Times.stamp()) > 0) {
                throw new ApiException("ACCOUNT_LOCKED_TRY_LATER", 423);
            }

            String entered = body.get("pin") != null ? body.get("pin").toString() : "";
            if (!hasher.verifySecret(entered, (String) pinRow.get("value"))) {
                n++;
                String untilStamp = n >= 5 ? Times.later(10) : "";
                db.exec("INSERT INTO secrets(`key`, `value`, changed_at) VALUES(?,?,?) " +
                        "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), changed_at=VALUES(changed_at)",
                        key, (n >= 5 ? 0 : n) + "|" + untilStamp, Times.stamp());
                db.audit(u.getId(), "INSIGHTS_PIN_WRONG", "secrets", "attempt " + n, "access");
                throw new ApiException("WRONG_PIN");
            }

            db.exec("DELETE FROM secrets WHERE `key`=?", key);
            String unl = Times.later(UNLOCK_MINUTES);
            db.exec("UPDATE sessions SET insights_until=? WHERE token_hash=?", unl, u.get("session"));
            u.put("insights_until", unl);
            db.audit(u.getId(), "INSIGHTS_UNLOCKED", "counter", UNLOCK_MINUTES + " minutes", "access");

            return Map.of("ok", true, "minutes", UNLOCK_MINUTES);
        });
    }

    @PostMapping("/counter/insights/lock")
    public Map<String, Object> lock(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        db.txVoid(() -> db.exec("UPDATE sessions SET insights_until=NULL WHERE token_hash=?", u.get("session")));
        u.put("insights_until", null);
        return Map.of("ok", true);
    }

    @GetMapping("/counter/insights")
    public Map<String, Object> insights(@RequestParam(required = false) String day, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        requireUnlocked(u);

        String selDay = (day != null && !day.isBlank()) ? day : todayIst();
        String[] bounds = istDayBounds(selDay);
        boolean isToday = selDay.equals(todayIst());

        List<Map<String, Object>> sales = db.rows(
                "SELECT id, total_paise, discount_paise, created_at, created_by FROM counter_sales WHERE created_at>=? AND created_at<?",
                bounds[0], bounds[1]
        );
        List<Map<String, Object>> pays = db.rows(
                "SELECT p.method, p.amount_paise, s.created_by FROM counter_payments p JOIN counter_sales s ON s.id=p.sale_id " +
                "WHERE s.created_at>=? AND s.created_at<?", bounds[0], bounds[1]
        );

        int[] hours = new int[24];
        long total = 0;
        long discountTotal = 0;
        for (Map<String, Object> s : sales) {
            long t = ((Number) s.get("total_paise")).longValue();
            long d = ((Number) s.get("discount_paise")).longValue();
            total += t;
            discountTotal += d;
            String ca = (String) s.get("created_at");
            LocalDateTime ldt = Times.parse(ca).atZone(Times.IST_ZONE).toLocalDateTime();
            hours[ldt.getHour()] += t;
        }

        Map<String, Long> byMethod = new LinkedHashMap<>();
        for (String m : METHODS) {
            byMethod.put(m, 0L);
        }
        for (Map<String, Object> p : pays) {
            String m = (String) p.get("method");
            long amt = ((Number) p.get("amount_paise")).longValue();
            byMethod.put(m, byMethod.getOrDefault(m, 0L) + amt);
        }

        List<Map<String, Object>> trend = new ArrayList<>();
        LocalDate parsedDay = LocalDate.parse(selDay);
        for (int i = 29; i >= 0; i--) {
            String d = parsedDay.minusDays(i).toString();
            String[] b = istDayBounds(d);
            long dTot = db.queryForLong("SELECT COALESCE(SUM(total_paise),0) FROM counter_sales WHERE created_at>=? AND created_at<?", b[0], b[1]);
            trend.add(Map.of("day", d, "total_paise", dTot));
        }

        List<Map<String, Object>> cashiers = db.rows(
                "SELECT u.full_name name, COUNT(*) bills, SUM(s.total_paise) total_paise " +
                "FROM counter_sales s JOIN users u ON u.id=s.created_by WHERE s.created_at>=? AND s.created_at<? " +
                "GROUP BY u.id, u.full_name ORDER BY total_paise DESC", bounds[0], bounds[1]
        );

        List<Map<String, Object>> coll = db.rows(
                "SELECT k.*, u.full_name by_name FROM counter_collections k JOIN users u ON u.id=k.created_by WHERE day=? ORDER BY k.id",
                selDay
        );
        Map<String, Long> entered = new LinkedHashMap<>();
        for (String m : METHODS) entered.put(m, 0L);
        for (Map<String, Object> k : coll) {
            String m = (String) k.get("method");
            long amt = ((Number) k.get("amount_paise")).longValue();
            entered.put(m, entered.getOrDefault(m, 0L) + amt);
        }

        Object floatObj = db.getSetting("counter_opening_float_paise");
        Long opening = floatObj != null ? Long.parseLong(floatObj.toString()) : null;
        long cashSales = byMethod.getOrDefault("CASH", 0L);
        long cashRefunds = db.queryForLong(
                "SELECT COALESCE(SUM(amount_paise),0) FROM counter_refunds WHERE method='CASH' AND state='APPROVED' AND decided_at>=? AND decided_at<?",
                bounds[0], bounds[1]
        );
        Long expectedPaise = opening != null ? (opening + cashSales - cashRefunds) : null;

        Map<String, Object> exp = new LinkedHashMap<>();
        exp.put("opening_paise", opening);
        exp.put("cash_sales_paise", cashSales);
        exp.put("cash_refunds_paise", cashRefunds);
        exp.put("expected_paise", expectedPaise);

        Map<String, Object> check = new LinkedHashMap<>();
        Long cashDiff = (expectedPaise == null || entered.get("CASH") == 0) ? null : (entered.get("CASH") - expectedPaise);
        Long upiDiff = entered.get("UPI") > 0 ? (entered.get("UPI") - byMethod.getOrDefault("UPI", 0L)) : null;
        check.put("cash_diff_paise", cashDiff);
        check.put("upi_diff_paise", upiDiff);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("day", selDay);
        res.put("is_today", isToday);
        res.put("bills", sales.size());
        res.put("total_paise", total);
        res.put("discount_paise", discountTotal);
        res.put("by_method", byMethod);
        res.put("expected", exp);
        res.put("hours", hours);
        res.put("forecast", null);
        res.put("trend", trend);
        res.put("cashiers", cashiers);
        res.put("collections", coll);
        res.put("entered", entered);
        res.put("check", check);
        res.put("unlocked_until", u.get("insights_until"));

        return res;
    }

    @PostMapping("/counter/collections")
    public Map<String, Object> addCollection(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        requireUnlocked(u);
        Map<String, Object> body = d != null ? d : Map.of();

        String method = (String) body.get("method");
        if (!METHODS.contains(method)) {
            throw new ApiException("INVALID_PAYMENT_METHOD");
        }

        String day = body.get("day") != null ? body.get("day").toString().trim() : todayIst();
        istDayBounds(day);

        long amount = ValidationUtils.paise(body, "amount", false);
        String note = body.get("note") != null ? body.get("note").toString().trim() : "";
        if (note.length() > 200) note = note.substring(0, 200);

        final String finalNote = note;
        return db.tx(() -> {
            db.insert("INSERT INTO counter_collections(day, method, amount_paise, note, created_by, created_at) VALUES(?,?,?,?,?,?)",
                    day, method, amount, finalNote, u.getId(), Times.stamp());
            db.audit(u.getId(), "COUNTER_COLLECTION_ENTERED", "day:" + day, String.format("%s Rs.%.2f", method, amount / 100.0));
            return Map.of("ok", true);
        });
    }

    @GetMapping("/counter/customers/lookup")
    public Map<String, Object> lookup(@RequestParam String phone, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.sell");
        String p = normPhone(phone);
        if (p.isBlank()) {
            throw new ApiException("INVALID_PHONE");
        }

        return db.tx(() -> {
            Map<String, Object> cu = db.one("SELECT * FROM counter_customers WHERE phone=?", p);
            db.audit(u.getId(), "CUSTOMER_LOOKUP", "customer:" + (cu != null ? cu.get("id") : "new"), mask(p), "access");
            if (cu == null) {
                return Map.of("found", false, "phone_masked", mask(p));
            }

            long cid = ((Number) cu.get("id")).longValue();
            Map<String, Object> last = db.one("SELECT * FROM counter_sales WHERE customer_id=? ORDER BY id DESC LIMIT 1", cid);
            List<Map<String, Object>> lines = last != null ?
                    db.rows("SELECT item_id, item_name, weight_kg, rate_paise, coffee_pct FROM counter_lines WHERE sale_id=? ORDER BY id", last.get("id"))
                    : List.of();

            Object crObj = db.getSetting("custom_coffee_rate_paise");
            Object chObj = db.getSetting("custom_chicory_rate_paise");
            Long coffeeRate = crObj != null ? Long.parseLong(crObj.toString()) : null;
            Long chicRate = chObj != null ? Long.parseLong(chObj.toString()) : null;

            for (Map<String, Object> ln : lines) {
                Object itId = ln.get("item_id");
                if (itId != null) {
                    Map<String, Object> it = db.one("SELECT price_per_kg_paise, active FROM counter_items WHERE id=?", itId);
                    ln.put("price_now", (it != null && ((Number) it.get("active")).intValue() != 0) ? it.get("price_per_kg_paise") : null);
                } else if (ln.get("coffee_pct") != null && coffeeRate != null && chicRate != null) {
                    double pct = ((Number) ln.get("coffee_pct")).doubleValue();
                    ln.put("price_now", Math.round(pct / 100.0 * coffeeRate + (100.0 - pct) / 100.0 * chicRate));
                } else {
                    ln.put("price_now", null);
                }
            }

            Map<String, Object> fav = db.one(
                    "SELECT item_name, COUNT(*) n FROM counter_lines l JOIN counter_sales s ON s.id=l.sale_id " +
                    "WHERE s.customer_id=? GROUP BY item_name ORDER BY n DESC LIMIT 1", cid
            );

            Map<String, Object> res = new LinkedHashMap<>();
            res.put("found", true);
            res.put("id", cid);
            res.put("name", cu.get("name"));
            res.put("phone_masked", mask(p));
            res.put("visits", cu.get("visits"));
            res.put("first_seen", cu.get("first_seen"));
            res.put("last_seen", cu.get("last_seen"));
            res.put("favourite", fav != null ? fav.get("item_name") : null);
            res.put("last_bill", last != null ? Map.of(
                    "bill_no", last.get("bill_no"),
                    "at", last.get("created_at"),
                    "total_paise", last.get("total_paise"),
                    "lines", lines
            ) : null);

            return res;
        });
    }

    @GetMapping("/counter/customers")
    public List<Map<String, Object>> customerList(@RequestParam(required = false, defaultValue = "") String q, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.customers");
        String term = "%" + q.trim() + "%";

        return db.tx(() -> {
            List<Map<String, Object>> rows = db.rows(
                    "SELECT k.*, (SELECT COALESCE(SUM(total_paise),0) FROM counter_sales s WHERE s.customer_id=k.id) spent_paise " +
                    "FROM counter_customers k WHERE k.phone LIKE ? OR k.name LIKE ? ORDER BY k.last_seen DESC LIMIT 300",
                    term, term
            );
            db.audit(u.getId(), "CUSTOMER_LIST_VIEWED", "counter_customers", rows.size() + " rows", "access");
            return rows;
        });
    }
}
