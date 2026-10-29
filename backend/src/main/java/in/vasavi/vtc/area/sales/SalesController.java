package in.vasavi.vtc.area.sales;

import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import in.vasavi.vtc.common.*;
import in.vasavi.vtc.db.Db;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class SalesController {

    private static final Map<String, List<String>> FORMS = Map.of(
            "RAW", List.of("RAW"),
            "ROASTED", List.of("ROASTED"),
            "BLENDED", List.of("BLENDED"),
            "GROUND", List.of("GROUND"),
            "PACKED", List.of("PACKED")
    );
    private static final Set<String> MODES = Set.of("RAPIDO", "UBER", "OTHER_APP", "CUSTOMER_PICKUP", "CUSTOMER_VEHICLE", "VTC_DELIVERY");
    private static final Set<String> MONEY_FIELDS = Set.of("price_per_kg_paise", "gst_rate_bp", "advance_paise", "advance_ref", "amount_paise");

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final LedgerService ledger;
    private final AlertsService alerts;
    private final WorktasksService worktasks;
    private final CodesService codes;

    public SalesController(Db db, SessionService sessionService, PermissionService permissionService,
                           LedgerService ledger, AlertsService alerts, WorktasksService worktasks, CodesService codes) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.ledger = ledger;
        this.alerts = alerts;
        this.worktasks = worktasks;
        this.codes = codes;
    }

    private String today() {
        return LocalDate.now(ZoneId.of("Asia/Kolkata")).toString();
    }

    private Map<String, Object> getOrder(long oid) {
        Map<String, Object> o = db.one(
                "SELECT o.*, m.name customer FROM orders o JOIN masters m ON m.id=o.customer_id WHERE o.id=?", oid
        );
        if (o == null) throw new ApiException("NOT_FOUND", 404);
        return o;
    }

    private Map<String, Object> exposure(long customerId) {
        List<Map<String, Object>> inv = db.rows(
                "SELECT i.*, (SELECT COALESCE(SUM(amount_paise),0) FROM collections k WHERE k.invoice_id=i.id " +
                        "AND k.state='VERIFIED') paid FROM invoices i WHERE i.customer_id=? AND i.status!='PAID'", customerId
        );
        long openPaise = 0;
        List<String> overdue = new ArrayList<>();
        String tod = today();
        for (Map<String, Object> i : inv) {
            long tot = ((Number) i.get("total_paise")).longValue();
            long paid = ((Number) i.get("paid")).longValue();
            openPaise += (tot - paid);
            String due = (String) i.get("due_date");
            if (due != null && due.compareTo(tod) < 0 && tot > paid) {
                overdue.add((String) i.get("number"));
            }
        }
        return Map.of("open_paise", openPaise, "overdue", overdue);
    }

    private boolean reserveOrder(Map<String, Object> o, CurrentUser u) {
        long oid = ((Number) o.get("id")).longValue();
        String form = (String) o.get("form");
        List<String> stages = FORMS.getOrDefault(form, List.of("ROASTED"));

        StringBuilder sql = new StringBuilder("SELECT id FROM lots WHERE status='RELEASED' AND owner='VTC' AND location=? AND stage IN (");
        for (int i = 0; i < stages.size(); i++) {
            if (i > 0) sql.append(",");
            sql.append("?");
        }
        sql.append(")");

        List<Object> args = new ArrayList<>();
        args.add(LedgerService.PROD);
        args.addAll(stages);

        if ("RAW".equals(form)) {
            sql.append(" AND product_id=?");
            args.add(o.get("product_id"));
        }
        sql.append(" ORDER BY id");

        double qty = ((Number) o.get("quantity_kg")).doubleValue();
        double disp = o.get("dispatched_kg") != null ? ((Number) o.get("dispatched_kg")).doubleValue() : 0.0;
        double need = ValidationUtils.r3(qty - disp);

        List<Map<String, Object>> plan = new ArrayList<>();
        for (Map<String, Object> lot : db.rows(sql.toString(), args.toArray())) {
            long lid = ((Number) lot.get("id")).longValue();
            double free = ledger.available(lid);
            if (free <= LedgerService.EPS) continue;
            double take = ValidationUtils.r3(Math.min(free, need));
            plan.add(Map.of("id", lid, "kg", take));
            need = ValidationUtils.r3(need - take);
            if (need <= LedgerService.EPS) break;
        }

        if (need > LedgerService.EPS) {
            alerts.notifyPerm("tasks.update_any", "high", "Not enough " + form.toLowerCase() + " stock for order #" + oid,
                    "Short by " + need + " kg. Order stays confirmed; reserve again when stock is ready.", "orders", "order", oid, "short:" + oid, null);
            return false;
        }

        List<String> auditParts = new ArrayList<>();
        for (Map<String, Object> item : plan) {
            long lid = ((Number) item.get("id")).longValue();
            double kg = ((Number) item.get("kg")).doubleValue();
            db.exec("INSERT INTO reservations(order_id, lot_id, kg, state, created_at) VALUES(?,?,?,?,?)",
                    oid, lid, kg, "ACTIVE", Times.stamp());
            auditParts.add("lot #" + lid + ": " + kg + " kg");
        }
        db.exec("UPDATE orders SET state='RESERVED' WHERE id=?", oid);
        db.audit(u.getId(), "STOCK_RESERVED", "order:" + oid, String.join(", ", auditParts));
        return true;
    }

    private Map<String, Object> showOrder(Map<String, Object> o, CurrentUser u) {
        Map<String, Object> copy = new LinkedHashMap<>(o);
        if (!(u.can("documents.commercial") || u.can("outgoing.price_override") || u.can("finance.view"))) {
            for (String f : MONEY_FIELDS) copy.remove(f);
        }
        return copy;
    }

    private record Clearance(boolean ok, String note) {}

    private Clearance cleared(Map<String, Object> o) {
        boolean credit = o.get("credit_requested") instanceof Number n ? n.intValue() == 1 : Boolean.TRUE.equals(o.get("credit_requested"));
        if (credit) {
            String note = (String) o.get("credit_note");
            boolean ok = note != null && (note.startsWith("Within approved") || note.startsWith("Credit approved"));
            return new Clearance(ok, "Credit not approved");
        }
        double qty = ((Number) o.get("quantity_kg")).doubleValue();
        long price = o.get("price_per_kg_paise") != null ? ((Number) o.get("price_per_kg_paise")).longValue() : 0;
        long gst = o.get("gst_rate_bp") != null ? ((Number) o.get("gst_rate_bp")).longValue() : 0;
        long need = Math.round(qty * price * (1.0 + gst / 10000.0));
        long adv = o.get("advance_paise") != null ? ((Number) o.get("advance_paise")).longValue() : 0;
        return new Clearance(adv >= need, "Payment not cleared yet");
    }

    private void refreshInvoice(long iid) {
        Map<String, Object> inv = db.one("SELECT * FROM invoices WHERE id=?", iid);
        if (inv == null) return;
        long total = ((Number) inv.get("total_paise")).longValue();
        long paid = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM collections WHERE invoice_id=? AND state='VERIFIED'", iid);
        String st = paid >= total ? "PAID" : (paid > 0 ? "PART_PAID" : "OPEN");
        db.exec("UPDATE invoices SET status=? WHERE id=?", st, iid);
    }

    // --- Customer Credit Terms ---

    @GetMapping("/customers/credit")
    public List<Map<String, Object>> customersCredit(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "outgoing.credit.approve", "finance.view");

        List<Map<String, Object>> rows = db.rows(
                "SELECT m.id, m.name, t.credit_limit_paise, t.due_days, t.set_at, x.full_name set_by_name FROM masters m " +
                        "LEFT JOIN customer_terms t ON t.customer_id=m.id LEFT JOIN users x ON x.id=t.set_by " +
                        "WHERE m.kind='customer' AND m.state='ACTIVE' ORDER BY m.name"
        );
        for (Map<String, Object> r : rows) {
            long cid = ((Number) r.get("id")).longValue();
            r.putAll(exposure(cid));
        }
        return rows;
    }

    @PutMapping("/customers/{cid}/credit")
    public Map<String, Object> setCreditTerms(@PathVariable long cid,
                                             @RequestBody(required = false) Map<String, Object> d,
                                             HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outgoing.credit.approve");
        Map<String, Object> body = d != null ? d : Map.of();

        long limit = body.get("credit_limit_paise") instanceof Number n ? n.longValue() : 0;
        int days = body.get("due_days") instanceof Number n ? n.intValue() : 0;
        if (limit < 0 || days < 0 || days > 180) throw new ApiException("INVALID_CREDIT_TERMS");

        return db.tx(() -> {
            Map<String, Object> m = db.one("SELECT 1 FROM masters WHERE id=? AND kind='customer'", cid);
            if (m == null) throw new ApiException("NOT_FOUND", 404);

            db.exec("INSERT INTO customer_terms(customer_id, credit_limit_paise, due_days, set_by, set_at) VALUES(?,?,?,?,?) " +
                            "ON DUPLICATE KEY UPDATE credit_limit_paise=VALUES(credit_limit_paise), due_days=VALUES(due_days), set_by=VALUES(set_by), set_at=VALUES(set_at)",
                    cid, limit, days, u.getId(), Times.stamp());
            db.audit(u.getId(), "CREDIT_TERMS_SET", "customer:" + cid, "limit Rs." + (limit / 100.0) + ", " + days + " days", "access");
            return Map.of("ok", true);
        });
    }

    // --- Orders ---

    @GetMapping("/orders")
    public List<Map<String, Object>> orders(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "outgoing.view", "dispatch.handover");

        List<Map<String, Object>> rows = db.rows(
                "SELECT o.*, m.name customer, m.address customer_address, m.phone customer_phone, x.full_name created_by_name, " +
                        "(SELECT COALESCE(SUM(kg),0) FROM reservations r WHERE r.order_id=o.id AND r.state='ACTIVE') reserved_kg " +
                        "FROM orders o JOIN masters m ON m.id=o.customer_id JOIN users x ON x.id=o.created_by ORDER BY o.id DESC"
        );
        List<Map<String, Object>> dispatches = db.rows(
                "SELECT d.*, x.full_name handed_by_name FROM dispatches d JOIN users x ON x.id=d.handed_by ORDER BY d.id"
        );
        List<Map<String, Object>> invoices = db.rows("SELECT id, number, order_id, total_paise, status, due_date FROM invoices");

        String restRaw = db.getSetting("roast_rest_days") != null ? db.getSetting("roast_rest_days").toString() : "13";
        int rest = Integer.parseInt(restRaw);
        String tod = today();

        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> o : rows) {
            long oid = ((Number) o.get("id")).longValue();

            List<Map<String, Object>> myDisp = new ArrayList<>();
            for (Map<String, Object> d : dispatches) {
                if (((Number) d.get("order_id")).longValue() == oid) myDisp.add(d);
            }
            o.put("dispatches", myDisp);

            List<Map<String, Object>> myInv = new ArrayList<>();
            if (u.can("documents.commercial") || u.can("finance.view")) {
                for (Map<String, Object> inv : invoices) {
                    if (((Number) inv.get("order_id")).longValue() == oid) myInv.add(inv);
                }
            }
            o.put("invoices", myInv);

            if (o.get("price_per_kg_paise") != null) {
                Clearance cl = cleared(o);
                o.put("cleared", cl.ok());
                boolean credit = o.get("credit_requested") instanceof Number n ? n.intValue() == 1 : Boolean.TRUE.equals(o.get("credit_requested"));
                o.put("clearance_note", cl.ok() ? (credit ? "Credit approved" : "Payment received") : cl.note());
            } else {
                o.put("cleared", false);
                o.put("clearance_note", "Price not set");
            }

            // check resting
            o.put("resting_until", orderResting(oid));

            if (!u.can("customer.contacts")) o.remove("customer_phone");
            if (!u.can("dispatch.handover") && !u.can("customer.contacts")) o.remove("customer_address");

            out.add(showOrder(o, u));
        }
        return out;
    }

    @PostMapping("/orders")
    public Map<String, Object> orderCreate(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outgoing.create");
        Map<String, Object> body = d != null ? d : Map.of();

        String item = ValidationUtils.text(body, "item", 2, 120, "INVALID_ITEM");
        double kg = ValidationUtils.r3(ValidationUtils.number(body, "quantity_kg", true));
        boolean credit = Boolean.TRUE.equals(body.get("credit_requested"));
        if (credit) permissionService.require(u, "outgoing.credit.request");

        String form = (String) body.getOrDefault("form", "ROASTED");
        if (!FORMS.containsKey(form)) throw new ApiException("INVALID_FORM");

        Object priceObj = body.get("price_per_kg_paise");
        Object gstObj = body.get("gst_rate_bp");
        if (priceObj != null || gstObj != null) {
            permissionService.require(u, "outgoing.price_override");
        }

        Long price = priceObj instanceof Number n ? n.longValue() : null;
        Long gst = gstObj instanceof Number n ? n.longValue() : null;
        long cid = ((Number) body.getOrDefault("customer_id", 0)).longValue();

        return db.tx(() -> {
            Map<String, Object> cust = db.one("SELECT 1 FROM masters WHERE id=? AND kind='customer' AND state='ACTIVE'", cid);
            if (cust == null) throw new ApiException("ACTIVE_CUSTOMER_REQUIRED");

            Long pid = body.get("product_id") instanceof Number n ? n.longValue() : null;
            if ("RAW".equals(form) && pid == null) throw new ApiException("CHOOSE_THE_RAW_COFFEE");

            String notes = body.containsKey("notes") ? String.valueOf(body.get("notes")) : "";
            if (notes.length() > 300) notes = notes.substring(0, 300);

            long oid = db.insert(
                    "INSERT INTO orders(customer_id, item, quantity_kg, credit_requested, state, created_by, created_at, form, product_id, " +
                            "price_per_kg_paise, gst_rate_bp, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    cid, item, kg, credit ? 1 : 0, "DRAFT", u.getId(), Times.stamp(), form, pid, price, gst, notes
            );
            db.audit(u.getId(), "ORDER_DRAFT_CREATED", "order:" + oid, kg + " kg " + form.toLowerCase() + " " + item);
            return Map.of("id", oid);
        });
    }

    @PutMapping("/orders/{oid}/price")
    public Map<String, Object> setOrderPrice(@PathVariable long oid,
                                            @RequestBody(required = false) Map<String, Object> d,
                                            HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outgoing.price_override");
        Map<String, Object> body = d != null ? d : Map.of();

        long price = body.get("price_per_kg_paise") instanceof Number n ? n.longValue() : 0;
        Long gst = body.get("gst_rate_bp") instanceof Number n ? n.longValue() : null;
        if (price <= 0) throw new ApiException("INVALID_PRICE");

        return db.tx(() -> {
            Map<String, Object> o = getOrder(oid);
            String st = (String) o.get("state");
            if (!Set.of("DRAFT", "CREDIT_REVIEW", "CONFIRMED", "RESERVED").contains(st)) {
                throw new ApiException("ORDER_ALREADY_DISPATCHED");
            }
            db.exec("UPDATE orders SET price_per_kg_paise=?, gst_rate_bp=? WHERE id=?", price, gst, oid);
            db.audit(u.getId(), "ORDER_PRICE_SET", "order:" + oid, "Rs." + (price / 100.0) + "/kg, GST " + (gst != null ? gst : "not set") + " bp");
            return Map.of("ok", true);
        });
    }

    @PostMapping("/orders/{oid}/confirm")
    public Map<String, Object> confirmOrder(@PathVariable long oid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outgoing.create");

        return db.tx(() -> {
            Map<String, Object> o = getOrder(oid);
            if (!"DRAFT".equals(o.get("state"))) throw new ApiException("ORDER_NOT_DRAFT");
            if (o.get("price_per_kg_paise") == null) throw new ApiException("PRICE_NOT_SET");

            boolean credit = o.get("credit_requested") instanceof Number n ? n.intValue() == 1 : Boolean.TRUE.equals(o.get("credit_requested"));
            String state = "CONFIRMED";
            String note = "";

            if (credit) {
                long cid = ((Number) o.get("customer_id")).longValue();
                Map<String, Object> terms = db.one("SELECT * FROM customer_terms WHERE customer_id=?", cid);
                Map<String, Object> exp = exposure(cid);
                List<?> overdue = (List<?>) exp.get("overdue");
                long openPaise = ((Number) exp.get("open_paise")).longValue();

                double qty = ((Number) o.get("quantity_kg")).doubleValue();
                long price = ((Number) o.get("price_per_kg_paise")).longValue();
                long gst = o.get("gst_rate_bp") != null ? ((Number) o.get("gst_rate_bp")).longValue() : 0;
                long amount = Math.round(qty * price * (1.0 + gst / 10000.0));

                if (terms == null) {
                    state = "CREDIT_REVIEW";
                    note = "No approved credit terms for this customer";
                } else if (!overdue.isEmpty()) {
                    state = "CREDIT_REVIEW";
                    note = "Customer has overdue invoices: " + String.join(", ", (List<String>) overdue);
                } else {
                    long limit = ((Number) terms.get("credit_limit_paise")).longValue();
                    if (openPaise + amount > limit) {
                        state = "CREDIT_REVIEW";
                        note = String.format("Would exceed limit (Rs.%.2f of Rs.%.2f)", (openPaise + amount) / 100.0, limit / 100.0);
                    } else {
                        note = "Within approved credit terms";
                    }
                }
            }

            db.exec("UPDATE orders SET state=?, credit_note=? WHERE id=?", state, note, oid);
            worktasks.bump(u.getId(), "ORDERS", 1, null);
            db.audit(u.getId(), "CONFIRMED".equals(state) ? "ORDER_CONFIRMED" : "ORDER_CREDIT_HOLD", "order:" + oid, note);

            if ("CREDIT_REVIEW".equals(state)) {
                alerts.notifyPerm("outgoing.credit.approve", "high", "Credit decision needed — order #" + oid + " (" + o.get("customer") + ")",
                        note, "orders", "order", oid, null, u.getId());
            } else if (reserveOrder(getOrder(oid), u)) {
                state = "RESERVED";
            }

            return Map.of("ok", true, "state", state, "note", note);
        });
    }

    @PostMapping("/orders/{oid}/credit")
    public Map<String, Object> creditDecision(@PathVariable long oid,
                                              @RequestBody(required = false) Map<String, Object> d,
                                              HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outgoing.credit.approve");
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = Boolean.TRUE.equals(body.get("approve"));
        String note = ValidationUtils.text(body, "note", 5, 200, "REASON_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> o = getOrder(oid);
            if (!"CREDIT_REVIEW".equals(o.get("state"))) throw new ApiException("NOT_WAITING_FOR_CREDIT");
            if (((Number) o.get("created_by")).longValue() == u.getId()) {
                throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);
            }

            String fullNote = (approve ? "Credit approved: " : "Credit refused: ") + note;
            db.exec("UPDATE orders SET state=?, credit_decided_by=?, credit_note=? WHERE id=?",
                    approve ? "CONFIRMED" : "CANCELLED", u.getId(), fullNote, oid);
            db.audit(u.getId(), "CREDIT_" + (approve ? "APPROVED" : "REFUSED"), "order:" + oid, note);
            alerts.notify(List.of(((Number) o.get("created_by")).longValue()), "normal",
                    "Order #" + oid + " credit " + (approve ? "approved" : "refused"), note, "orders", "order", oid, null, null);

            if (approve) {
                reserveOrder(getOrder(oid), u);
            }
            return Map.of("ok", true);
        });
    }

    @PostMapping("/orders/{oid}/reserve")
    public Map<String, Object> reserveAgain(@PathVariable long oid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "outgoing.create", "dispatch.handover");

        return db.tx(() -> {
            Map<String, Object> o = getOrder(oid);
            if (!"CONFIRMED".equals(o.get("state"))) throw new ApiException("ORDER_NOT_WAITING_FOR_STOCK");
            if (!reserveOrder(o, u)) throw new ApiException("NOT_ENOUGH_STOCK_TO_RESERVE");
            return Map.of("ok", true);
        });
    }

    @PostMapping("/orders/{oid}/cancel")
    public Map<String, Object> cancelOrder(@PathVariable long oid,
                                           @RequestBody(required = false) Map<String, Object> d,
                                           HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outgoing.create");
        Map<String, Object> body = d != null ? d : Map.of();
        String reason = ValidationUtils.text(body, "reason", 5, 200, "REASON_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> o = getOrder(oid);
            String st = (String) o.get("state");
            double disp = o.get("dispatched_kg") != null ? ((Number) o.get("dispatched_kg")).doubleValue() : 0.0;
            if (!Set.of("DRAFT", "CREDIT_REVIEW", "CONFIRMED", "RESERVED").contains(st) || disp > 0) {
                throw new ApiException("CANNOT_CANCEL_AFTER_DISPATCH");
            }
            db.exec("UPDATE reservations SET state='RELEASED' WHERE order_id=? AND state='ACTIVE'", oid);
            String existingNotes = (String) o.get("notes");
            String newNotes = (existingNotes != null ? existingNotes : "") + " | Cancelled: " + reason;
            db.exec("UPDATE orders SET state='CANCELLED', notes=? WHERE id=?", newNotes, oid);
            db.audit(u.getId(), "ORDER_CANCELLED", "order:" + oid, reason);
            return Map.of("ok", true);
        });
    }

    @PostMapping("/orders/{oid}/advance")
    public Map<String, Object> recordAdvance(@PathVariable long oid,
                                             @RequestBody(required = false) Map<String, Object> d,
                                             HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.collection.verify");
        Map<String, Object> body = d != null ? d : Map.of();
        long amount = body.get("amount_paise") instanceof Number n ? n.longValue() : 0;
        String ref = ValidationUtils.text(body, "reference", 3, 60, "REFERENCE_REQUIRED");
        if (amount <= 0) throw new ApiException("INVALID_AMOUNT");

        return db.tx(() -> {
            getOrder(oid);
            db.exec("UPDATE orders SET advance_paise=COALESCE(advance_paise,0)+?, advance_ref=? WHERE id=?", amount, ref, oid);
            db.audit(u.getId(), "ADVANCE_VERIFIED", "order:" + oid, "Rs." + (amount / 100.0) + " ref " + ref);
            return Map.of("ok", true);
        });
    }

    @PostMapping("/orders/{oid}/dispatch")
    public Map<String, Object> dispatchOrder(@PathVariable long oid,
                                             @RequestBody(required = false) Map<String, Object> d,
                                             @RequestHeader(value = "X-Idempotency-Key", required = false) String idemKey,
                                             HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "dispatch.handover");
        Map<String, Object> body = d != null ? d : Map.of();

        double kg = ValidationUtils.r3(ValidationUtils.number(body, "kg", true));
        String mode = (String) body.get("mode");
        if (!MODES.contains(mode)) throw new ApiException("INVALID_DELIVERY_MODE");

        String handover = ValidationUtils.text(body, "handover_to", 2, 80, "HANDOVER_PERSON_REQUIRED");
        String booking = body.containsKey("booking_ref") ? String.valueOf(body.get("booking_ref")).trim() : "";
        if (booking.length() > 60) booking = booking.substring(0, 60);

        if (Set.of("RAPIDO", "UBER", "OTHER_APP").contains(mode) && booking.isEmpty()) {
            throw new ApiException("BOOKING_REFERENCE_REQUIRED");
        }

        final String finalBooking = booking;
        return db.tx(() -> {
            Map<String, Object> prev = db.idemGet(u.getId(), "DISPATCH", idemKey);
            if (prev != null) return prev;

            Map<String, Object> o = getOrder(oid);
            if (!"RESERVED".equals(o.get("state"))) throw new ApiException("ORDER_NOT_READY");

            Clearance cl = cleared(o);
            if (!cl.ok()) {
                boolean credit = o.get("credit_requested") instanceof Number n ? n.intValue() == 1 : Boolean.TRUE.equals(o.get("credit_requested"));
                throw new ApiException("DISPATCH_BLOCKED_" + (credit ? "CREDIT" : "PAYMENT"));
            }

            double totalQty = ((Number) o.get("quantity_kg")).doubleValue();
            double alreadyDisp = o.get("dispatched_kg") != null ? ((Number) o.get("dispatched_kg")).doubleValue() : 0.0;
            if (kg > ValidationUtils.r3(totalQty - alreadyDisp) + LedgerService.EPS) {
                throw new ApiException("MORE_THAN_ORDERED");
            }

            String resting = orderResting(oid);
            boolean restOk = Boolean.TRUE.equals(body.get("rest_ok")) || "true".equalsIgnoreCase(String.valueOf(body.get("rest_ok")));
            if (resting != null && !restOk) {
                throw new ApiException("COFFEE_STILL_RESTING");
            }
            if (resting != null) {
                db.audit(u.getId(), "DISPATCHED_BEFORE_REST", "order:" + oid, "ready from " + resting + "; customer agreed");
            }

            long did = db.insert(
                    "INSERT INTO dispatches(order_id, mode, booking_ref, handover_to, evidence, kg, handed_by, created_at) " +
                            "VALUES(?,?,?,?,?,?,?,?)",
                    oid, mode, finalBooking, handover, body.getOrDefault("evidence", ""), kg, u.getId(), Times.stamp()
            );

            double need = kg;
            for (Map<String, Object> r : db.rows("SELECT * FROM reservations WHERE order_id=? AND state='ACTIVE' ORDER BY id", oid)) {
                if (need <= LedgerService.EPS) break;
                long rid = ((Number) r.get("id")).longValue();
                long lotId = ((Number) r.get("lot_id")).longValue();
                double resKg = ((Number) r.get("kg")).doubleValue();

                double take = ValidationUtils.r3(Math.min(resKg, need));
                ledger.consume(lotId, take, "DISPATCHED_TO_CUSTOMER", did, u.getId(), null, null, "VTC", oid);
                double left = ValidationUtils.r3(resKg - take);
                db.exec("UPDATE reservations SET kg=?, state=? WHERE id=?", left, left > LedgerService.EPS ? "ACTIVE" : "CONSUMED", rid);
                need = ValidationUtils.r3(need - take);
            }
            if (need > LedgerService.EPS) throw new ApiException("RESERVED_STOCK_SHORT");

            double done = ValidationUtils.r3(alreadyDisp + kg);
            String state = done >= totalQty - LedgerService.EPS ? "DISPATCHED" : "RESERVED";
            if ("DISPATCHED".equals(state)) {
                db.exec("UPDATE reservations SET state='RELEASED' WHERE order_id=? AND state='ACTIVE'", oid);
            }

            long price = ((Number) o.get("price_per_kg_paise")).longValue();
            long gstBp = o.get("gst_rate_bp") != null ? ((Number) o.get("gst_rate_bp")).longValue() : 0;
            long taxable = Math.round(kg * price);
            long gst = Math.round(taxable * gstBp / 10000.0);
            long grandTotal = taxable + gst;

            long cid = ((Number) o.get("customer_id")).longValue();
            Map<String, Object> terms = db.one("SELECT due_days FROM customer_terms WHERE customer_id=?", cid);
            int dueDays = 0;
            boolean credit = o.get("credit_requested") instanceof Number n ? n.intValue() == 1 : Boolean.TRUE.equals(o.get("credit_requested"));
            if (terms != null && credit) {
                dueDays = ((Number) terms.get("due_days")).intValue();
            }
            String dueDate = LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(dueDays).toString();

            String pfx = (String) db.getSetting("invoice_prefix");
            String invoiceNum = codes.nextCode("invoices", "number", pfx != null ? pfx : "INV");

            long iid = db.insert(
                    "INSERT INTO invoices(number, order_id, customer_id, taxable_paise, gst_paise, total_paise, due_date, status, created_by, created_at) " +
                            "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    invoiceNum, oid, cid, taxable, gst, grandTotal, dueDate, "OPEN", u.getId(), Times.stamp()
            );

            long advance = o.get("advance_paise") != null ? ((Number) o.get("advance_paise")).longValue() : 0;
            if (!credit && advance > 0) {
                long alreadyUsed = db.queryForLong("SELECT COALESCE(SUM(k.amount_paise),0) FROM collections k JOIN invoices i ON i.id=k.invoice_id WHERE i.order_id=? AND k.method='ADVANCE'", oid);
                long use = Math.min(grandTotal, advance - alreadyUsed);
                if (use > 0) {
                    db.insert("INSERT INTO collections(invoice_id, amount_paise, method, reference, state, recorded_by, verified_by, created_at, verified_at) " +
                            "VALUES(?,?,?,?,?,?,?,?,?)", iid, use, "ADVANCE", o.get("advance_ref"), "VERIFIED", u.getId(), u.getId(), Times.stamp(), Times.stamp());
                    refreshInvoice(iid);
                }
            }

            db.exec("UPDATE orders SET dispatched_kg=?, state=?, invoice_id=? WHERE id=?", done, state, iid, oid);
            worktasks.bump(u.getId(), "DISPATCH", 1, oid);
            db.audit(u.getId(), "DISPATCHED", "order:" + oid, kg + " kg via " + mode + " to " + handover + "; invoice " + invoiceNum);

            Map<String, Object> res = Map.of("id", did, "invoice", invoiceNum, "state", state);
            db.idemSave(u.getId(), "DISPATCH", idemKey, res);
            return res;
        });
    }

    @PostMapping("/dispatches/{did}/deliver")
    public Map<String, Object> deliverDispatch(@PathVariable long did,
                                               @RequestBody(required = false) Map<String, Object> d,
                                               HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "dispatch.handover");
        Map<String, Object> body = d != null ? d : Map.of();

        double got = ValidationUtils.r3(ValidationUtils.number(body, "delivered_kg", false));
        String note = ValidationUtils.text(body, "pod_note", 3, 200, "PROOF_OF_DELIVERY_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> x = db.one("SELECT * FROM dispatches WHERE id=?", did);
            if (x == null) throw new ApiException("NOT_FOUND", 404);
            if (x.get("delivered_at") != null) throw new ApiException("ALREADY_CONFIRMED");

            double sentKg = ((Number) x.get("kg")).doubleValue();
            if (got > sentKg + LedgerService.EPS) throw new ApiException("DELIVERED_MORE_THAN_SENT");

            db.exec("UPDATE dispatches SET delivered_kg=?, pod_note=?, delivered_at=?, confirmed_by=? WHERE id=?",
                    got, note, Times.stamp(), u.getId(), did);

            long oid = ((Number) x.get("order_id")).longValue();
            Map<String, Object> o = getOrder(oid);

            if (got < sentKg - LedgerService.EPS) {
                alerts.notifyPerm("tasks.update_any", "high", "Order #" + oid + ": " + ValidationUtils.r3(sentKg - got) + " kg not delivered",
                        note, "exceptions", "order", oid, null, null);
            }

            long pending = db.queryForLong("SELECT COUNT(*) FROM dispatches WHERE order_id=? AND delivered_at IS NULL", oid);
            if ("DISPATCHED".equals(o.get("state")) && pending == 0) {
                db.exec("UPDATE orders SET state='DELIVERED' WHERE id=?", oid);
            }

            db.audit(u.getId(), "DELIVERY_CONFIRMED", "order:" + oid, got + " of " + sentKg + " kg: " + note);
            return Map.of("ok", true);
        });
    }

    @GetMapping("/orders/{oid}/slip")
    public Map<String, Object> dispatchSlip(@PathVariable long oid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "documents.price_hidden", "dispatch.handover");

        Map<String, Object> o = getOrder(oid);
        List<Map<String, Object>> lots = db.rows(
                "SELECT r.kg, r.state, l.id lot_id, l.name FROM reservations r JOIN lots l ON l.id=r.lot_id WHERE r.order_id=?", oid
        );
        Map<String, Object> st = db.allSettings();

        Map<String, Object> orderFiltered = new LinkedHashMap<>();
        for (String k : List.of("id", "customer", "item", "quantity_kg", "form", "dispatched_kg", "state", "notes")) {
            orderFiltered.put(k, o.get(k));
        }

        return Map.of("company", st.getOrDefault("company_name", "Vasavi Trading Company"),
                "order", orderFiltered,
                "lots", lots);
    }

    @GetMapping("/invoices")
    public List<Map<String, Object>> listInvoices(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "documents.commercial", "finance.view");
        return db.rows("SELECT i.*, m.name customer, o.item FROM invoices i JOIN masters m ON m.id=i.customer_id JOIN orders o ON o.id=i.order_id ORDER BY i.id DESC");
    }

    @GetMapping("/invoices/{iid}")
    public Map<String, Object> invoiceDetail(@PathVariable long iid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "documents.commercial", "finance.view");

        Map<String, Object> i = db.one(
                "SELECT i.*, m.name customer, o.item, o.form, o.price_per_kg_paise, o.gst_rate_bp FROM invoices i " +
                        "JOIN masters m ON m.id=i.customer_id JOIN orders o ON o.id=i.order_id WHERE i.id=?", iid
        );
        if (i == null) throw new ApiException("NOT_FOUND", 404);

        Map<String, Object> out = new LinkedHashMap<>(i);
        out.put("collections", db.rows("SELECT * FROM collections WHERE invoice_id=? ORDER BY id", iid));

        Map<String, Object> st = db.allSettings();
        Map<String, Object> header = new LinkedHashMap<>();
        for (String k : List.of("company_name", "company_address", "company_gstin", "tax_setup_approved")) {
            header.put(k, st.get(k));
        }
        out.put("header", header);
        return out;
    }

    private String orderResting(long oid) {
        Object restObj = db.getSetting("roast_rest_days");
        int rest = restObj != null ? ((Number) restObj).intValue() : 0;
        if (rest <= 0) return null;
        String tod = Times.isoDayIst();
        String maxReady = null;
        for (Map<String, Object> res : db.rows("SELECT l.roasted_on FROM reservations r JOIN lots l ON l.id=r.lot_id WHERE r.order_id=? AND r.state='ACTIVE' AND l.roasted_on IS NOT NULL", oid)) {
            String ro = (String) res.get("roasted_on");
            if (ro != null && !ro.isBlank()) {
                try {
                    String ready = LocalDate.parse(ro).plusDays(rest).toString();
                    if (ready.compareTo(tod) > 0 && (maxReady == null || ready.compareTo(maxReady) > 0)) {
                        maxReady = ready;
                    }
                } catch (Exception ignored) {}
            }
        }
        return maxReady;
    }
}
