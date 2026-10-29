package in.vasavi.vtc.area.counter;

import com.fasterxml.jackson.databind.ObjectMapper;
import in.vasavi.vtc.common.AlertsService;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.CodesService;
import in.vasavi.vtc.common.LedgerService;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.common.WorktasksService;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class CounterController {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final Set<String> KINDS = Set.of("coffee_ground", "coffee_beans", "product");
    private static final Set<String> METHODS = Set.of("CASH", "UPI", "CARD");
    private static final Object SALE_LOCK = new Object();

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final LedgerService ledger;
    private final CodesService codes;
    private final WorktasksService worktasks;
    private final AlertsService alerts;
    private final ObjectMapper mapper;

    public CounterController(Db db,
                             SessionService sessionService,
                             PermissionService permissionService,
                             LedgerService ledger,
                             CodesService codes,
                             WorktasksService worktasks,
                             AlertsService alerts,
                             ObjectMapper mapper) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.ledger = ledger;
        this.codes = codes;
        this.worktasks = worktasks;
        this.alerts = alerts;
        this.mapper = mapper;
    }

    private String todayIst() {
        return LocalDate.now(IST).format(DateTimeFormatter.ISO_LOCAL_DATE);
    }

    private String[] istDayBounds(String day) {
        try {
            LocalDate d = LocalDate.parse(day);
            String lo = d.atStartOfDay(IST).toInstant().toString();
            String hi = d.plusDays(1).atStartOfDay(IST).toInstant().toString();
            return new String[]{lo, hi};
        } catch (Exception e) {
            throw new ApiException("INVALID_DATE");
        }
    }

    private long paise(Map<String, Object> d, String k, boolean allowZero) {
        Object v = d.get(k);
        if (v == null || v instanceof Boolean || "".equals(v)) {
            throw new ApiException("INVALID_" + k.toUpperCase());
        }
        long n;
        try {
            n = ((Number) v).longValue();
        } catch (Exception e) {
            try {
                n = Long.parseLong(v.toString());
            } catch (Exception ex) {
                throw new ApiException("INVALID_" + k.toUpperCase());
            }
        }
        if (n < 0 || (n == 0 && !allowZero) || n > 10_000_000_000L) {
            throw new ApiException("INVALID_" + k.toUpperCase());
        }
        return n;
    }

    private String maskPhone(Object p) {
        String s = p != null ? p.toString().replaceAll("\\D", "") : "";
        if (s.length() > 10) s = s.substring(s.length() - 10);
        if (s.length() > 4) {
            return "\u2022".repeat(s.length() - 4) + s.substring(s.length() - 4);
        }
        return "";
    }

    private Map<String, Object> bill(long sid) {
        Map<String, Object> s = db.one("SELECT s.*, u.full_name cashier FROM counter_sales s JOIN users u ON u.id=s.created_by WHERE s.id=?", sid);
        if (s == null) throw new ApiException("NOT_FOUND", 404);
        s.put("customer_phone", maskPhone(s.get("customer_phone")));
        List<Map<String, Object>> lines = db.rows("SELECT * FROM counter_lines WHERE sale_id=? ORDER BY id", sid);
        List<Map<String, Object>> pays = db.rows("SELECT * FROM counter_payments WHERE sale_id=? ORDER BY id", sid);
        List<Map<String, Object>> refs = db.rows("SELECT r.*, a.full_name requested_by_name, b.full_name decided_by_name FROM counter_refunds r " +
                "JOIN users a ON a.id=r.requested_by LEFT JOIN users b ON b.id=r.decided_by WHERE sale_id=? ORDER BY r.id", sid);
        s.put("lines", lines);
        s.put("payments", pays);
        s.put("refunds", refs);
        Map<String, Object> st = db.allSettings();
        s.put("header", Map.of(
                "company_name", st.getOrDefault("company_name", ""),
                "company_address", st.getOrDefault("company_address", ""),
                "company_gstin", st.getOrDefault("company_gstin", ""),
                "tax_setup_approved", st.getOrDefault("tax_setup_approved", 0)
        ));
        return s;
    }

    private Map<String, Object> dayClose(String day) {
        return db.one("SELECT * FROM cash_closes WHERE shift_date=? AND state NOT IN ('REJECTED','REOPENED') ORDER BY id DESC LIMIT 1", day);
    }

    // --- Transfers ---
    @GetMapping("/transfers")
    public List<Map<String, Object>> listTransfers(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "inventory.transfer", "inventory.view", "counter.sell");
        return db.rows("SELECT t.*, l.name lot_name, l.code lot_code, tl.code transit_code, s.full_name sent_by_name, r.full_name received_by_name FROM transfers t " +
                "JOIN lots l ON l.id=t.source_lot_id LEFT JOIN lots tl ON tl.id=t.transit_lot_id JOIN users s ON s.id=t.sent_by LEFT JOIN users r ON r.id=t.received_by " +
                "ORDER BY t.id DESC LIMIT 100");
    }

    @PostMapping("/transfers")
    public Map<String, Object> sendTransfer(@RequestBody(required = false) Map<String, Object> d,
                                            @RequestHeader(value = "X-Idempotency-Key", required = false) String idemKey,
                                            HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "inventory.transfer");
        Map<String, Object> body = d != null ? d : Map.of();
        double kg = ValidationUtils.r3(ValidationUtils.number(body, "kg", true));
        String rawNote = body.containsKey("note") ? String.valueOf(body.get("note")).trim() : "";
        final String note = rawNote.length() > 200 ? rawNote.substring(0, 200) : rawNote;

        return db.tx(() -> {
            Map<String, Object> prev = db.idemGet(u.getId(), "TRANSFER", idemKey);
            if (prev != null) return prev;

            long lotId = ((Number) body.getOrDefault("lot_id", 0)).longValue();
            Map<String, Object> src = ledger.lot(lotId);
            if (!LedgerService.PROD.equals(src.get("location"))) throw new ApiException("LOT_WRONG_LOCATION");

            long tid = db.insert("INSERT INTO transfers(from_loc, to_loc, source_lot_id, kg_sent, state, note, sent_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?,?)", LedgerService.PROD, LedgerService.COUNTER, src.get("id"), kg, "IN_TRANSIT", note, u.getId(), Times.stamp());

            ledger.consume(lotId, kg, "TRANSFER_OUT", tid, u.getId(), Set.of("RAW", "ROASTED", "GROUND", "BLENDED", "PACKED"), LedgerService.PROD);

            Long prodId = src.get("product_id") != null ? ((Number) src.get("product_id")).longValue() : null;
            Long beanId = src.get("bean_id") != null ? ((Number) src.get("bean_id")).longValue() : null;
            Double packG = src.get("pack_g") != null ? ((Number) src.get("pack_g")).doubleValue() : null;
            String form = (String) src.get("form");

            long transit = ledger.newLot(src.get("name") + " -> counter (transfer #" + tid + ")",
                    (String) src.get("stage"), "IN_TRANSIT", "VTC", prodId, "TRANSIT", (Long) null, (Long) null, (Long) null, packG, beanId, "TRF", (String) src.get("roasted_on"));
            ledger.move(transit, kg, "TRANSFER_IN_TRANSIT", tid, u.getId());
            db.exec("UPDATE transfers SET transit_lot_id=? WHERE id=?", transit, tid);
            db.audit(u.getId(), "TRANSFER_SENT", "transfer:" + tid, kg + " kg from lot #" + src.get("id"));

            Map<String, Object> res = Map.of("id", tid, "lot_id", transit);
            db.idemSave(u.getId(), "TRANSFER", idemKey, res);
            return res;
        });
    }

    @PostMapping("/transfers/{tid}/receive")
    public Map<String, Object> receiveTransfer(@PathVariable long tid,
                                               @RequestBody(required = false) Map<String, Object> d,
                                               HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "inventory.transfer", "counter.sell");
        Map<String, Object> body = d != null ? d : Map.of();
        double got = ValidationUtils.r3(ValidationUtils.number(body, "kg_received", false));

        return db.tx(() -> {
            Map<String, Object> t = db.one("SELECT * FROM transfers WHERE id=?", tid);
            if (t == null) throw new ApiException("NOT_FOUND", 404);
            if (!"IN_TRANSIT".equals(t.get("state"))) throw new ApiException("TRANSFER_ALREADY_RECEIVED");
            if (((Number) t.get("sent_by")).longValue() == u.getId()) throw new ApiException("SENDER_CANNOT_RECEIVE");
            double kgSent = ((Number) t.get("kg_sent")).doubleValue();
            if (got > kgSent + 1e-4) throw new ApiException("RECEIVED_MORE_THAN_SENT");

            long transitLotId = ((Number) t.get("transit_lot_id")).longValue();
            Map<String, Object> transit = ledger.lot(transitLotId);
            ledger.move(transitLotId, -kgSent, "TRANSFER_ARRIVED", tid, u.getId());
            db.exec("UPDATE lots SET status='CLOSED' WHERE id=?", transitLotId);

            Long dest = null;
            if (got > 0) {
                String transitCode = (String) transit.get("code");
                String destCode = transitCode != null ? transitCode.replaceFirst("TRF-", "CTR-") : null;
                Long prodId = transit.get("product_id") != null ? ((Number) transit.get("product_id")).longValue() : null;
                Long beanId = transit.get("bean_id") != null ? ((Number) transit.get("bean_id")).longValue() : null;
                Double packG = transit.get("pack_g") != null ? ((Number) transit.get("pack_g")).doubleValue() : null;

                dest = ledger.newLot(
                        ((String) transit.get("name")).replace(" -> counter", " at counter"),
                        (String) transit.get("stage"), "RELEASED", "VTC", prodId, "CTR-01", (Long) null, (Long) null, (Long) null, packG, beanId, "CTR", (String) transit.get("roasted_on")
                );
                ledger.move(dest, got, "TRANSFER_RECEIVED", tid, u.getId());
            }

            double shortKg = ValidationUtils.r3(kgSent - got);
            String state = shortKg <= 1e-4 ? "RECEIVED" : "SHORTAGE";
            if (shortKg > 1e-4) {
                Long prodId = transit.get("product_id") != null ? ((Number) transit.get("product_id")).longValue() : null;
                Long beanId = transit.get("bean_id") != null ? ((Number) transit.get("bean_id")).longValue() : null;
                long loss = ledger.newLot("Transfer #" + tid + " shortage", (String) transit.get("stage"), "LOSS", "VTC",
                        prodId, "TRANSIT", (Long) null, (Long) null, (Long) null, (Double) null, beanId, "LOS", null);
                ledger.move(loss, shortKg, "TRANSFER_SHORTAGE_RECORDED", tid, u.getId());
                ledger.move(loss, -shortKg, "TRANSFER_SHORTAGE_WRITTEN_OFF", tid, u.getId());
                alerts.notifyPerm("stock.cycle_approve", "high", "Transfer #" + tid + " arrived " + shortKg + " kg short",
                        "Sent " + kgSent + " kg, counted " + got + " kg at the counter.", "exceptions", "transfer", tid, null, null);
                alerts.notifyPerm("tasks.update_any", "high", "Transfer #" + tid + " arrived " + shortKg + " kg short",
                        "Sent " + kgSent + " kg, counted " + got + " kg at the counter.", "exceptions", "transfer", tid, null, null);
            }

            db.exec("UPDATE transfers SET kg_received=?, dest_lot_id=?, state=?, received_by=?, received_at=? WHERE id=?",
                    got, dest, state, u.getId(), Times.stamp(), tid);
            db.audit(u.getId(), "TRANSFER_RECEIVED", "transfer:" + tid, "received " + got + " of " + kgSent + " kg" + (shortKg > 0 ? ", short " + shortKg : ""));
            return Map.of("ok", true, "state", state, "shortage_kg", Math.max(shortKg, 0.0));
        });
    }

    // --- Counter Setup & Items ---
    private Map<String, Object> counterStock() {
        List<Map<String, Object>> rows = ledger.stockRows("l.location='CTR-01' AND l.status='RELEASED' AND l.owner='VTC'");
        double ground = 0.0;
        double beans = 0.0;
        Map<Long, Double> prods = new HashMap<>();
        for (Map<String, Object> r : rows) {
            String stage = (String) r.get("stage");
            Object prodIdObj = r.get("product_id");
            double avail = ((Number) r.get("available_kg")).doubleValue();
            if ("GROUND".equals(stage)) {
                ground += avail;
            } else if (("ROASTED".equals(stage) || "BLENDED".equals(stage)) && prodIdObj == null) {
                beans += avail;
            }
            if (prodIdObj != null) {
                long pid = ((Number) prodIdObj).longValue();
                prods.put(pid, prods.getOrDefault(pid, 0.0) + avail);
            }
        }
        return Map.of(
                "coffee_ground", ValidationUtils.r3(ground),
                "coffee_beans", ValidationUtils.r3(beans),
                "products", prods
        );
    }

    @GetMapping("/counter/setup")
    public Map<String, Object> counterSetup(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "counter.sell", "system.settings");
        List<Map<String, Object>> items = db.rows("SELECT i.*, p.name chicory_name, s.name stock_name FROM counter_items i " +
                "LEFT JOIN masters p ON p.id=i.chicory_product_id LEFT JOIN masters s ON s.id=i.stock_product_id " +
                "ORDER BY i.active DESC, i.name");
        Map<String, Object> stock = counterStock();
        Map<Long, Double> prods = (Map<Long, Double>) stock.get("products");

        for (Map<String, Object> i : items) {
            String kind = (String) i.get("kind");
            if ("product".equals(kind)) {
                long spid = i.get("stock_product_id") != null ? ((Number) i.get("stock_product_id")).longValue() : 0;
                i.put("stock_kg", ValidationUtils.r3(prods.getOrDefault(spid, 0.0)));
            } else {
                double coffee = ((Number) stock.get(kind)).doubleValue();
                double pct = ((Number) i.get("coffee_pct")).doubleValue() / 100.0;
                Long cid = i.get("chicory_product_id") != null ? ((Number) i.get("chicory_product_id")).longValue() : null;
                Double chic = (pct < 1.0 && cid != null) ? prods.getOrDefault(cid, 0.0) : null;
                double can = pct > 0 ? coffee / pct : Double.POSITIVE_INFINITY;
                if (chic != null) {
                    can = Math.min(can, chic / (1.0 - pct));
                }
                i.put("stock_kg", Double.isInfinite(can) ? 0.0 : ValidationUtils.r3(can));
            }
        }

        List<Map<String, Object>> incoming = db.rows("SELECT t.id, t.kg_sent, l.name lot_name, tl.code transit_code, t.created_at, t.sent_by FROM transfers t " +
                "JOIN lots l ON l.id=t.source_lot_id LEFT JOIN lots tl ON tl.id=t.transit_lot_id WHERE t.state='IN_TRANSIT' ORDER BY t.id");
        List<Map<String, Object>> products = db.rows("SELECT id, name, category FROM masters WHERE kind='product' AND state='ACTIVE' ORDER BY name");
        Map<String, Object> closed = dayClose(todayIst());

        Object chicIdObj = db.getSetting("custom_chicory_product_id");
        double customChic = 0.0;
        if (chicIdObj != null) {
            try {
                long chicId = Long.parseLong(chicIdObj.toString());
                customChic = prods.getOrDefault(chicId, 0.0);
            } catch (Exception ignored) {}
        }
        Map<String, Object> outStock = new HashMap<>();
        outStock.put("coffee_ground", stock.get("coffee_ground"));
        outStock.put("coffee_beans", stock.get("coffee_beans"));
        outStock.put("custom_chicory", ValidationUtils.r3(customChic));
        outStock.put("resting", stock.getOrDefault("resting", Map.of()));

        Map<String, Object> settings = new HashMap<>();
        for (String k : List.of("company_name", "company_address", "company_gstin", "tax_setup_approved",
                "discount_cap_pct", "counter_opening_float_paise", "bill_prefix",
                "custom_coffee_rate_paise", "custom_chicory_rate_paise", "custom_chicory_product_id")) {
            settings.put(k, db.getSetting(k));
        }

        Map<String, Object> res = new HashMap<>();
        res.put("items", items);
        res.put("incoming", incoming);
        res.put("products", products);
        res.put("day_closed", closed != null ? closed : false);
        res.put("settings", settings);
        res.put("stock", outStock);
        return res;
    }

    private Map<String, Object> itemFields(Map<String, Object> d) {
        String kind = (String) d.get("kind");
        if (!KINDS.contains(kind)) throw new ApiException("INVALID_KIND");
        String name = ValidationUtils.text(d, "name", 2, 60, "NAME_REQUIRED");
        long price = paise(d, "price_per_kg_paise", false);
        String hsn = d.containsKey("hsn") ? String.valueOf(d.get("hsn")).trim() : "";
        if (hsn.length() > 12) hsn = hsn.substring(0, 12);

        Long gst = d.get("gst_rate_bp") != null && !"".equals(d.get("gst_rate_bp")) ? ((Number) d.get("gst_rate_bp")).longValue() : null;
        if (gst != null && (gst < 0 || gst > 2800)) throw new ApiException("INVALID_GST_RATE");

        Long stockPid = null;
        double coffeePct = 0.0;
        Long chicPid = null;

        if ("product".equals(kind)) {
            stockPid = ((Number) d.getOrDefault("stock_product_id", 0)).longValue();
            if (stockPid <= 0 || db.one("SELECT 1 FROM masters WHERE id=? AND kind='product' AND state='ACTIVE'", stockPid) == null) {
                throw new ApiException("STOCK_PRODUCT_REQUIRED");
            }
        } else {
            coffeePct = ValidationUtils.number(d, "coffee_pct", false);
            if (coffeePct > 100) throw new ApiException("INVALID_COFFEE_PCT");
            if (coffeePct < 100) {
                chicPid = ((Number) d.getOrDefault("chicory_product_id", 0)).longValue();
                if (chicPid <= 0 || db.one("SELECT 1 FROM masters WHERE id=? AND kind='product' AND state='ACTIVE'", chicPid) == null) {
                    throw new ApiException("CHICORY_PRODUCT_REQUIRED");
                }
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("kind", kind);
        out.put("price_per_kg_paise", price);
        out.put("hsn", hsn);
        out.put("gst_rate_bp", gst);
        out.put("stock_product_id", stockPid);
        out.put("coffee_pct", coffeePct);
        out.put("chicory_product_id", chicPid);
        return out;
    }

    @PostMapping("/counter/items")
    public Map<String, Object> addItem(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        Map<String, Object> body = d != null ? d : Map.of();
        return db.tx(() -> {
            Map<String, Object> f = itemFields(body);
            long iid = db.insert("INSERT INTO counter_items(name, kind, coffee_pct, chicory_product_id, stock_product_id, price_per_kg_paise, " +
                            "gst_rate_bp, hsn, changed_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    f.get("name"), f.get("kind"), f.get("coffee_pct"), f.get("chicory_product_id"), f.get("stock_product_id"),
                    f.get("price_per_kg_paise"), f.get("gst_rate_bp"), f.get("hsn"), u.getId(), Times.stamp());
            db.audit(u.getId(), "PRICE_PUBLISHED", "counter_item:" + iid, f.get("name") + " Rs." + (((Number) f.get("price_per_kg_paise")).doubleValue() / 100.0) + "/kg (v1)");
            return Map.of("id", iid);
        });
    }

    @PutMapping("/counter/items/{iid}")
    public Map<String, Object> updateItem(@PathVariable long iid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        Map<String, Object> body = d != null ? d : Map.of();
        return db.tx(() -> {
            Map<String, Object> old = db.one("SELECT * FROM counter_items WHERE id=?", iid);
            if (old == null) throw new ApiException("NOT_FOUND", 404);
            if (body.size() == 1 && body.containsKey("active")) {
                boolean act = Boolean.TRUE.equals(body.get("active"));
                db.exec("UPDATE counter_items SET active=? WHERE id=?", act ? 1 : 0, iid);
                db.audit(u.getId(), "PRICE_ITEM_" + (act ? "ON" : "OFF"), "counter_item:" + iid, (String) old.get("name"));
                return Map.of("ok", true);
            }
            Map<String, Object> merged = new LinkedHashMap<>(old);
            merged.putAll(body);
            Map<String, Object> f = itemFields(merged);
            db.exec("UPDATE counter_items SET name=?, kind=?, coffee_pct=?, chicory_product_id=?, stock_product_id=?, " +
                            "price_per_kg_paise=?, gst_rate_bp=?, hsn=?, version=version+1, changed_by=? WHERE id=?",
                    f.get("name"), f.get("kind"), f.get("coffee_pct"), f.get("chicory_product_id"), f.get("stock_product_id"),
                    f.get("price_per_kg_paise"), f.get("gst_rate_bp"), f.get("hsn"), u.getId(), iid);
            db.audit(u.getId(), "PRICE_PUBLISHED", "counter_item:" + iid, f.get("name") + ": Rs." + (((Number) f.get("price_per_kg_paise")).doubleValue() / 100.0) + "/kg (v" + (((Number) old.get("version")).intValue() + 1) + ")");
            return Map.of("ok", true);
        });
    }

    // --- Counter Sales ---
    @GetMapping("/counter/sales")
    public Map<String, Object> listSales(@RequestParam(required = false) String day, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "counter.sell", "counter.refund", "counter.close_approve", "reports.commercial");
        String d = (day != null && !day.isBlank()) ? day : todayIst();
        String[] bounds = istDayBounds(d);
        List<Map<String, Object>> rows = db.rows("SELECT s.*, u.full_name cashier, (SELECT GROUP_CONCAT(method) FROM counter_payments p " +
                "WHERE p.sale_id=s.id) methods FROM counter_sales s JOIN users u ON u.id=s.created_by " +
                "WHERE s.created_at>=? AND s.created_at<? ORDER BY s.id DESC", bounds[0], bounds[1]);
        for (Map<String, Object> r : rows) {
            r.put("customer_phone", maskPhone(r.get("customer_phone")));
        }
        List<Map<String, Object>> refunds = db.rows("SELECT r.*, s.bill_no, a.full_name requested_by_name FROM counter_refunds r " +
                "JOIN counter_sales s ON s.id=r.sale_id JOIN users a ON a.id=r.requested_by " +
                "WHERE r.state='REQUESTED' ORDER BY r.id");
        Map<String, Object> closed = dayClose(d);
        long totalPaise = 0;
        for (Map<String, Object> r : rows) totalPaise += ((Number) r.get("total_paise")).longValue();

        return Map.of(
                "day", d,
                "sales", rows,
                "pending_refunds", refunds,
                "closed", closed != null ? Map.of("id", closed.get("id"), "state", closed.get("state"), "created_at", closed.get("created_at")) : false,
                "totals", Map.of("bills", rows.size(), "total_paise", totalPaise)
        );
    }

    @GetMapping("/counter/sales/{sid}")
    public Map<String, Object> getSale(@PathVariable long sid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "counter.sell", "counter.refund", "counter.close_approve");
        return bill(sid);
    }

    @PostMapping("/counter/sales/{sid}/reprint")
    public Map<String, Object> reprintSale(@PathVariable long sid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "counter.sell", "counter.refund", "counter.close_approve");
        return db.tx(() -> {
            Map<String, Object> s = db.one("SELECT * FROM counter_sales WHERE id=?", sid);
            if (s == null) throw new ApiException("NOT_FOUND", 404);
            int newReprints = ((Number) s.getOrDefault("reprints", 0)).intValue() + 1;
            db.exec("UPDATE counter_sales SET reprints=? WHERE id=?", newReprints, sid);
            db.audit(u.getId(), "COUNTER_BILL_REPRINT", "sale:" + sid, s.get("bill_no") + " reprint #" + newReprints);
            return bill(sid);
        });
    }

    private void deductCounterStock(Map<String, Object> item, double weight, long sid, long uid) {
        try {
            if (item.get("id") == null) {
                double coffeePct = ((Number) item.get("coffee_pct")).doubleValue();
                double coffee = ValidationUtils.r3(weight * coffeePct / 100.0);
                double chicory = ValidationUtils.r3(weight - coffee);
                if (coffee > 0) {
                    ledger.fifo(coffee, "location='CTR-01' AND owner='VTC' AND product_id IS NULL AND stage='GROUND'", List.of(), "COUNTER_SALE", sid, uid);
                }
                if (chicory > 0) {
                    long cid = ((Number) item.get("chicory_product_id")).longValue();
                    ledger.fifo(chicory, "location='CTR-01' AND owner='VTC' AND product_id=?", List.of(cid), "COUNTER_SALE", sid, uid);
                }
                return;
            }
            String kind = (String) item.get("kind");
            if ("product".equals(kind)) {
                long spid = ((Number) item.get("stock_product_id")).longValue();
                ledger.fifo(weight, "location='CTR-01' AND owner='VTC' AND product_id=?", List.of(spid), "COUNTER_SALE", sid, uid);
                return;
            }
            double coffeePct = ((Number) item.get("coffee_pct")).doubleValue();
            double coffee = ValidationUtils.r3(weight * coffeePct / 100.0);
            double chicory = ValidationUtils.r3(weight - coffee);
            if (coffee > 0) {
                if ("coffee_ground".equals(kind)) {
                    ledger.fifo(coffee, "location='CTR-01' AND owner='VTC' AND product_id IS NULL AND stage='GROUND'", List.of(), "COUNTER_SALE", sid, uid);
                } else {
                    ledger.fifo(coffee, "location='CTR-01' AND owner='VTC' AND product_id IS NULL AND stage IN ('ROASTED','BLENDED')", List.of(), "COUNTER_SALE", sid, uid);
                }
            }
            if (chicory > 0) {
                long cid = ((Number) item.get("chicory_product_id")).longValue();
                ledger.fifo(chicory, "location='CTR-01' AND owner='VTC' AND product_id=?", List.of(cid), "COUNTER_SALE", sid, uid);
            }
        } catch (ApiException e) {
            if ("INSUFFICIENT_STOCK".equals(e.getDetail())) {
                throw new ApiException("NOT_ENOUGH_AT_COUNTER", 400);
            }
            throw e;
        }
    }

    @PostMapping("/counter/sales")
    public Map<String, Object> createSale(@RequestBody(required = false) Map<String, Object> d,
                                          @RequestHeader(value = "X-Idempotency-Key", required = false) String idemKey,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.sell");
        Map<String, Object> body = d != null ? d : Map.of();

        Object linesInObj = body.get("lines");
        if (!(linesInObj instanceof List<?> linesIn) || linesIn.isEmpty() || linesIn.size() > 30) {
            throw new ApiException("BILL_NEEDS_ITEMS");
        }
        Object paysInObj = body.get("payments");
        if (!(paysInObj instanceof List<?> paysIn) || paysIn.isEmpty() || paysIn.size() > 4) {
            throw new ApiException("PAYMENT_REQUIRED");
        }

        synchronized (SALE_LOCK) {
            return db.tx(() -> {
                Map<String, Object> prev = db.idemGet(u.getId(), "COUNTER_SALE", idemKey);
                if (prev != null) {
                    long prevId = ((Number) prev.get("id")).longValue();
                    return bill(prevId);
                }

                if (dayClose(todayIst()) != null) throw new ApiException("COUNTER_CLOSED_FOR_TODAY");

                List<Map.Entry<Map<String, Object>, Double>> lines = new ArrayList<>();
                long subtotal = 0;
                for (Object x : linesIn) {
                    Map<String, Object> lineMap = (Map<String, Object>) x;
                    Map<String, Object> item;
                    if (lineMap.containsKey("custom")) {
                        item = customItem(u, (Map<String, Object>) lineMap.get("custom"));
                    } else {
                        long itemId = ((Number) lineMap.getOrDefault("item_id", 0)).longValue();
                        item = db.one("SELECT * FROM counter_items WHERE id=? AND active=1", itemId);
                        if (item == null) throw new ApiException("ITEM_NOT_ON_PRICE_LIST");
                    }
                    double w = ValidationUtils.r3(ValidationUtils.number(lineMap, "weight_kg", true));
                    long rate = ((Number) item.get("price_per_kg_paise")).longValue();
                    long amount = Math.round(w * rate);
                    lines.add(Map.entry(item, w));
                    subtotal += amount;
                }

                long discount = body.containsKey("discount_paise") ? ((Number) body.get("discount_paise")).longValue() : 0;
                String reason = body.containsKey("discount_reason") ? String.valueOf(body.get("discount_reason")).trim() : "";
                if (discount > 0) {
                    permissionService.require(u, "counter.discount");
                    Object capObj = db.getSetting("discount_cap_pct");
                    if (capObj == null) throw new ApiException("DISCOUNTS_NOT_SET_UP");
                    double cap = Double.parseDouble(capObj.toString());
                    if (discount > subtotal * cap / 100.0 + 0.5) throw new ApiException("DISCOUNT_ABOVE_CAP");
                    if (reason.length() < 3) throw new ApiException("DISCOUNT_REASON_REQUIRED");
                }

                long total = subtotal - discount;
                long paid = 0;
                for (Object p : paysIn) {
                    Map<String, Object> payMap = (Map<String, Object>) p;
                    String method = (String) payMap.get("method");
                    if (!METHODS.contains(method)) throw new ApiException("INVALID_PAYMENT_METHOD");
                    paid += paise(payMap, "amount_paise", false);
                }
                if (paid != total) throw new ApiException("PAYMENT_MUST_EQUAL_TOTAL");

                String prefix = codes.code("bill_prefix", "CTR");
                String billNo = codes.nextCode("counter_sales", "bill_no", prefix);

                String custPhone = body.get("customer_phone") != null ? body.get("customer_phone").toString().trim() : "";
                String custName = body.get("customer_name") != null ? body.get("customer_name").toString().trim() : "";

                long sid = db.insert("INSERT INTO counter_sales(bill_no, customer_name, customer_phone, subtotal_paise, discount_paise, " +
                                "discount_reason, total_paise, status, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                        billNo, custName, custPhone,
                        subtotal, discount, reason, total, "PAID", u.getId(), Times.stamp());

                Long cid = rememberCustomer(custPhone, custName);
                if (cid != null) {
                    db.exec("UPDATE counter_sales SET customer_id=? WHERE id=?", cid, sid);
                }

                for (Map.Entry<Map<String, Object>, Double> entry : lines) {
                    Map<String, Object> item = entry.getKey();
                    double w = entry.getValue();
                    long rate = ((Number) item.get("price_per_kg_paise")).longValue();
                    long amount = Math.round(w * rate);
                    String ovReason = item.get("override_reason") != null ? item.get("override_reason").toString() : "";
                    db.exec("INSERT INTO counter_lines(sale_id, item_id, item_name, weight_kg, rate_paise, amount_paise, gst_rate_bp, coffee_pct, override_reason) " +
                                    "VALUES(?,?,?,?,?,?,?,?,?)",
                            sid, item.get("id"), item.get("name"), w, rate, amount, item.get("gst_rate_bp"),
                            !"product".equals(item.get("kind")) ? item.get("coffee_pct") : null, ovReason);
                    deductCounterStock(item, w, sid, u.getId());
                }

                for (Object p : paysIn) {
                    Map<String, Object> payMap = (Map<String, Object>) p;
                    db.exec("INSERT INTO counter_payments(sale_id, method, amount_paise, reference, created_at) VALUES(?,?,?,?,?)",
                            sid, payMap.get("method"), paise(payMap, "amount_paise", false), payMap.getOrDefault("reference", ""), Times.stamp());
                }

                worktasks.bump(u.getId(), "COUNTER", 1, null);
                db.audit(u.getId(), "COUNTER_SALE", "sale:" + sid, billNo + " Rs." + (total / 100.0));

                db.idemSave(u.getId(), "COUNTER_SALE", idemKey, Map.of("id", sid, "bill_no", billNo));
                return bill(sid);
            });
        }
    }

    // --- Refunds ---
    @PostMapping("/counter/sales/{sid}/refunds")
    public Map<String, Object> requestRefund(@PathVariable long sid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.sell");
        Map<String, Object> body = d != null ? d : Map.of();
        long amount = paise(body, "amount_paise", false);
        String reason = ValidationUtils.text(body, "reason", 5, 200, "REASON_REQUIRED");
        String method = body.getOrDefault("method", "CASH").toString();
        if (!METHODS.contains(method)) throw new ApiException("INVALID_PAYMENT_METHOD");

        return db.tx(() -> {
            Map<String, Object> s = db.one("SELECT * FROM counter_sales WHERE id=?", sid);
            if (s == null) throw new ApiException("NOT_FOUND", 404);
            long done = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM counter_refunds WHERE sale_id=? AND state IN ('REQUESTED','APPROVED')", sid);
            long total = ((Number) s.get("total_paise")).longValue();
            if (amount > total - done) throw new ApiException("REFUND_MORE_THAN_BILL");

            long rid = db.insert("INSERT INTO counter_refunds(sale_id, amount_paise, method, reason, state, requested_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?)", sid, amount, method, reason, "REQUESTED", u.getId(), Times.stamp());
            db.audit(u.getId(), "REFUND_REQUESTED", "sale:" + sid, "Rs." + (amount / 100.0) + " " + method + ": " + reason);
            alerts.notifyPerm("counter.refund", "high", "Refund request Rs." + (amount / 100.0) + " on " + s.get("bill_no"),
                    reason, "counter", "sale", sid, null, u.getId());
            return Map.of("id", rid);
        });
    }

    @PostMapping("/counter/refunds/{rid}/decide")
    public Map<String, Object> decideRefund(@PathVariable long rid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.refund");
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = Boolean.TRUE.equals(body.get("approve"));

        return db.tx(() -> {
            Map<String, Object> r = db.one("SELECT * FROM counter_refunds WHERE id=?", rid);
            if (r == null) throw new ApiException("NOT_FOUND", 404);
            if (!"REQUESTED".equals(r.get("state"))) throw new ApiException("ALREADY_DECIDED");
            if (((Number) r.get("requested_by")).longValue() == u.getId()) throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);

            if (approve && !u.isOwner() && !"admin".equals(u.getRoleKey())) {
                Object capObj = db.getSetting("refund_manager_cap_paise");
                if (capObj == null || ((Number) r.get("amount_paise")).longValue() > Long.parseLong(capObj.toString())) {
                    throw new ApiException("ABOVE_YOUR_APPROVAL_LIMIT", 403);
                }
            }

            db.exec("UPDATE counter_refunds SET state=?, decided_by=?, decided_at=? WHERE id=?",
                    approve ? "APPROVED" : "REJECTED", u.getId(), Times.stamp(), rid);

            if (approve) {
                long sid = ((Number) r.get("sale_id")).longValue();
                Map<String, Object> s = db.one("SELECT * FROM counter_sales WHERE id=?", sid);
                long refunded = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM counter_refunds WHERE sale_id=? AND state='APPROVED'", sid);
                long total = ((Number) s.get("total_paise")).longValue();
                db.exec("UPDATE counter_sales SET status=? WHERE id=?", refunded >= total ? "REFUNDED" : "PART_REFUNDED", sid);
            }
            db.audit(u.getId(), "REFUND_" + (approve ? "APPROVED" : "REJECTED"), "sale:" + r.get("sale_id"), "Rs." + (((Number) r.get("amount_paise")).doubleValue() / 100.0));
            return Map.of("ok", true);
        });
    }

    // --- Cash Close ---
    @GetMapping("/counter/cash-close")
    public Map<String, Object> cashCloseStatus(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "counter.close", "counter.close_approve", "counter.reopen_day");
        String day = todayIst();
        String[] bounds = istDayBounds(day);

        Object floatObj = db.getSetting("counter_opening_float_paise");
        Long opening = floatObj != null ? Long.parseLong(floatObj.toString()) : null;

        long cashSales = db.queryForLong("SELECT COALESCE(SUM(p.amount_paise),0) FROM counter_payments p JOIN counter_sales s ON s.id=p.sale_id " +
                "WHERE p.method='CASH' AND s.created_at>=? AND s.created_at<?", bounds[0], bounds[1]);
        long cashRefunds = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM counter_refunds WHERE method='CASH' AND state='APPROVED' " +
                "AND decided_at>=? AND decided_at<?", bounds[0], bounds[1]);

        Long expected = opening != null ? opening + cashSales - cashRefunds : null;

        Map<String, Object> exp = new LinkedHashMap<>();
        exp.put("day", day);
        exp.put("opening_paise", opening);
        exp.put("cash_sales_paise", cashSales);
        exp.put("cash_refunds_paise", cashRefunds);
        exp.put("expected_paise", expected);

        List<Map<String, Object>> closes = db.rows("SELECT k.*, a.full_name submitted_by_name, b.full_name decided_by_name FROM cash_closes k " +
                "JOIN users a ON a.id=k.submitted_by LEFT JOIN users b ON b.id=k.decided_by ORDER BY k.id DESC LIMIT 60");
        Map<String, Object> lock = dayClose(day);

        return Map.of("today", exp, "closes", closes, "closed_today", lock != null ? lock : false);
    }

    private Map<String, Object> customItem(CurrentUser u, Map<String, Object> custom) {
        Object crObj = db.getSetting("custom_coffee_rate_paise");
        Object chObj = db.getSetting("custom_chicory_rate_paise");
        Object chicIdObj = db.getSetting("custom_chicory_product_id");
        if (crObj == null || chObj == null || chicIdObj == null) {
            throw new ApiException("CUSTOM_BLEND_NOT_SET_UP");
        }
        long coffeeRate = Long.parseLong(crObj.toString());
        long chicRate = Long.parseLong(chObj.toString());
        long chicId = Long.parseLong(chicIdObj.toString());
        if (coffeeRate <= 0 || chicRate <= 0 || chicId <= 0) {
            throw new ApiException("CUSTOM_BLEND_NOT_SET_UP");
        }

        double pct = ValidationUtils.number(custom, "coffee_pct", false);
        if (pct < 1 || pct > 100 || pct != Math.round(pct)) {
            throw new ApiException("INVALID_COFFEE_PCT");
        }
        long rate = Math.round((pct / 100.0) * coffeeRate + ((100.0 - pct) / 100.0) * chicRate);
        String reason = "";
        if (custom.get("override_rate_paise") != null && !custom.get("override_rate_paise").toString().isBlank()) {
            permissionService.require(u, "counter.price_override");
            rate = paise(custom, "override_rate_paise", false);
            reason = custom.get("override_reason") != null ? custom.get("override_reason").toString().trim() : "";
            if (reason.length() < 3) {
                throw new ApiException("PRICE_CHANGE_REASON_REQUIRED");
            }
        }
        String name = pct < 100 ? String.format("Custom %d/%d coffee powder", (int) pct, (int) (100 - pct)) : "Custom pure coffee powder";

        Map<String, Object> it = new HashMap<>();
        it.put("id", null);
        it.put("name", name);
        it.put("kind", "coffee_ground");
        it.put("coffee_pct", pct);
        it.put("chicory_product_id", chicId);
        it.put("stock_product_id", null);
        it.put("price_per_kg_paise", rate);
        it.put("gst_rate_bp", null);
        it.put("override_reason", reason);
        return it;
    }

    private Long rememberCustomer(String phone, String name) {
        String p = normPhoneStatic(phone);
        if (p.isEmpty()) return null;
        Map<String, Object> row = db.one("SELECT id, name FROM counter_customers WHERE phone=?", p);
        String now = Times.stamp();
        if (row != null) {
            long id = ((Number) row.get("id")).longValue();
            db.exec("UPDATE counter_customers SET visits=visits+1, last_seen=?, name=CASE WHEN ? != '' THEN ? ELSE name END WHERE id=?",
                    now, name, name, id);
            return id;
        }
        return db.insert("INSERT INTO counter_customers(phone, name, visits, first_seen, last_seen) VALUES(?,?,1,?,?)",
                p, name, now, now);
    }

    private static String normPhoneStatic(Object v) {
        String digits = v != null ? v.toString().replaceAll("\\D", "") : "";
        if (digits.length() == 12 && digits.startsWith("91")) {
            digits = digits.substring(2);
        }
        return (digits.length() >= 10 && digits.length() <= 13) ? digits : "";
    }

    private Map<String, Object> buildRegister(String day) {
        String[] bounds = istDayBounds(day);
        List<Map<String, Object>> bills = db.rows(
                "SELECT s.id, s.bill_no, s.created_at, s.customer_name, s.total_paise, s.discount_paise, s.status, s.reprints, " +
                "u.full_name cashier, " +
                "(SELECT GROUP_CONCAT(CONCAT(item_name, ' ', weight_kg, ' kg') SEPARATOR '; ') FROM counter_lines l WHERE l.sale_id=s.id) items, " +
                "(SELECT GROUP_CONCAT(CONCAT(method, ' ', amount_paise) SEPARATOR '; ') FROM counter_payments p WHERE p.sale_id=s.id) pays " +
                "FROM counter_sales s JOIN users u ON u.id=s.created_by WHERE s.created_at>=? AND s.created_at<? ORDER BY s.id",
                bounds[0], bounds[1]
        );
        Map<String, Long> byMethod = new LinkedHashMap<>();
        for (String m : METHODS) {
            byMethod.put(m, 0L);
        }
        for (Map<String, Object> r : db.rows(
                "SELECT p.method, SUM(p.amount_paise) t FROM counter_payments p JOIN counter_sales s ON s.id=p.sale_id " +
                "WHERE s.created_at>=? AND s.created_at<? GROUP BY p.method", bounds[0], bounds[1])) {
            String m = (String) r.get("method");
            long t = ((Number) r.get("t")).longValue();
            byMethod.put(m, t);
        }
        List<Map<String, Object>> refunds = db.rows(
                "SELECT r.amount_paise, r.method, r.reason, s.bill_no FROM counter_refunds r JOIN counter_sales s " +
                "ON s.id=r.sale_id WHERE r.state='APPROVED' AND r.decided_at>=? AND r.decided_at<?", bounds[0], bounds[1]
        );
        long totalPaise = 0L;
        for (Map<String, Object> b : bills) {
            totalPaise += ((Number) b.get("total_paise")).longValue();
        }
        Map<String, Object> reg = new LinkedHashMap<>();
        reg.put("day", day);
        reg.put("bills", bills);
        reg.put("by_method", byMethod);
        reg.put("refunds", refunds);
        reg.put("bill_count", bills.size());
        reg.put("total_paise", totalPaise);
        reg.put("first_bill", bills.isEmpty() ? null : bills.get(0).get("bill_no"));
        reg.put("last_bill", bills.isEmpty() ? null : bills.get(bills.size() - 1).get("bill_no"));
        return reg;
    }

    @PostMapping("/counter/cash-close")
    public Map<String, Object> submitClose(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.close");
        Map<String, Object> body = d != null ? d : Map.of();
        long counted = paise(body, "counted_paise", true);
        String note = body.containsKey("note") ? String.valueOf(body.get("note")).trim() : "";

        return db.tx(() -> {
            String day = todayIst();
            if (dayClose(day) != null) throw new ApiException("ALREADY_CLOSED_TODAY");

            String[] bounds = istDayBounds(day);
            Object floatObj = db.getSetting("counter_opening_float_paise");
            if (floatObj == null) throw new ApiException("OPENING_CASH_NOT_SET");
            long opening = Long.parseLong(floatObj.toString());

            long cashSales = db.queryForLong("SELECT COALESCE(SUM(p.amount_paise),0) FROM counter_payments p JOIN counter_sales s ON s.id=p.sale_id " +
                    "WHERE p.method='CASH' AND s.created_at>=? AND s.created_at<?", bounds[0], bounds[1]);
            long cashRefunds = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM counter_refunds WHERE method='CASH' AND state='APPROVED' " +
                    "AND decided_at>=? AND decided_at<?", bounds[0], bounds[1]);
            long expected = opening + cashSales - cashRefunds;
            long diff = counted - expected;
            String state = diff == 0 ? "BALANCED" : "VARIANCE_REVIEW";

            if (diff != 0 && note.length() < 5) throw new ApiException("EXPLAIN_THE_DIFFERENCE");

            Map<String, Object> reg = buildRegister(day);
            String regJson = "{}";
            try {
                regJson = mapper.writeValueAsString(reg);
            } catch (Exception e) {}

            long kid = db.insert("INSERT INTO cash_closes(shift_date, opening_paise, cash_sales_paise, cash_refunds_paise, expected_paise, counted_paise, " +
                            "difference_paise, note, state, submitted_by, created_at, bills, total_paise, register) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    day, opening, cashSales, cashRefunds, expected, counted, diff, note, state, u.getId(), Times.stamp(),
                    reg.get("bill_count"), reg.get("total_paise"), regJson);

            db.audit(u.getId(), "COUNTER_DAY_CLOSED", "cash_close:" + kid, "expected Rs." + (expected / 100.0) + ", counted Rs." + (counted / 100.0));
            return Map.of("id", kid, "state", state, "difference_paise", diff);
        });
    }

    @GetMapping("/counter/cash-close/{kid}/register")
    public Map<String, Object> dayRegister(@PathVariable long kid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "counter.close", "counter.close_approve", "counter.reopen_day", "reports.commercial");
        Map<String, Object> k = db.one("SELECT k.*, a.full_name submitted_by_name FROM cash_closes k JOIN users a ON a.id=k.submitted_by WHERE k.id=?", kid);
        if (k == null) throw new ApiException("NOT_FOUND", 404);
        String regJson = (String) k.remove("register");
        Map<String, Object> reg = Map.of();
        try {
            if (regJson != null && !regJson.isBlank()) {
                reg = mapper.readValue(regJson, Map.class);
            }
        } catch (Exception e) {}
        Object cn = db.getSetting("company_name");
        Object ca = db.getSetting("company_address");
        Object cg = db.getSetting("company_gstin");
        Map<String, Object> header = Map.of(
                "company_name", cn != null ? cn.toString() : "Vasavi Trading Company",
                "company_address", ca != null ? ca.toString() : "",
                "company_gstin", cg != null ? cg.toString() : ""
        );
        return Map.of("close", k, "register", reg, "header", header);
    }

    @PostMapping("/counter/cash-close/{kid}/reopen")
    public Map<String, Object> reopenDay(@PathVariable long kid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.reopen_day");
        Map<String, Object> body = d != null ? d : Map.of();
        String reason = ValidationUtils.text(body, "reason", 5, 200, "REASON_REQUIRED");
        return db.tx(() -> {
            Map<String, Object> k = db.one("SELECT * FROM cash_closes WHERE id=?", kid);
            if (k == null) throw new ApiException("NOT_FOUND", 404);
            if (!todayIst().equals(k.get("shift_date"))) throw new ApiException("ONLY_TODAY_CAN_BE_REOPENED");
            String st = (String) k.get("state");
            if ("REJECTED".equals(st) || "REOPENED".equals(st)) throw new ApiException("DAY_IS_NOT_CLOSED");
            db.exec("UPDATE cash_closes SET state='REOPENED', reopened_by=?, reopened_at=?, reopen_reason=? WHERE id=?",
                    u.getId(), Times.stamp(), reason, kid);
            db.audit(u.getId(), "COUNTER_DAY_REOPENED", "cash_close:" + kid, reason);
            alerts.notifyPerm("counter.close", "high", "Counter reopened for today", reason, "counter", u.getId());
            return Map.of("ok", true);
        });
    }

    @PostMapping("/counter/cash-close/{kid}/decide")
    public Map<String, Object> decideClose(@PathVariable long kid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "counter.close_approve");
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = Boolean.TRUE.equals(body.get("approve"));
        String note = ValidationUtils.text(body, "note", 5, 200, "REASON_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> k = db.one("SELECT * FROM cash_closes WHERE id=?", kid);
            if (k == null) throw new ApiException("NOT_FOUND", 404);
            if (!"VARIANCE_REVIEW".equals(k.get("state"))) throw new ApiException("ALREADY_DECIDED");
            if (((Number) k.get("submitted_by")).longValue() == u.getId()) throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);

            db.exec("UPDATE cash_closes SET state=?, decided_by=?, decided_at=?, note=CONCAT(note, ' | ', ?) WHERE id=?",
                    approve ? "ACCEPTED" : "REJECTED", u.getId(), Times.stamp(), note, kid);
            db.audit(u.getId(), "CASH_CLOSE_" + (approve ? "ACCEPTED" : "REJECTED"), "cash_close:" + kid, note);
            return Map.of("ok", true);
        });
    }
}
