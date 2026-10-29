package in.vasavi.vtc.area.finance;

import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import in.vasavi.vtc.common.AlertsService;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.CodesService;
import in.vasavi.vtc.common.LedgerService;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.common.WorktasksService;
import in.vasavi.vtc.db.Db;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class FinanceController {

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final LedgerService ledger;
    private final AlertsService alerts;
    private final WorktasksService worktasks;
    private final CodesService codes;

    public FinanceController(Db db, SessionService sessionService, PermissionService permissionService,
                             LedgerService ledger, AlertsService alerts, WorktasksService worktasks, CodesService codes) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.ledger = ledger;
        this.alerts = alerts;
        this.worktasks = worktasks;
        this.codes = codes;
    }

    // --- Supplier Payables ---

    @GetMapping("/payables")
    public Map<String, Object> payables(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.view");

        List<Map<String, Object>> rows = db.rows(
                "SELECT r.id, r.code, r.source, r.source_name, m.name product, r.bags, r.nominal_kg, r.created_at, " +
                        "r.invoice_ref, r.invoice_status, r.invoice_amount_paise, " +
                        "(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payments p WHERE p.receipt_id=r.id AND p.state='APPROVED') paid_paise, " +
                        "r.payment_status FROM receipts r JOIN masters m ON m.id=r.product_id ORDER BY r.id DESC"
        );

        List<Map<String, Object>> pays = db.rows(
                "SELECT p.*, x.full_name recorded_by_name, y.full_name approved_by_name FROM supplier_payments p " +
                        "JOIN users x ON x.id=p.recorded_by LEFT JOIN users y ON y.id=p.approved_by ORDER BY p.id DESC"
        );

        boolean seeAmount = u.can("supplier.pay.amount");
        boolean seeProof = u.can("supplier.pay.proof");
        boolean seeCost = u.can("invoice.cost");
        boolean seeStatus = u.can("supplier.pay.status");

        for (Map<String, Object> r : rows) {
            if (!seeCost) r.remove("invoice_amount_paise");
            if (!seeAmount) r.remove("paid_paise");
            if (!seeStatus) r.remove("payment_status");
        }
        for (Map<String, Object> p : pays) {
            if (!seeAmount) p.remove("amount_paise");
            if (!seeProof) p.remove("reference");
        }

        return Map.of("receipts", rows, "payments", pays);
    }

    @PostMapping("/receipts/{rid}/payments")
    public Map<String, Object> recordSupplierPayment(@PathVariable long rid,
                                                     @RequestBody(required = false) Map<String, Object> d,
                                                     HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "supplier.pay.record");
        Map<String, Object> body = d != null ? d : Map.of();

        long amount = body.get("amount_paise") instanceof Number n ? n.longValue() : 0;
        if (amount <= 0) throw new ApiException("INVALID_AMOUNT");

        String paidOn = body.containsKey("paid_on") ? String.valueOf(body.get("paid_on")).trim() : "";
        if (paidOn.length() > 10) paidOn = paidOn.substring(0, 10);
        try {
            LocalDate.parse(paidOn);
        } catch (Exception e) {
            throw new ApiException("PAYMENT_DATE_REQUIRED");
        }

        String rawRef = body.containsKey("reference") ? String.valueOf(body.get("reference")).trim() : "";
        final String ref = rawRef.length() > 60 ? rawRef.substring(0, 60) : rawRef;
        final String finalPaidOn = paidOn;

        return db.tx(() -> {
            Map<String, Object> rec = db.one("SELECT 1 FROM receipts WHERE id=?", rid);
            if (rec == null) throw new ApiException("NOT_FOUND", 404);

            long pid = db.insert("INSERT INTO supplier_payments(receipt_id, amount_paise, reference, paid_on, state, recorded_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?)", rid, amount, ref, finalPaidOn, "PENDING_APPROVAL", u.getId(), Times.stamp());
            db.audit(u.getId(), "SUPPLIER_PAYMENT_RECORDED", "receipt:" + rid, "payment #" + pid + " dated " + finalPaidOn);
            alerts.notifyPerm("supplier.pay.approve", "high", "Supplier payment to approve (receipt #" + rid + ")",
                    "", "finance", "receipt", rid, null, u.getId());
            return Map.of("id", pid);
        });
    }

    @PostMapping("/supplier-payments/{pid}/decide")
    public Map<String, Object> decideSupplierPayment(@PathVariable long pid,
                                                     @RequestBody(required = false) Map<String, Object> d,
                                                     HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "supplier.pay.approve");
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = Boolean.TRUE.equals(body.get("approve"));

        return db.tx(() -> {
            Map<String, Object> p = db.one("SELECT * FROM supplier_payments WHERE id=?", pid);
            if (p == null) throw new ApiException("NOT_FOUND", 404);
            if (!"PENDING_APPROVAL".equals(p.get("state"))) throw new ApiException("ALREADY_DECIDED");
            if (((Number) p.get("recorded_by")).longValue() == u.getId()) {
                throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);
            }

            db.exec("UPDATE supplier_payments SET state=?, approved_by=?, decided_at=? WHERE id=?",
                    approve ? "APPROVED" : "REJECTED", u.getId(), Times.stamp(), pid);

            if (approve) {
                long rid = ((Number) p.get("receipt_id")).longValue();
                Map<String, Object> r = db.one("SELECT * FROM receipts WHERE id=?", rid);
                long paid = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payments WHERE receipt_id=? AND state='APPROVED'", rid);
                Long invAmt = r.get("invoice_amount_paise") != null ? ((Number) r.get("invoice_amount_paise")).longValue() : null;
                boolean full = invAmt != null && paid >= invAmt;
                db.exec("UPDATE receipts SET payment_status=?, payment_date=? WHERE id=?",
                        full ? "PAID" : "PARTIAL", p.get("paid_on"), rid);
            }

            db.audit(u.getId(), "SUPPLIER_PAYMENT_" + (approve ? "APPROVED" : "REJECTED"),
                    "receipt:" + p.get("receipt_id"), "payment #" + pid);
            return Map.of("ok", true);
        });
    }

    // --- Physical Stock Counts & Adjustments ---

    @GetMapping("/counts")
    public List<Map<String, Object>> counts(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "stock.cycle_count", "stock.cycle_approve", "inventory.adjust", "inventory.approve_adjust");
        return db.rows("SELECT k.*, l.name lot_name, l.code lot_code, x.full_name counted_by_name, y.full_name decided_by_name FROM cycle_counts k " +
                "JOIN lots l ON l.id=k.lot_id JOIN users x ON x.id=k.counted_by LEFT JOIN users y ON y.id=k.decided_by " +
                "ORDER BY k.id DESC LIMIT 100");
    }

    @PostMapping("/lots/{lid}/count")
    public Map<String, Object> countLot(@PathVariable long lid,
                                        @RequestBody(required = false) Map<String, Object> d,
                                        HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "stock.cycle_count");
        Map<String, Object> body = d != null ? d : Map.of();
        double counted = ValidationUtils.r3(ValidationUtils.number(body, "counted_kg", false));
        String rawNote = body.containsKey("note") ? String.valueOf(body.get("note")).trim() : "";
        final String note = rawNote.length() > 200 ? rawNote.substring(0, 200) : rawNote;

        return db.tx(() -> {
            Map<String, Object> lot = ledger.lot(lid);
            if (db.queryForLong("SELECT COUNT(*) FROM cycle_counts WHERE lot_id=? AND state='PENDING'", lid) > 0) {
                throw new ApiException("COUNT_ALREADY_PENDING");
            }
            double book = ledger.balance(lid);
            double var = ValidationUtils.r3(counted - book);
            String state = Math.abs(var) <= LedgerService.EPS ? "MATCHED" : "PENDING";
            long kid = db.insert("INSERT INTO cycle_counts(lot_id, book_kg, counted_kg, variance_kg, note, state, counted_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?,?)", lid, book, counted, var, note, state, u.getId(), Times.stamp());
            worktasks.bump(u.getId(), "COUNT", 1, null);
            db.audit(u.getId(), "STOCK_COUNTED", "lot:" + lid, "book " + book + " kg, counted " + counted + " kg");
            if ("PENDING".equals(state)) {
                alerts.notifyPerm("stock.cycle_approve", "high", "Stock count difference " + (var >= 0 ? "+" : "") + var + " kg on lot #" + lid,
                        (String) lot.get("name"), "exceptions", "lot", lid, null, u.getId());
            }
            return Map.of("id", kid, "state", state, "variance_kg", var);
        });
    }

    @PostMapping("/lots/{lid}/adjust")
    public Map<String, Object> requestAdjustment(@PathVariable long lid,
                                                 @RequestBody(required = false) Map<String, Object> d,
                                                 HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "inventory.adjust");
        Map<String, Object> body = d != null ? d : Map.of();
        double delta = ValidationUtils.r3(ValidationUtils.number(body, "delta_kg", false));
        String rawReason = ValidationUtils.text(body, "reason", 5, 200, "REASON_REQUIRED");
        if (Math.abs(delta) <= LedgerService.EPS) throw new ApiException("INVALID_DELTA_KG");

        return db.tx(() -> {
            Map<String, Object> lot = ledger.lot(lid);
            String status = (String) lot.get("status");
            if (!"RELEASED".equals(status) && !"QC_HOLD".equals(status) && !"QUARANTINE".equals(status)) {
                throw new ApiException("LOT_CANNOT_BE_CORRECTED");
            }
            double book = ledger.balance(lid);
            if (book + delta < -LedgerService.EPS) {
                throw new ApiException("CORRECTION_WOULD_GO_NEGATIVE");
            }
            long kid = db.insert("INSERT INTO cycle_counts(lot_id, book_kg, counted_kg, variance_kg, note, state, counted_by, created_at, kind) " +
                    "VALUES(?,?,?,?,?,?,?,?,?)", lid, book, ValidationUtils.r3(book + delta), delta, rawReason, "PENDING", u.getId(), Times.stamp(), "ADJUST");
            db.audit(u.getId(), "STOCK_CORRECTION_REQUESTED", "lot:" + lid, (delta >= 0 ? "+" : "") + delta + " kg: " + rawReason);
            alerts.notifyPerm("inventory.approve_adjust", "high", "Stock correction " + (delta >= 0 ? "+" : "") + delta + " kg on lot #" + lid + " to approve",
                    lot.get("name") + ": " + rawReason, "exceptions", "lot", lid, null, u.getId());
            return Map.of("id", kid);
        });
    }

    @PostMapping("/counts/{kid}/decide")
    public Map<String, Object> decideCount(@PathVariable long kid,
                                           @RequestBody(required = false) Map<String, Object> d,
                                           HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = Boolean.TRUE.equals(body.get("approve"));
        String note = ValidationUtils.text(body, "note", 5, 200, "REASON_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> k = db.one("SELECT * FROM cycle_counts WHERE id=?", kid);
            if (k == null) throw new ApiException("NOT_FOUND", 404);

            String kind = (String) k.get("kind");
            permissionService.require(u, "ADJUST".equals(kind) ? "inventory.approve_adjust" : "stock.cycle_approve");

            if (!"PENDING".equals(k.get("state"))) throw new ApiException("ALREADY_DECIDED");
            if (((Number) k.get("counted_by")).longValue() == u.getId()) {
                throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);
            }

            double varKg = ((Number) k.get("variance_kg")).doubleValue();
            if (approve && !"admin".equals(u.getTier())) {
                Object capObj = db.getSetting("correction_manager_cap_kg");
                if (capObj == null || Math.abs(varKg) > Double.parseDouble(capObj.toString())) {
                    throw new ApiException("ABOVE_YOUR_APPROVAL_LIMIT", 403);
                }
            }

            long lotId = ((Number) k.get("lot_id")).longValue();
            if (approve) {
                double nowBal = ledger.balance(lotId);
                double target = ValidationUtils.r3(nowBal + varKg);
                if (target < -LedgerService.EPS) throw new ApiException("CORRECTION_WOULD_GO_NEGATIVE");
                ledger.move(lotId, varKg, "COUNT_CORRECTION", kid, u.getId());
            }

            String existingNote = (String) k.get("note");
            String combinedNote = (existingNote != null ? existingNote : "") + " | " + note;
            db.exec("UPDATE cycle_counts SET state=?, decided_by=?, decided_at=?, note=? WHERE id=?",
                    approve ? "APPLIED" : "REJECTED", u.getId(), Times.stamp(), combinedNote, kid);
            db.audit(u.getId(), "COUNT_" + (approve ? "APPLIED" : "REJECTED"), "lot:" + lotId,
                    (varKg >= 0 ? "+" : "") + varKg + " kg: " + note);
            return Map.of("ok", true);
        });
    }

    // --- Exceptions Center ---

    @GetMapping("/exceptions")
    public List<Map<String, Object>> exceptions(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "exceptions.view");

        List<Map<String, Object>> out = new ArrayList<>();

        for (Map<String, Object> r : db.rows("SELECT * FROM roast_batches WHERE qc_status='QC_HOLD'")) {
            boolean ab = r.get("abnormal") instanceof Number n && n.intValue() == 1;
            out.add(Map.of("category", "QC_HOLD", "severity", ab ? "high" : "normal",
                    "title", "Roast #" + r.get("id") + " waiting for quality decision", "view", "qc",
                    "opened_at", r.get("created_at"), "detail", r.get("input_kg") + " -> " + r.get("output_kg") + " kg"));
        }
        for (Map<String, Object> r : db.rows("SELECT * FROM lots WHERE status='QUARANTINE'")) {
            out.add(Map.of("category", "RECEIPT_VARIANCE", "severity", "high",
                    "title", "Damaged bags to verify — lot #" + r.get("id"), "view", "inventory",
                    "opened_at", r.get("created_at"), "detail", r.get("name")));
        }
        for (Map<String, Object> r : db.rows("SELECT * FROM receipts WHERE invoice_status='EXCEPTION'")) {
            out.add(Map.of("category", "INVOICE_DIFFERENCE", "severity", "high",
                    "title", "Supplier invoice difference — receipt #" + r.get("id"), "view", "finance",
                    "opened_at", r.get("created_at"), "detail", r.get("source_name") != null ? r.get("source_name") : ""));
        }
        for (Map<String, Object> r : db.rows("SELECT * FROM transfers WHERE state='SHORTAGE'")) {
            double sent = ((Number) r.get("kg_sent")).doubleValue();
            double got = r.get("kg_received") != null ? ((Number) r.get("kg_received")).doubleValue() : 0.0;
            out.add(Map.of("category", "TRANSFER_SHORTAGE", "severity", "high",
                    "title", "Transfer #" + r.get("id") + " arrived short by " + ValidationUtils.r3(sent - got) + " kg",
                    "view", "inventory", "opened_at", r.get("received_at") != null ? r.get("received_at") : r.get("created_at"),
                    "detail", ""));
        }
        for (Map<String, Object> r : db.rows("SELECT * FROM cash_closes WHERE state='VARIANCE_REVIEW'")) {
            double diff = ((Number) r.get("difference_paise")).doubleValue() / 100.0;
            out.add(Map.of("category", "CASH_CLOSE_VARIANCE", "severity", "critical",
                    "title", String.format("Cash difference ₹%+.2f on %s", diff, r.get("shift_date")),
                    "view", "counter", "opened_at", r.get("created_at"), "detail", r.get("note") != null ? r.get("note") : ""));
        }
        for (Map<String, Object> r : db.rows("SELECT o.*, m.name customer FROM orders o JOIN masters m ON m.id=o.customer_id WHERE o.state='CREDIT_REVIEW'")) {
            out.add(Map.of("category", "CREDIT_HOLD", "severity", "high",
                    "title", "Order #" + r.get("id") + " (" + r.get("customer") + ") on credit hold",
                    "view", "orders", "opened_at", r.get("created_at"), "detail", r.get("credit_note") != null ? r.get("credit_note") : ""));
        }
        for (Map<String, Object> r : db.rows("SELECT o.*, m.name customer FROM orders o JOIN masters m ON m.id=o.customer_id WHERE o.state='CONFIRMED'")) {
            out.add(Map.of("category", "STOCK_SHORTAGE", "severity", "high",
                    "title", "Order #" + r.get("id") + " confirmed but stock not reserved",
                    "view", "orders", "opened_at", r.get("created_at"), "detail", r.get("customer") != null ? r.get("customer") : ""));
        }
        for (Map<String, Object> r : db.rows("SELECT * FROM dispatches WHERE delivered_at IS NOT NULL AND delivered_kg < kg - 0.0005")) {
            double kg = ((Number) r.get("kg")).doubleValue();
            double del = ((Number) r.get("delivered_kg")).doubleValue();
            out.add(Map.of("category", "UNDELIVERED", "severity", "high",
                    "title", "Order #" + r.get("order_id") + ": " + ValidationUtils.r3(kg - del) + " kg not delivered",
                    "view", "orders", "opened_at", r.get("delivered_at"), "detail", r.get("pod_note") != null ? r.get("pod_note") : ""));
        }
        for (Map<String, Object> r : db.rows("SELECT * FROM cycle_counts WHERE state='PENDING'")) {
            double v = ((Number) r.get("variance_kg")).doubleValue();
            out.add(Map.of("category", "COUNT_VARIANCE", "severity", "high",
                    "title", "Stock " + ("ADJUST".equals(r.get("kind")) ? "correction" : "count difference") + " " + (v >= 0 ? "+" : "") + v + " kg on lot #" + r.get("lot_id"),
                    "view", "inventory", "opened_at", r.get("created_at"), "detail", r.get("note") != null ? r.get("note") : ""));
        }

        Map<String, Integer> sevOrder = Map.of("critical", 0, "high", 1, "normal", 2);
        out.sort((a, b) -> {
            int sa = sevOrder.getOrDefault(a.get("severity"), 2);
            int sb = sevOrder.getOrDefault(b.get("severity"), 2);
            if (sa != sb) return Integer.compare(sa, sb);
            return String.valueOf(a.get("opened_at")).compareTo(String.valueOf(b.get("opened_at")));
        });

        return out;
    }

    // --- Reports ---

    @GetMapping("/reports")
    public Map<String, Object> reports(@RequestParam(value = "from", required = false) String fromDate,
                                       @RequestParam(value = "to", required = false) String toDate,
                                       HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "reports.operational", "reports.commercial");

        String today = LocalDate.now(ZoneId.of("Asia/Kolkata")).toString();
        String start = fromDate != null && !fromDate.isBlank() ? fromDate : LocalDate.now(ZoneId.of("Asia/Kolkata")).minusDays(6).toString();
        String end = toDate != null && !toDate.isBlank() ? toDate : today;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", start);
        out.put("to", end);

        String lo = start + " 00:00:00";
        String hi = end + " 23:59:59";

        if (u.can("reports.operational")) {
            Map<String, Object> r = db.one("SELECT COUNT(*) batches, COALESCE(SUM(input_kg),0) input_kg, COALESCE(SUM(output_kg),0) output_kg, " +
                    "SUM(CASE WHEN qc_status='QC_HOLD' THEN 1 ELSE 0 END) on_hold FROM roast_batches WHERE created_at>=? AND created_at<=?", lo, hi);
            double inKg = r.get("input_kg") instanceof Number n ? n.doubleValue() : 0.0;
            double outKg = r.get("output_kg") instanceof Number n ? n.doubleValue() : 0.0;
            Double lossPct = inKg > 0 ? (Math.round((inKg - outKg) / inKg * 10000.0) / 100.0) : null;
            Map<String, Object> rCopy = new LinkedHashMap<>(r);
            rCopy.put("loss_pct", lossPct);
            out.put("roasting", rCopy);

            out.put("receipts", db.one("SELECT COUNT(*) receipts, COALESCE(SUM(bags),0) bags, COALESCE(SUM(damaged),0) damaged, " +
                    "COALESCE(SUM(nominal_kg),0) kg FROM receipts WHERE created_at>=? AND created_at<=?", lo, hi));

            out.put("packing", db.one("SELECT COUNT(*) runs, COALESCE(SUM(delta_kg),0) kg FROM movements " +
                    "WHERE action='PACK_OUTPUT' AND created_at>=? AND created_at<=?", lo, hi));

            List<Map<String, Object>> rawStock = ledger.stockRows("l.status IN ('RELEASED','QC_HOLD','QUARANTINE') AND l.owner='VTC'");
            Map<String, Map<String, Object>> stockAgg = new TreeMap<>();
            for (Map<String, Object> s : rawStock) {
                String bName = s.get("bean") != null ? s.get("bean").toString() : "Blends & mixed";
                String stg = String.valueOf(s.get("stage"));
                String loc = String.valueOf(s.get("location"));
                String key = bName + "||" + stg + "||" + loc;
                double kg = s.get("kg") instanceof Number n ? n.doubleValue() : 0.0;
                if (!stockAgg.containsKey(key)) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("bean", bName);
                    item.put("stage", stg);
                    item.put("location", loc);
                    item.put("kg", kg);
                    stockAgg.put(key, item);
                } else {
                    Map<String, Object> item = stockAgg.get(key);
                    double cur = ((Number) item.get("kg")).doubleValue();
                    item.put("kg", ValidationUtils.r3(cur + kg));
                }
            }
            out.put("stock", new ArrayList<>(stockAgg.values()));
        }

        if (u.can("reports.commercial")) {
            out.put("counter", db.one("SELECT COUNT(*) bills, COALESCE(SUM(total_paise),0) total_paise, COALESCE(SUM(discount_paise),0) discount_paise " +
                    "FROM counter_sales WHERE created_at>=? AND created_at<=?", lo, hi));
            out.put("counter_methods", db.rows("SELECT p.method, COALESCE(SUM(p.amount_paise),0) total_paise FROM counter_payments p JOIN counter_sales s " +
                    "ON s.id=p.sale_id WHERE s.created_at>=? AND s.created_at<=? GROUP BY p.method", lo, hi));
            out.put("invoiced", db.one("SELECT COUNT(*) invoices, COALESCE(SUM(total_paise),0) total_paise FROM invoices WHERE created_at>=? AND created_at<=?", lo, hi));
            out.put("outside", db.one("SELECT COUNT(*) jobs, COALESCE(SUM(charge_paise),0) charge_paise FROM outside_jobs WHERE created_at>=? AND created_at<=?", lo, hi));
            out.put("margin_note", "Profit is not shown: purchase and conversion costs are not all recorded yet (DPR §17).");
        }

        return out;
    }

    // --- Tally Export ---

    @GetMapping("/tally/exports")
    public List<Map<String, Object>> listExports(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.export");
        return db.rows("SELECT id, batch_no, period_from, period_to, voucher_count, control_total_paise, checksum, state, result_note, created_at, decided_at " +
                "FROM tally_exports ORDER BY id DESC");
    }

    @PostMapping("/tally/exports")
    public Map<String, Object> createExport(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.export");
        Map<String, Object> body = d != null ? d : Map.of();
        String start = String.valueOf(body.getOrDefault("from", ""));
        String end = String.valueOf(body.getOrDefault("to", ""));

        try {
            LocalDate.parse(start);
            LocalDate.parse(end);
        } catch (Exception e) {
            throw new ApiException("INVALID_DATE");
        }

        String lo = start + " 00:00:00";
        String hi = end + " 23:59:59";

        return db.tx(() -> {
            Set<String> taken = new HashSet<>();
            for (Map<String, Object> row : db.rows("SELECT l.source_type, l.source_id FROM tally_export_lines l JOIN tally_exports e ON e.id=l.export_id WHERE e.state IN ('EXPORTED','ACCEPTED')")) {
                taken.add(row.get("source_type") + ":" + row.get("source_id"));
            }

            List<Map<String, Object>> vs = new ArrayList<>();
            for (Map<String, Object> s : db.rows("SELECT * FROM counter_sales WHERE created_at>=? AND created_at<=?", lo, hi)) {
                String key = "counter_sale:" + s.get("id");
                if (!taken.contains(key)) {
                    vs.add(Map.of("type", "counter_sale", "id", s.get("id"), "voucher", "Sales",
                            "date", String.valueOf(s.get("created_at")).substring(0, 10), "number", s.get("bill_no"),
                            "party", "Counter cash/UPI sales", "amount", s.get("total_paise"), "tax", s.get("gst_paise")));
                }
            }
            for (Map<String, Object> i : db.rows("SELECT i.*, m.name customer FROM invoices i JOIN masters m ON m.id=i.customer_id WHERE i.created_at>=? AND i.created_at<=?", lo, hi)) {
                String key = "invoice:" + i.get("id");
                if (!taken.contains(key)) {
                    vs.add(Map.of("type", "invoice", "id", i.get("id"), "voucher", "Sales",
                            "date", String.valueOf(i.get("created_at")).substring(0, 10), "number", i.get("number"),
                            "party", i.get("customer"), "amount", i.get("total_paise"), "tax", i.get("gst_paise")));
                }
            }
            for (Map<String, Object> k : db.rows("SELECT k.*, i.number, m.name customer FROM collections k JOIN invoices i ON i.id=k.invoice_id JOIN masters m ON m.id=i.customer_id " +
                    "WHERE k.state='VERIFIED' AND k.verified_at>=? AND k.verified_at<=?", lo, hi)) {
                String key = "collection:" + k.get("id");
                if (!taken.contains(key)) {
                    vs.add(Map.of("type", "collection", "id", k.get("id"), "voucher", "Receipt",
                            "date", String.valueOf(k.get("verified_at")).substring(0, 10), "number", k.get("number") + "/" + k.get("id"),
                            "party", k.get("customer"), "amount", k.get("amount_paise"), "tax", 0));
                }
            }
            for (Map<String, Object> p : db.rows("SELECT p.*, r.source_name FROM supplier_payments p JOIN receipts r ON r.id=p.receipt_id WHERE p.state='APPROVED' " +
                    "AND p.decided_at>=? AND p.decided_at<=?", lo, hi)) {
                String key = "supplier_payment:" + p.get("id");
                if (!taken.contains(key)) {
                    vs.add(Map.of("type", "supplier_payment", "id", p.get("id"), "voucher", "Payment",
                            "date", p.get("paid_on"), "number", "SP-" + p.get("id"),
                            "party", p.get("source_name") != null ? p.get("source_name") : "", "amount", p.get("amount_paise"), "tax", 0));
                }
            }

            if (vs.isEmpty()) throw new ApiException("NOTHING_NEW_TO_EXPORT");

            StringBuilder csv = new StringBuilder();
            csv.append("voucher_type,date,voucher_no,party,amount_inr,tax_inr,source_type,source_id\n");
            long total = 0;
            for (Map<String, Object> item : vs) {
                long amt = ((Number) item.get("amount")).longValue();
                long tax = ((Number) item.get("tax")).longValue();
                total += amt;
                csv.append(String.format("%s,%s,%s,%s,%.2f,%.2f,%s,%s\n",
                        item.get("voucher"), item.get("date"), item.get("number"), item.get("party"),
                        amt / 100.0, tax / 100.0, item.get("type"), item.get("id")));
            }
            csv.append(String.format("CONTROL_TOTAL,,,,%.2f,,vouchers,%d\n", total / 100.0, vs.size()));
            String content = csv.toString();

            String digest;
            try {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] hash = md.digest(content.getBytes(StandardCharsets.UTF_8));
                StringBuilder hex = new StringBuilder();
                for (byte b : hash) hex.append(String.format("%02x", b));
                digest = hex.toString();
            } catch (Exception e) {
                digest = "sha256error";
            }

            long n = db.count("SELECT COUNT(*) FROM tally_exports") + 1;
            String batch = String.format("TLY-%s-%03d", LocalDate.now(ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ofPattern("yyMMdd")), n);

            long eid = db.insert("INSERT INTO tally_exports(batch_no, period_from, period_to, voucher_count, control_total_paise, checksum, content, state, created_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?,?,?,?)", batch, start, end, vs.size(), total, digest, content, "EXPORTED", u.getId(), Times.stamp());

            for (Map<String, Object> item : vs) {
                db.exec("INSERT INTO tally_export_lines VALUES(?,?,?)", eid, item.get("type"), item.get("id"));
            }

            db.audit(u.getId(), "TALLY_EXPORTED", "tally:" + eid, batch + ": " + vs.size() + " vouchers, Rs." + (total / 100.0));
            return Map.of("id", eid, "batch_no", batch, "vouchers", vs.size(),
                    "control_total_paise", total, "checksum", digest, "content", content);
        });
    }

    @GetMapping("/tally/exports/{eid}")
    public Map<String, Object> getExport(@PathVariable long eid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.export");
        Map<String, Object> e = db.one("SELECT * FROM tally_exports WHERE id=?", eid);
        if (e == null) throw new ApiException("NOT_FOUND", 404);
        return e;
    }

    @PostMapping("/tally/exports/{eid}/result")
    public Map<String, Object> exportResult(@PathVariable long eid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.export");
        Map<String, Object> body = d != null ? d : Map.of();
        boolean accepted = Boolean.TRUE.equals(body.get("accepted"));
        String note = ValidationUtils.text(body, "note", 3, 300, "REASON_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> e = db.one("SELECT * FROM tally_exports WHERE id=?", eid);
            if (e == null) throw new ApiException("NOT_FOUND", 404);
            if (!"EXPORTED".equals(e.get("state"))) throw new ApiException("ALREADY_DECIDED");

            db.exec("UPDATE tally_exports SET state=?, result_note=?, decided_by=?, decided_at=? WHERE id=?",
                    accepted ? "ACCEPTED" : "REJECTED", note, u.getId(), Times.stamp(), eid);
            db.audit(u.getId(), "TALLY_" + (accepted ? "ACCEPTED" : "REJECTED"), "tally:" + eid, note);
            return Map.of("ok", true);
        });
    }

    // --- Receivables & Collections ---

    @GetMapping("/receivables")
    public Map<String, Object> receivables(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "finance.view", "finance.collection.record", "finance.collection.verify");

        List<Map<String, Object>> rows = db.rows(
                "SELECT i.*, m.name customer, m.phone customer_phone, " +
                        "(SELECT COALESCE(SUM(amount_paise),0) FROM collections k WHERE k.invoice_id=i.id AND k.state='VERIFIED') paid_paise " +
                        "FROM invoices i JOIN masters m ON m.id=i.customer_id ORDER BY i.id DESC"
        );
        List<Map<String, Object>> pending = db.rows(
                "SELECT k.*, i.number, x.full_name recorded_by_name FROM collections k JOIN invoices i ON i.id=k.invoice_id " +
                        "JOIN users x ON x.id=k.recorded_by WHERE k.state='RECORDED' ORDER BY k.id"
        );

        String today = LocalDate.now(ZoneId.of("Asia/Kolkata")).toString();
        Map<String, Long> buckets = new LinkedHashMap<>();
        buckets.put("current", 0L);
        buckets.put("1-30", 0L);
        buckets.put("31-60", 0L);
        buckets.put("60+", 0L);

        for (Map<String, Object> r : rows) {
            if (!u.can("customer.contacts")) r.remove("customer_phone");
            long total = ((Number) r.get("total_paise")).longValue();
            long paid = ((Number) r.get("paid_paise")).longValue();
            long due = total - paid;
            r.put("due_paise", due);
            if (due <= 0) continue;

            String dueDateStr = (String) r.get("due_date");
            int late = 0;
            if (dueDateStr != null) {
                try {
                    LocalDate dd = LocalDate.parse(dueDateStr);
                    late = (int) (LocalDate.now(ZoneId.of("Asia/Kolkata")).toEpochDay() - dd.toEpochDay());
                } catch (Exception ignored) {
                }
            }
            r.put("days_late", Math.max(late, 0));
            String bKey = late <= 0 ? "current" : (late <= 30 ? "1-30" : (late <= 60 ? "31-60" : "60+"));
            buckets.put(bKey, buckets.get(bKey) + due);
        }

        return Map.of("invoices", rows, "pending", pending, "aging", buckets);
    }

    @PostMapping("/invoices/{iid}/collections")
    public Map<String, Object> recordCollection(@PathVariable long iid,
                                                @RequestBody(required = false) Map<String, Object> d,
                                                HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.collection.record");
        Map<String, Object> body = d != null ? d : Map.of();

        long amount = body.get("amount_paise") instanceof Number n ? n.longValue() : 0;
        if (amount <= 0) throw new ApiException("INVALID_AMOUNT");
        String method = (String) body.get("method");
        if (!List.of("CASH", "UPI", "BANK", "CHEQUE").contains(method)) {
            throw new ApiException("INVALID_PAYMENT_METHOD");
        }
        String ref = body.containsKey("reference") ? String.valueOf(body.get("reference")).trim() : "";
        if (ref.length() > 60) ref = ref.substring(0, 60);

        final String finalRef = ref;
        return db.tx(() -> {
            Map<String, Object> inv = db.one("SELECT * FROM invoices WHERE id=?", iid);
            if (inv == null) throw new ApiException("NOT_FOUND", 404);

            long total = ((Number) inv.get("total_paise")).longValue();
            long coll = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM collections WHERE invoice_id=? AND state IN ('RECORDED','VERIFIED')", iid);
            long open = total - coll;
            if (amount > open) throw new ApiException("MORE_THAN_DUE");

            db.insert("INSERT INTO collections(invoice_id, amount_paise, method, reference, state, recorded_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?)", iid, amount, method, finalRef, "RECORDED", u.getId(), Times.stamp());
            db.audit(u.getId(), "COLLECTION_RECORDED", "invoice:" + iid, "Rs." + (amount / 100.0) + " " + method);
            alerts.notifyPerm("finance.collection.verify", "normal", "Verify Rs." + (amount / 100.0) + " collected on " + inv.get("number"),
                    "", "finance", "invoice", iid, null, u.getId());
            return Map.of("ok", true);
        });
    }

    @PostMapping("/collections/{kid}/verify")
    public Map<String, Object> verifyCollection(@PathVariable long kid,
                                                @RequestBody(required = false) Map<String, Object> d,
                                                HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "finance.collection.verify");
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = !body.containsKey("approve") || Boolean.TRUE.equals(body.get("approve"));

        return db.tx(() -> {
            Map<String, Object> k = db.one("SELECT * FROM collections WHERE id=?", kid);
            if (k == null) throw new ApiException("NOT_FOUND", 404);
            if (!"RECORDED".equals(k.get("state"))) throw new ApiException("ALREADY_DECIDED");
            if (((Number) k.get("recorded_by")).longValue() == u.getId()) {
                throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);
            }

            db.exec("UPDATE collections SET state=?, verified_by=?, verified_at=? WHERE id=?",
                    approve ? "VERIFIED" : "REJECTED", u.getId(), Times.stamp(), kid);

            long iid = ((Number) k.get("invoice_id")).longValue();
            Map<String, Object> inv = db.one("SELECT * FROM invoices WHERE id=?", iid);
            long total = ((Number) inv.get("total_paise")).longValue();
            long paid = db.queryForLong("SELECT COALESCE(SUM(amount_paise),0) FROM collections WHERE invoice_id=? AND state='VERIFIED'", iid);
            String st = paid >= total ? "PAID" : (paid > 0 ? "PART_PAID" : "OPEN");
            db.exec("UPDATE invoices SET status=? WHERE id=?", st, iid);

            db.audit(u.getId(), "COLLECTION_" + (approve ? "VERIFIED" : "REJECTED"), "invoice:" + iid,
                    "Rs." + (((Number) k.get("amount_paise")).longValue() / 100.0));
            return Map.of("ok", true);
        });
    }
}
