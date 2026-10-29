package in.vasavi.vtc.area.operations;

import in.vasavi.vtc.common.AlertsService;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.CodesService;
import in.vasavi.vtc.common.LedgerService;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.common.WorktasksService;
import in.vasavi.vtc.config.AppProperties;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/v1")
public class OperationsController {

    private static final Map<String, String> RECEIPT_FIELDS = Map.of(
            "invoice_ref", "invoice.metadata",
            "invoice_status", "invoice.metadata",
            "payment_status", "supplier.pay.status",
            "payment_date", "supplier.pay.status",
            "invoice_amount_paise", "invoice.cost",
            "has_invoice_file", "invoice.metadata"
    );
    private static final List<String> MASTER_KINDS = List.of("product", "supplier", "customer");
    private static final List<String> CATEGORIES = List.of("", "GREEN_COFFEE", "CHICORY", "TEA", "PACKAGING", "OTHER");

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final CodesService codes;
    private final LedgerService ledger;
    private final AlertsService alerts;
    private final WorktasksService worktasks;
    private final AppProperties props;

    public OperationsController(Db db, SessionService sessionService, PermissionService permissionService,
                                CodesService codes, LedgerService ledger, AlertsService alerts,
                                WorktasksService worktasks, AppProperties props) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.codes = codes;
        this.ledger = ledger;
        this.alerts = alerts;
        this.worktasks = worktasks;
        this.props = props;
    }

    private Path filesDir() {
        try {
            Path p = Paths.get(props.getFilesDir());
            Files.createDirectories(p);
            return p;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @GetMapping("/summary")
    public Map<String, Object> summary(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "dashboard.my_view");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("tasks", db.count("SELECT COUNT(*) FROM tasks WHERE status NOT IN ('DONE','SUBMITTED') AND assigned_to=?", u.getId()));
        if (u.can("goods.view")) {
            data.put("received_bags", db.count("SELECT COALESCE(SUM(bags),0) FROM receipts"));
        }
        if (u.can("inventory.view")) {
            List<Map<String, Object>> per = db.rows(
                    "SELECT COALESCE(l.bean_id, l.product_id) b, SUM(m.delta_kg) kg FROM lots l JOIN movements m ON m.lot_id=l.id " +
                    "WHERE l.status='RELEASED' AND l.owner='VTC' AND COALESCE(l.bean_id, l.product_id) IS NOT NULL GROUP BY b HAVING kg>0.0005"
            );
            Map<Long, Double> have = new LinkedHashMap<>();
            for (Map<String, Object> r : per) {
                have.put(((Number) r.get("b")).longValue(), ((Number) r.get("kg")).doubleValue());
            }
            int beansLow = 0;
            for (Map<String, Object> r : db.rows("SELECT product_id, low_kg FROM stock_cards WHERE low_kg IS NOT NULL AND hidden=0")) {
                long pid = ((Number) r.get("product_id")).longValue();
                double lo = ((Number) r.get("low_kg")).doubleValue();
                if (have.getOrDefault(pid, 0.0) < lo) {
                    beansLow++;
                }
            }
            data.put("beans_in_stock", have.size());
            data.put("beans_low", beansLow);
        }
        if (u.can("roast.view")) {
            data.put("roasts", db.count("SELECT COUNT(*) FROM roast_batches"));
        }
        if (u.can("pack.view")) {
            data.put("packing", db.count("SELECT COUNT(*) FROM pack_jobs WHERE state!='COMPLETE'"));
        }
        if (u.can("qc.view")) {
            data.put("held", db.count("SELECT COUNT(*) FROM lots WHERE status IN ('QC_HOLD','QUARANTINE')"));
        }
        if (u.can("outgoing.view")) {
            data.put("orders", db.count("SELECT COUNT(*) FROM orders"));
        }
        if (u.can("tasks.view_all")) {
            data.put("team_tasks", db.count("SELECT COUNT(*) FROM tasks WHERE status!='DONE'"));
            data.put("to_review", db.count("SELECT COUNT(*) FROM tasks WHERE status='SUBMITTED' AND created_by=? AND assigned_to!=?", u.getId(), u.getId()));
        }
        if (u.can("invoice.metadata")) {
            data.put("pending_invoices", db.count("SELECT COUNT(*) FROM receipts WHERE invoice_status!='MATCHED'"));
        }
        return data;
    }

    @GetMapping("/masters")
    public List<Map<String, Object>> getMasters(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "masters.view", "goods.receive", "outgoing.create");
        String kind = req.getParameter("kind") != null ? req.getParameter("kind") : "product";
        if (!MASTER_KINDS.contains(kind)) {
            throw new ApiException("INVALID_KIND");
        }
        boolean drafts = u.can("masters.view_drafts") || u.can("masters.approve");
        List<Map<String, Object>> rows = db.rows(
                "SELECT id, kind, name, code, nominal_kg, category, state, created_at, phone, address FROM masters WHERE kind=?" +
                (drafts ? "" : " AND state='ACTIVE'") + " ORDER BY id DESC",
                kind
        );
        if (!u.can("customer.contacts")) {
            for (Map<String, Object> r : rows) {
                r.remove("phone");
                r.remove("address");
            }
        }
        return rows;
    }

    private String beanCode(Object given, String name, Long mid) {
        Set<String> taken = new LinkedHashSet<>(codes.takenCodes());
        if (mid != null) {
            String cur = db.val(String.class, "SELECT code FROM masters WHERE id=?", mid);
            if (cur != null) taken.remove(cur);
        }
        if (given == null || given.toString().isBlank()) {
            return codes.suggest(name, taken);
        }
        String code = given.toString().trim().toUpperCase();
        if (!CodesService.BEAN_CODE.matcher(code).matches()) {
            throw new ApiException("INVALID_BEAN_CODE");
        }
        if (taken.contains(code)) {
            throw new ApiException("BEAN_CODE_TAKEN");
        }
        return code;
    }

    @PostMapping("/masters")
    public Map<String, Object> createMaster(@RequestBody(required = false) Map<String, Object> d,
                                            HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "masters.create_draft", "masters.approve");
        Map<String, Object> body = d != null ? d : Map.of();
        String kind = body.get("kind") != null ? body.get("kind").toString() : "";
        if (!MASTER_KINDS.contains(kind)) {
            throw new ApiException("INVALID_MASTER");
        }
        String name = ValidationUtils.text(body, "name", 2, 110, "INVALID_MASTER");
        Double nominal = null;
        if ("product".equals(kind) && body.get("nominal_kg") != null && !"".equals(body.get("nominal_kg"))) {
            nominal = ValidationUtils.number(body, "nominal_kg");
        }
        String category = body.get("category") != null ? body.get("category").toString() : "";
        if (!CATEGORIES.contains(category) || (!category.isEmpty() && !"product".equals(kind))) {
            throw new ApiException("INVALID_CATEGORY");
        }
        String state = u.can("masters.approve") ? "ACTIVE" : "DRAFT";
        Double finalNominal = nominal;
        return db.tx(() -> {
            String phone = body.get("phone") != null ? body.get("phone").toString().trim() : "";
            if (phone.length() > 20) phone = phone.substring(0, 20);
            String address = body.get("address") != null ? body.get("address").toString().trim() : "";
            if (address.length() > 200) address = address.substring(0, 200);
            if ((!phone.isEmpty() || !address.isEmpty()) && !u.can("customer.contacts")) {
                throw new ApiException("ACCESS_DENIED", 403);
            }
            if (db.one("SELECT 1 FROM masters WHERE kind=? AND lower(name)=lower(?) AND state!='INACTIVE'", kind, name) != null) {
                throw new ApiException("NAME_ALREADY_EXISTS");
            }
            String code = "product".equals(kind) ? beanCode(body.get("code"), name, null) : null;
            long mid = db.insert(
                    "INSERT INTO masters(kind, name, nominal_kg, state, creator_id, approved_by, created_at, phone, address, category, code) " +
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    kind, name, finalNominal, state, u.getId(), "ACTIVE".equals(state) ? u.getId() : null,
                    Times.stamp(), phone, address, category, code
            );
            db.audit(u.getId(), "MASTER_CREATED", kind + ":" + mid, state);
            return Map.of("id", mid, "state", state);
        });
    }

    @PostMapping("/masters/{mid}/approve")
    public Map<String, Object> approveMaster(@PathVariable long mid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "masters.approve");
        db.txVoid(() -> {
            Map<String, Object> m = db.one("SELECT * FROM masters WHERE id=?", mid);
            if (m == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            if (!"DRAFT".equals(m.get("state"))) {
                throw new ApiException("NOT_DRAFT");
            }
            db.exec("UPDATE masters SET state='ACTIVE', approved_by=? WHERE id=?", u.getId(), mid);
            db.audit(u.getId(), "MASTER_APPROVED", m.get("kind") + ":" + mid);
        });
        return Map.of("ok", true);
    }

    @PutMapping("/masters/{mid}")
    public Map<String, Object> editMaster(@PathVariable long mid,
                                          @RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "masters.approve");
        Map<String, Object> body = d != null ? d : Map.of();
        db.txVoid(() -> {
            Map<String, Object> m = db.one("SELECT * FROM masters WHERE id=?", mid);
            if (m == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            Map<String, Object> ch = new LinkedHashMap<>();
            if (body.containsKey("name")) {
                ch.put("name", ValidationUtils.text(body, "name", 2, 110, "INVALID_MASTER"));
            }
            if (body.containsKey("nominal_kg") && "product".equals(m.get("kind"))) {
                Object nk = body.get("nominal_kg");
                ch.put("nominal_kg", (nk == null || "".equals(nk)) ? null : ValidationUtils.number(body, "nominal_kg"));
            }
            if (body.containsKey("category") && "product".equals(m.get("kind"))) {
                String cat = body.get("category") != null ? body.get("category").toString() : "";
                if (!CATEGORIES.contains(cat)) {
                    throw new ApiException("INVALID_CATEGORY");
                }
                ch.put("category", cat);
            }
            if (body.containsKey("phone") || body.containsKey("address")) {
                String p = body.getOrDefault("phone", m.get("phone")) != null ? body.getOrDefault("phone", m.get("phone")).toString().trim() : "";
                String a = body.getOrDefault("address", m.get("address")) != null ? body.getOrDefault("address", m.get("address")).toString().trim() : "";
                ch.put("phone", p.length() > 20 ? p.substring(0, 20) : p);
                ch.put("address", a.length() > 200 ? a.substring(0, 200) : a);
            }
            if (body.get("code") != null && !"".equals(body.get("code")) && "product".equals(m.get("kind"))
                    && !body.get("code").toString().trim().toUpperCase().equals(m.get("code"))) {
                ch.put("code", beanCode(body.get("code"), (String) m.get("name"), mid));
            }
            if (body.containsKey("active")) {
                if ("DRAFT".equals(m.get("state"))) {
                    throw new ApiException("APPROVE_THE_DRAFT_FIRST");
                }
                boolean act = Boolean.TRUE.equals(body.get("active")) || Integer.valueOf(1).equals(body.get("active"));
                ch.put("state", act ? "ACTIVE" : "INACTIVE");
            }
            if (ch.isEmpty()) {
                throw new ApiException("NOTHING_TO_CHANGE");
            }
            List<String> sets = new ArrayList<>();
            List<Object> vals = new ArrayList<>();
            List<String> info = new ArrayList<>();
            for (Map.Entry<String, Object> e : ch.entrySet()) {
                sets.add(e.getKey() + "=?");
                vals.add(e.getValue());
                info.add(e.getKey() + "→" + e.getValue());
            }
            vals.add(mid);
            db.exec("UPDATE masters SET " + String.join(", ", sets) + " WHERE id=?", vals.toArray());
            db.audit(u.getId(), "MASTER_UPDATED", m.get("kind") + ":" + mid, String.join("; ", info), "access");
        });
        return Map.of("ok", true);
    }

    @GetMapping("/roast-profiles")
    public List<Map<String, Object>> roastProfiles(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "roast.view", "roast.execute", "masters.approve");
        return db.rows("SELECT id, name, notes, active FROM roast_profiles" +
                (u.can("masters.approve") ? "" : " WHERE active=1") + " ORDER BY active DESC, name");
    }

    @PostMapping("/roast-profiles")
    public Map<String, Object> addRoastProfile(@RequestBody(required = false) Map<String, Object> d,
                                               HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "masters.approve");
        Map<String, Object> body = d != null ? d : Map.of();
        String name = ValidationUtils.text(body, "name", 2, 60, "INVALID_NAME");
        String notes = body.get("notes") != null ? body.get("notes").toString().trim() : "";
        if (notes.length() > 200) notes = notes.substring(0, 200);
        String finalNotes = notes;
        return db.tx(() -> {
            if (db.one("SELECT 1 FROM roast_profiles WHERE lower(name)=lower(?)", name) != null) {
                throw new ApiException("NAME_ALREADY_EXISTS");
            }
            long pid = db.insert("INSERT INTO roast_profiles(name, notes, created_by, created_at) VALUES(?,?,?,?)",
                    name, finalNotes, u.getId(), Times.stamp());
            db.audit(u.getId(), "ROAST_PROFILE_ADDED", "roast_profile:" + pid, name, "access");
            return Map.of("id", pid);
        });
    }

    @PutMapping("/roast-profiles/{pid}")
    public Map<String, Object> editRoastProfile(@PathVariable long pid,
                                                @RequestBody(required = false) Map<String, Object> d,
                                                HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "masters.approve");
        Map<String, Object> body = d != null ? d : Map.of();
        db.txVoid(() -> {
            Map<String, Object> p = db.one("SELECT * FROM roast_profiles WHERE id=?", pid);
            if (p == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            String name = body.containsKey("name") ? ValidationUtils.text(body, "name", 2, 60, "INVALID_NAME") : (String) p.get("name");
            String notes = body.getOrDefault("notes", p.get("notes")) != null ? body.getOrDefault("notes", p.get("notes")).toString().trim() : "";
            if (notes.length() > 200) notes = notes.substring(0, 200);
            Object actObj = body.getOrDefault("active", p.get("active"));
            int active = (Boolean.TRUE.equals(actObj) || (actObj instanceof Number n && n.intValue() != 0)) ? 1 : 0;
            db.exec("UPDATE roast_profiles SET name=?, notes=?, active=? WHERE id=?", name, notes, active, pid);
            db.audit(u.getId(), "ROAST_PROFILE_UPDATED", "roast_profile:" + pid, name + ", " + (active == 1 ? "on" : "off"), "access");
        });
        return Map.of("ok", true);
    }

    @GetMapping("/inward")
    public List<Map<String, Object>> inward(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "goods.view");
        List<Map<String, Object>> rows = db.rows(
                "SELECT r.id, r.code, r.source, r.source_name, m.name product, r.bags, r.damaged, r.partial, " +
                "r.partial_kg, r.nominal_kg, r.created_at, r.invoice_ref, r.invoice_status, r.payment_status, " +
                "r.payment_date, r.invoice_amount_paise, CASE WHEN r.invoice_file_id IS NOT NULL THEN 1 ELSE 0 END has_invoice_file, " +
                "r.reversed_at FROM receipts r JOIN masters m ON m.id=r.product_id ORDER BY r.id DESC LIMIT 100"
        );
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            out.add(permissionService.mask(r, u, RECEIPT_FIELDS));
        }
        return out;
    }

    @PostMapping("/inward")
    public Map<String, Object> postInward(@RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "goods.receive");
        Map<String, Object> body = d != null ? d : Map.of();
        String source = body.get("source") != null ? body.get("source").toString() : "";
        if (!List.of("AUCTION", "OTHER").contains(source)) {
            throw new ApiException("INVALID_SOURCE");
        }
        String sourceName = ValidationUtils.text(body, "source_name", 2, 120, "SOURCE_NAME_REQUIRED");
        int bags = ValidationUtils.integer(body, "bags", 1);
        int damaged = ValidationUtils.integer(body, "damaged", 0);
        int partial = (body.get("partial") != null && !"".equals(body.get("partial")))
                ? ValidationUtils.integer(body, "partial", 0)
                : 0;
        if (damaged + partial > bags) {
            throw new ApiException("DAMAGED_EXCEEDS_BAGS");
        }
        double partialKg = 0.0;
        if (partial > 0) {
            double rawPkg = ValidationUtils.number(body, "partial_kg");
            partialKg = ValidationUtils.r3(rawPkg);
            if (Math.abs(partialKg - rawPkg) > 1e-7) {
                throw new ApiException("KG_NEEDS_3_DECIMAL_PRECISION");
            }
        }
        long productId;
        try {
            productId = Long.parseLong(body.get("product_id").toString());
        } catch (Exception e) {
            throw new ApiException("INVALID_PRODUCT");
        }
        String idemKey = req.getHeader("X-Idempotency-Key");
        double finalPartialKg = partialKg;

        return db.tx(() -> {
            Map<String, Object> prev = db.idemGet(u.getId(), "INWARD", idemKey);
            if (prev != null) {
                return prev;
            }
            Map<String, Object> prod = db.one("SELECT * FROM masters WHERE id=? AND kind='product' AND state='ACTIVE'", productId);
            if (prod == null || prod.get("nominal_kg") == null || ((Number) prod.get("nominal_kg")).doubleValue() <= 0) {
                throw new ApiException("PRODUCT_NOMINAL_KG_NOT_CONFIGURED");
            }
            double nomPerBag = ((Number) prod.get("nominal_kg")).doubleValue();
            if (partial > 0 && finalPartialKg >= partial * nomPerBag) {
                throw new ApiException("PARTIAL_KG_MUST_BE_LESS_THAN_FULL_BAGS");
            }
            int sound = bags - damaged - partial;
            double nominal = ValidationUtils.r3((bags - partial) * nomPerBag + finalPartialKg);
            CodesService.ReceiptCode rc = codes.receiptCode();
            String now = Times.stamp();
            long rid = db.insert(
                    "INSERT INTO receipts(source, source_name, product_id, bags, damaged, nominal_kg, created_by, created_at, partial, partial_kg, code) " +
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    source, sourceName, productId, bags, damaged, nominal, u.getId(), now, partial,
                    partial > 0 ? finalPartialKg : null, rc.code()
            );
            List<Map<String, Object>> made = new ArrayList<>();
            Object[][] lotSpecs = {
                    {sound, sound * nomPerBag, "RELEASED", "SOUND", "Sound bags"},
                    {damaged, damaged * nomPerBag, "QUARANTINE", "DAMAGED", "Damaged bags"},
                    {partial, finalPartialKg, "RELEASED", "PARTIAL", "Partial bags (weighed)"}
            };
            String bCode = codes.beanCode(productId);
            String cDay = Times.compactDayIst();
            for (Object[] ls : lotSpecs) {
                int n = (int) ls[0];
                if (n == 0) continue;
                double kg = (double) ls[1];
                String status = (String) ls[2];
                String kind = (String) ls[3];
                String label = (String) ls[4];
                String lcode = String.format("RAW-%s-%s-%02d%s", bCode, cDay, rc.seq(), CodesService.KIND_SUFFIX.get(kind));
                long lid = db.insert(
                        "INSERT INTO lots(product_id, name, stage, owner, status, receipt_id, created_at, bag_kind, bags, code) " +
                        "VALUES(?,?,?,?,?,?,?,?,?,?)",
                        productId, prod.get("name") + " • " + rc.code() + " • " + label, "RAW", "VTC", status, rid, now, kind, n, lcode
                );
                made.add(Map.of("id", lid, "code", lcode, "bag_kind", kind, "bags", n));
                db.exec("INSERT INTO movements(lot_id, delta_kg, action, source_id, actor_id, created_at) VALUES(?,?,?,?,?,?)",
                        lid, ValidationUtils.r3(kg), !"PARTIAL".equals(kind) ? "RECEIVED_PROVISIONAL" : "RECEIVED_WEIGHED", rid, u.getId(), now);
            }
            worktasks.bump(u.getId(), "INWARD", bags, null);
            db.audit(u.getId(), "RECEIPT_POSTED", "receipt:" + rid,
                    bags + " bags: " + sound + " sound, " + damaged + " damaged (quarantined), " + partial + " partial (" + finalPartialKg + " kg weighed)");
            if (damaged > 0) {
                alerts.notifyPerm("inventory.verify_quarantine", "high",
                        damaged + " damaged bag" + (damaged > 1 ? "s" : "") + " to verify — receipt #" + rid,
                        prod.get("name") + " from " + sourceName + ". Usable kg must be physically checked.",
                        "inventory", "receipt", rid, null, null);
            }
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("id", rid);
            res.put("code", rc.code());
            res.put("lots", made);
            res.put("nominal_kg", nominal);
            res.put("allocatable_kg", ValidationUtils.r3(sound * nomPerBag + finalPartialKg));
            res.put("quarantine_kg", ValidationUtils.r3(damaged * nomPerBag));
            db.idemSave(u.getId(), "INWARD", idemKey, res);
            return res;
        });
    }

    @PutMapping("/inward/{rid}/finance")
    public Map<String, Object> receiptFinance(@PathVariable long rid,
                                              @RequestBody(required = false) Map<String, Object> d,
                                              HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        if (body.containsKey("payment_status")) {
            throw new ApiException("USE_SUPPLIER_PAYMENTS");
        }
        if (!body.containsKey("invoice_ref") && !body.containsKey("invoice_status") && !body.containsKey("invoice_amount_paise")) {
            throw new ApiException("NOTHING_TO_CHANGE");
        }
        permissionService.require(u, "invoice.reconcile");
        if (body.containsKey("invoice_amount_paise")) {
            permissionService.require(u, "invoice.cost");
        }
        db.txVoid(() -> {
            Map<String, Object> r = db.one("SELECT * FROM receipts WHERE id=?", rid);
            if (r == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            String inv = body.get("invoice_status") != null ? body.get("invoice_status").toString() : (String) r.get("invoice_status");
            if (!List.of("PENDING", "MATCHED", "EXCEPTION").contains(inv)) {
                throw new ApiException("INVALID_FINANCE_STATUS");
            }
            String ref = body.getOrDefault("invoice_ref", r.get("invoice_ref")) != null
                    ? body.getOrDefault("invoice_ref", r.get("invoice_ref")).toString().trim()
                    : "";
            if (ref.length() > 90) ref = ref.substring(0, 90);
            Long amount = r.get("invoice_amount_paise") instanceof Number n ? n.longValue() : null;
            if (body.containsKey("invoice_amount_paise")) {
                Object rawAmt = body.get("invoice_amount_paise");
                if (rawAmt == null || "".equals(rawAmt)) {
                    amount = null;
                } else {
                    try {
                        amount = Long.parseLong(rawAmt.toString());
                    } catch (NumberFormatException e) {
                        throw new ApiException("INVALID_AMOUNT");
                    }
                    if (amount < 0) {
                        throw new ApiException("INVALID_AMOUNT");
                    }
                }
            }
            db.exec("UPDATE receipts SET invoice_ref=?, invoice_status=?, invoice_amount_paise=? WHERE id=?", ref, inv, amount, rid);
            db.audit(u.getId(), "RECEIPT_INVOICE_MATCHED", "receipt:" + rid,
                    "invoice=" + inv + (body.containsKey("invoice_amount_paise") ? ", amount set" : ""));
            if ("EXCEPTION".equals(inv)) {
                alerts.notifyPerm("finance.view", "high", "Supplier invoice difference on receipt #" + rid,
                        ref, "finance", "receipt", rid, null, u.getId());
            }
        });
        return Map.of("ok", true);
    }

    @PostMapping("/inward/{rid}/reverse")
    public Map<String, Object> reverseReceipt(@PathVariable long rid,
                                              @RequestBody(required = false) Map<String, Object> d,
                                              HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "goods.reverse");
        Map<String, Object> body = d != null ? d : Map.of();
        String reason = ValidationUtils.text(body, "reason", 5, 200, "REASON_REQUIRED");
        db.txVoid(() -> {
            Map<String, Object> r = db.one("SELECT * FROM receipts WHERE id=?", rid);
            if (r == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            if (r.get("reversed_at") != null) {
                throw new ApiException("ALREADY_REVERSED");
            }
            List<Map<String, Object>> lots = db.rows("SELECT * FROM lots WHERE receipt_id=?", rid);
            for (Map<String, Object> lot : lots) {
                long lid = ((Number) lot.get("id")).longValue();
                long moved = db.count("SELECT COUNT(*) FROM movements WHERE lot_id=? AND action NOT IN ('RECEIVED_PROVISIONAL','RECEIVED_WEIGHED')", lid);
                if (moved > 0 || ledger.reserved(lid) > 0) {
                    throw new ApiException("RECEIPT_STOCK_ALREADY_USED");
                }
            }
            for (Map<String, Object> lot : lots) {
                long lid = ((Number) lot.get("id")).longValue();
                ledger.move(lid, -ledger.balance(lid), "RECEIPT_REVERSED", rid, u.getId());
                db.exec("UPDATE lots SET status='REVERSED' WHERE id=?", lid);
            }
            db.exec("UPDATE receipts SET reversed_at=? WHERE id=?", Times.stamp(), rid);
            db.audit(u.getId(), "RECEIPT_REVERSED", "receipt:" + rid, reason);
        });
        return Map.of("ok", true);
    }

    @PostMapping("/inward/{rid}/invoice-file")
    public Map<String, Object> uploadInvoiceFile(@PathVariable long rid,
                                                 @RequestBody(required = false) Map<String, Object> d,
                                                 HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "invoice.reconcile");
        Map<String, Object> body = d != null ? d : Map.of();
        String mime = body.get("mime") != null ? body.get("mime").toString().toLowerCase() : "";
        if (!List.of("application/pdf", "image/jpeg", "image/png", "image/webp").contains(mime)) {
            throw new ApiException("FILE_TYPE_NOT_ALLOWED");
        }
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(body.get("data") != null ? body.get("data").toString() : "");
        } catch (Exception e) {
            throw new ApiException("FILE_DATA_INVALID");
        }
        if (raw.length < 100 || raw.length > 8_000_000) {
            throw new ApiException("FILE_TOO_LARGE");
        }
        String digest;
        try {
            digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw));
            String name = "invoice_" + digest.substring(0, 24) + ".bin";
            Files.write(filesDir().resolve(name), raw);
            return db.tx(() -> {
                if (db.one("SELECT 1 FROM receipts WHERE id=?", rid) == null) {
                    throw new ApiException("NOT_FOUND", 404);
                }
                long fid = db.insert(
                        "INSERT INTO files(kind, mime, bytes, sha256, path, created_by, created_at) VALUES('invoice',?,?,?,?,?,?)",
                        mime, raw.length, digest, name, u.getId(), Times.stamp()
                );
                db.exec("UPDATE receipts SET invoice_file_id=? WHERE id=?", fid, rid);
                db.audit(u.getId(), "INVOICE_FILE_ATTACHED", "receipt:" + rid, mime + ", sha256 " + digest.substring(0, 12) + "…");
                return Map.of("id", fid);
            });
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @GetMapping("/inward/{rid}/invoice-file")
    public ResponseEntity<byte[]> getInvoiceFile(@PathVariable long rid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "invoice.file");
        Map<String, Object> f = db.one("SELECT f.* FROM receipts r JOIN files f ON f.id=r.invoice_file_id WHERE r.id=?", rid);
        if (f == null) {
            throw new ApiException("NOT_FOUND", 404);
        }
        try {
            byte[] bytes = Files.readAllBytes(filesDir().resolve((String) f.get("path")));
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType((String) f.get("mime")))
                    .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=receipt-" + rid + "-invoice")
                    .body(bytes);
        } catch (Exception e) {
            throw new ApiException("NOT_FOUND", 404);
        }
    }

    @GetMapping("/inventory")
    public List<Map<String, Object>> inventory(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "inventory.view", "roast.execute");
        boolean keepEmpty = "1".equals(req.getParameter("keep_empty")) || "true".equalsIgnoreCase(req.getParameter("keep_empty"));
        return ledger.stockRows(keepEmpty, null);
    }

    @PostMapping("/lots/{lid}/verify")
    public Map<String, Object> verifyQuarantined(@PathVariable long lid,
                                                 @RequestBody(required = false) Map<String, Object> d,
                                                 HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "inventory.verify_quarantine");
        Map<String, Object> body = d != null ? d : Map.of();
        double verified = ValidationUtils.number(body, "verified_kg", true);
        if (Math.abs(verified - ValidationUtils.r3(verified)) > 1e-7) {
            throw new ApiException("KG_NEEDS_3_DECIMAL_PRECISION");
        }
        String reason = ValidationUtils.text(body, "reason", 5, 300, "VERIFICATION_REASON_REQUIRED");
        return db.tx(() -> {
            Map<String, Object> lot = db.one(
                    "SELECT l.*, COALESCE(SUM(m.delta_kg),0) balance FROM lots l LEFT JOIN movements m ON m.lot_id=l.id " +
                    "WHERE l.id=? GROUP BY l.id",
                    lid
            );
            if (lot == null || !"QUARANTINE".equals(lot.get("status"))) {
                throw new ApiException("NOT_QUARANTINED_OR_ALREADY_VERIFIED");
            }
            double bal = ((Number) lot.get("balance")).doubleValue();
            if (verified > bal) {
                throw new ApiException("VERIFIED_EXCEEDS_NOMINAL");
            }
            double diff = ValidationUtils.r3(verified - bal);
            if (diff != 0.0) {
                db.exec("INSERT INTO movements(lot_id, delta_kg, action, source_id, actor_id, created_at) VALUES(?,?,?,?,?,?)",
                        lid, diff, "QUARANTINE_VERIFICATION_ADJUSTMENT", lid, u.getId(), Times.stamp());
            }
            db.exec("UPDATE lots SET status=? WHERE id=?", verified > 0 ? "RELEASED" : "REJECTED", lid);
            db.audit(u.getId(), "QUARANTINE_VERIFIED", "lot:" + lid,
                    "verified=" + verified + " kg, previous=" + bal + ", reason=" + reason);
            return Map.of("ok", true, "verified_kg", verified, "adjustment_kg", diff);
        });
    }

    @GetMapping("/roasts")
    public Object roasts(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "roast.view", "qc.view", "reports.operational");
        String month = req.getParameter("month");
        String day = req.getParameter("day");
        String cols = "SELECT r.id, r.code, r.output_lot_id, r.input_kg, r.output_kg, r.loss_kg, r.duration_min, " +
                "r.profile, r.notes, r.abnormal, r.qc_status, r.created_at, us.full_name roaster, " +
                "(SELECT GROUP_CONCAT(CONCAT(COALESCE(l.code, CONCAT('#', ri.lot_id)), ' ', COALESCE(m.name, l.name), ': ', " +
                " TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM ri.kg)), ' kg') SEPARATOR ' + ') " +
                " FROM roast_inputs ri JOIN lots l ON l.id=ri.lot_id LEFT JOIN masters m ON m.id=l.product_id " +
                " WHERE ri.roast_id=r.id) inputs " +
                "FROM roast_batches r LEFT JOIN users us ON us.id=r.created_by";

        if (month != null && !month.isBlank()) {
            YearMonth ym;
            try {
                ym = YearMonth.parse(month.trim());
            } catch (Exception e) {
                throw new ApiException("INVALID_DATE");
            }
            String lo = Times.istDayBounds(ym.atDay(1).toString())[0];
            String hi = Times.istDayBounds(ym.atEndOfMonth().toString())[1];
            Map<String, Map<String, Object>> days = new LinkedHashMap<>();
            for (Map<String, Object> r : db.rows("SELECT created_at, input_kg, output_kg FROM roast_batches WHERE created_at>=? AND created_at<?", lo, hi)) {
                Instant inst = Times.parse((String) r.get("created_at"));
                String dStr = inst.atZone(Times.IST_OFFSET).toLocalDate().toString();
                Map<String, Object> x = days.computeIfAbsent(dStr, k -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("batches", 0);
                    m.put("input_kg", 0.0);
                    m.put("output_kg", 0.0);
                    return m;
                });
                x.put("batches", ((Number) x.get("batches")).intValue() + 1);
                x.put("input_kg", ValidationUtils.r3(((Number) x.get("input_kg")).doubleValue() + ((Number) r.get("input_kg")).doubleValue()));
                x.put("output_kg", ValidationUtils.r3(((Number) x.get("output_kg")).doubleValue() + ((Number) r.get("output_kg")).doubleValue()));
            }
            return Map.of("month", ym.toString(), "days", days);
        }
        if (day != null && !day.isBlank()) {
            String[] bounds = Times.istDayBounds(day);
            return db.rows(cols + " WHERE r.created_at>=? AND r.created_at<? ORDER BY r.id", bounds[0], bounds[1]);
        }
        return db.rows(cols + " ORDER BY r.id DESC LIMIT 100");
    }

    @PostMapping("/roasts")
    @SuppressWarnings("unchecked")
    public Map<String, Object> postRoast(@RequestBody(required = false) Map<String, Object> d,
                                         HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "roast.execute");
        Map<String, Object> body = d != null ? d : Map.of();
        Object rawInputs = body.get("inputs");
        if (!(rawInputs instanceof List<?> inputList) || inputList.isEmpty() || inputList.size() > 2) {
            throw new ApiException("ROAST_NEEDS_1_OR_2_INPUTS");
        }
        Set<Long> seen = new LinkedHashSet<>();
        List<long[]> parsedIds = new ArrayList<>();
        List<Double> parsedKgs = new ArrayList<>();
        double sumKg = 0.0;
        for (Object item : inputList) {
            if (!(item instanceof Map<?, ?> xm)) {
                throw new ApiException("INVALID_INPUT_LOT");
            }
            long lid;
            try {
                lid = Long.parseLong(xm.get("lot_id").toString());
            } catch (Exception e) {
                throw new ApiException("INVALID_INPUT_LOT");
            }
            if (!seen.add(lid)) {
                throw new ApiException("DUPLICATE_INPUT_LOT");
            }
            double kg = ValidationUtils.number((Map<String, Object>) xm, "kg");
            if (ValidationUtils.r3(kg) <= 0 || Math.abs(kg - ValidationUtils.r3(kg)) > 1e-7) {
                throw new ApiException("INPUT_KG_NEEDS_3_DECIMAL_PRECISION");
            }
            parsedIds.add(new long[]{lid});
            parsedKgs.add(kg);
            sumKg += kg;
        }
        double total = ValidationUtils.r3(sumKg);
        double output = ValidationUtils.r3(ValidationUtils.number(body, "output_kg"));
        if (output <= 0 || output > total) {
            throw new ApiException("OUTPUT_EXCEEDS_INPUT_OR_ZERO");
        }
        int duration = ValidationUtils.integer(body, "duration_min", 1);
        boolean abnormal = Boolean.TRUE.equals(body.get("abnormal")) || Integer.valueOf(1).equals(body.get("abnormal"));
        String notes = body.get("notes") != null ? body.get("notes").toString().trim() : "";
        if (notes.length() > 400) notes = notes.substring(0, 400);
        String idemKey = req.getHeader("X-Idempotency-Key");
        String finalNotes = notes;

        return db.tx(() -> {
            Map<String, Object> prev = db.idemGet(u.getId(), "ROAST", idemKey);
            if (prev != null) {
                return prev;
            }
            Long profileId = null;
            String profile = "";
            if (body.get("profile_id") != null && !"".equals(body.get("profile_id"))) {
                profileId = Long.parseLong(body.get("profile_id").toString());
                Map<String, Object> p = db.one("SELECT name FROM roast_profiles WHERE id=? AND active=1", profileId);
                if (p == null) {
                    throw new ApiException("ROAST_PROFILE_NOT_FOUND");
                }
                profile = (String) p.get("name");
            } else if (db.one("SELECT 1 FROM roast_profiles WHERE active=1") != null) {
                throw new ApiException("CHOOSE_A_ROAST_PROFILE");
            }

            Set<Long> beanPids = new LinkedHashSet<>();
            for (int i = 0; i < parsedIds.size(); i++) {
                long lid = parsedIds.get(i)[0];
                double kg = parsedKgs.get(i);
                Map<String, Object> lot = db.one(
                        "SELECT l.*, ROUND(COALESCE(SUM(m.delta_kg),0),3) balance FROM lots l " +
                        "LEFT JOIN movements m ON m.lot_id=l.id WHERE l.id=? GROUP BY l.id",
                        lid
                );
                if (lot == null || !"RAW".equals(lot.get("stage")) || !"RELEASED".equals(lot.get("status")) || !"VTC".equals(lot.get("owner"))) {
                    throw new ApiException("RAW_LOT_NOT_ALLOCATABLE");
                }
                if (!LedgerService.PROD.equals(lot.get("location"))) {
                    throw new ApiException("LOT_WRONG_LOCATION");
                }
                if (ledger.available(lid) + 1e-5 < kg) {
                    throw new ApiException("INSUFFICIENT_RAW_STOCK");
                }
                Object bp = lot.get("bean_id") != null ? lot.get("bean_id") : lot.get("product_id");
                beanPids.add(bp != null ? ((Number) bp).longValue() : null);
            }

            Map<String, String> cfg = new LinkedHashMap<>();
            for (Map<String, Object> cr : db.rows("SELECT `key`, `value` FROM config")) {
                cfg.put((String) cr.get("key"), (String) cr.get("value"));
            }
            double pct = (total - output) / total * 100.0;
            boolean auto = cfg.containsKey("roast_loss_min_pct") && cfg.containsKey("roast_loss_max_pct")
                    && "true".equals(cfg.get("roast_checks_approved")) && !abnormal
                    && pct >= Double.parseDouble(cfg.get("roast_loss_min_pct"))
                    && pct <= Double.parseDouble(cfg.get("roast_loss_max_pct"));
            String qc = auto ? "RELEASED" : "QC_HOLD";
            String now = Times.stamp();

            long rid = db.insert(
                    "INSERT INTO roast_batches(input_kg, output_kg, loss_kg, duration_min, profile, notes, abnormal, qc_status, created_by, created_at, profile_id) " +
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    total, output, ValidationUtils.r3(total - output), duration, profile, finalNotes, abnormal ? 1 : 0, qc,
                    u.getId(), now, profileId
            );
            worktasks.bump(u.getId(), "ROAST", 1, null);
            for (int i = 0; i < parsedIds.size(); i++) {
                long lid = parsedIds.get(i)[0];
                double kg = parsedKgs.get(i);
                db.exec("INSERT INTO roast_inputs(roast_id, lot_id, kg) VALUES(?,?,?)", rid, lid, kg);
                db.exec("INSERT INTO movements(lot_id, delta_kg, action, source_id, actor_id, created_at) VALUES(?,?,?,?,?,?)",
                        lid, -kg, "ROAST_INPUT", rid, u.getId(), now);
            }
            Long singleBean = beanPids.size() == 1 ? beanPids.iterator().next() : null;
            long outId = ledger.newLot("Roasted batch #" + rid, "ROASTED", qc, "VTC", LedgerService.PROD,
                    null, null, rid, null, null, null, singleBean, null, Times.isoDayIst());
            String rbCode = db.val(String.class, "SELECT code FROM lots WHERE id=?", outId);
            db.exec("UPDATE roast_batches SET code=?, output_lot_id=? WHERE id=?", rbCode, outId, rid);
            db.exec("INSERT INTO movements(lot_id, delta_kg, action, source_id, actor_id, created_at) VALUES(?,?,?,?,?,?)",
                    outId, output, "ROAST_OUTPUT", rid, u.getId(), now);
            double lossPct = Math.round(pct * 100.0) / 100.0;
            db.audit(u.getId(), "ROAST_COMPLETED", "roast:" + rid, "loss=" + lossPct + "%, QC=" + qc);
            if ("QC_HOLD".equals(qc)) {
                alerts.notifyPerm("roast.qc_release", abnormal ? "high" : "normal",
                        "Roast batch #" + rid + " waiting for quality decision",
                        total + " kg in → " + output + " kg out (" + (Math.round(pct * 10.0) / 10.0) + "% loss)" + (abnormal ? " · flagged abnormal" : ""),
                        "qc", "roast", rid, null, u.getId());
            }
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("id", rid);
            res.put("code", rbCode);
            res.put("lot_id", outId);
            res.put("input_kg", total);
            res.put("output_kg", output);
            res.put("loss_pct", lossPct);
            res.put("qc_status", qc);
            db.idemSave(u.getId(), "ROAST", idemKey, res);
            return res;
        });
    }

    @GetMapping("/qc")
    public List<Map<String, Object>> qcList(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "qc.view", "exceptions.view");
        return db.rows("SELECT id, code, input_kg, output_kg, loss_kg, abnormal, qc_status, created_at FROM roast_batches ORDER BY id DESC LIMIT 100");
    }

    @PostMapping("/qc/{rid}/decision")
    public Map<String, Object> qcDecide(@PathVariable long rid,
                                        @RequestBody(required = false) Map<String, Object> d,
                                        HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "roast.qc_release");
        Map<String, Object> body = d != null ? d : Map.of();
        String decision = body.get("decision") != null ? body.get("decision").toString() : "";
        String note = body.get("note") != null ? body.get("note").toString().trim() : "";
        if (!List.of("RELEASED", "REJECTED").contains(decision) || note.length() < 2) {
            throw new ApiException("QC_DECISION_AND_NOTE_REQUIRED");
        }
        db.txVoid(() -> {
            Map<String, Object> r = db.one("SELECT qc_status, output_lot_id FROM roast_batches WHERE id=?", rid);
            if (r == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            if (!"QC_HOLD".equals(r.get("qc_status"))) {
                throw new ApiException("QC_ALREADY_DECIDED");
            }
            db.exec("UPDATE roast_batches SET qc_status=? WHERE id=?", decision, rid);
            db.exec("UPDATE lots SET status=? WHERE id=?", decision, r.get("output_lot_id"));
            db.exec("INSERT INTO qc_events(roast_id, decision, note, user_id, created_at) VALUES(?,?,?,?,?)",
                    rid, decision, note, u.getId(), Times.stamp());
            worktasks.bump(u.getId(), "QC", 1, null);
            db.audit(u.getId(), "QC_DECISION", "roast:" + rid, decision + ": " + note);
        });
        return Map.of("ok", true);
    }

    @GetMapping("/qc/config")
    public Map<String, Object> qcConfig(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "qc.configure", "system.settings");
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map<String, Object> r : db.rows("SELECT `key`, `value` FROM config")) {
            out.put((String) r.get("key"), r.get("value"));
        }
        return out;
    }

    @PutMapping("/qc/config")
    public Map<String, Object> setQcConfig(@RequestBody(required = false) Map<String, Object> d,
                                           HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "qc.configure");
        Map<String, Object> body = d != null ? d : Map.of();
        db.txVoid(() -> {
            if (Boolean.TRUE.equals(body.get("clear"))) {
                db.exec("DELETE FROM config WHERE `key` IN ('roast_loss_min_pct','roast_loss_max_pct','roast_checks_approved')");
                db.audit(u.getId(), "ROAST_QC_CONFIG_CLEARED", "config", "", "access");
                return;
            }
            double low = ValidationUtils.number(body, "min_pct", true);
            double high = ValidationUtils.number(body, "max_pct", true);
            if (low > high || high > 100) {
                throw new ApiException("INVALID_QC_RANGE");
            }
            String now = Times.stamp();
            Map<String, String> vals = Map.of(
                    "roast_loss_min_pct", Double.toString(low),
                    "roast_loss_max_pct", Double.toString(high),
                    "roast_checks_approved", Boolean.TRUE.equals(body.get("checks_approved")) ? "true" : "false"
            );
            for (Map.Entry<String, String> e : vals.entrySet()) {
                db.exec("INSERT INTO config(`key`, `value`, changed_by, changed_at) VALUES(?,?,?,?) " +
                        "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), changed_by=VALUES(changed_by), changed_at=VALUES(changed_at)",
                        e.getKey(), e.getValue(), u.getId(), now);
            }
            db.audit(u.getId(), "ROAST_QC_CONFIG_CHANGED", "config", low + "–" + high + "% loss", "access");
        });
        return Map.of("ok", true);
    }

    private static final String TASK_COLS =
            "SELECT t.*, us.full_name assignee, cr.full_name assigned_by, rv.full_name reviewed_by_name FROM tasks t " +
            "LEFT JOIN users us ON us.id=t.assigned_to LEFT JOIN users cr ON cr.id=t.created_by " +
            "LEFT JOIN users rv ON rv.id=t.reviewed_by";
    private static final String TASK_ORDER =
            " ORDER BY CASE t.status WHEN 'SUBMITTED' THEN 0 WHEN 'BLOCKED' THEN 1 WHEN 'IN_PROGRESS' THEN 2 " +
            "WHEN 'OPEN' THEN 3 ELSE 4 END, COALESCE(t.due,'9999-12-31'), t.id DESC";

    private Map<String, Object> taskOut(CurrentUser u, Map<String, Object> t) {
        WorktasksService.KindSpec ks = WorktasksService.KINDS.getOrDefault(
                (String) t.get("kind"), WorktasksService.KINDS.get("GENERAL")
        );
        t.put("kind_label", ks.label());
        t.put("unit", ks.unit());
        t.put("may_review", "SUBMITTED".equals(t.get("status")) && worktasks.reviewers(t).contains(u.getId()));
        return t;
    }

    @GetMapping("/tasks")
    public List<Map<String, Object>> tasks(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "tasks.view_own", "tasks.view_all");
        List<Map<String, Object>> rows;
        if (u.can("tasks.view_all")) {
            rows = db.rows(TASK_COLS + TASK_ORDER);
        } else {
            rows = db.rows(TASK_COLS + " WHERE t.assigned_to=? OR t.created_by=?" + TASK_ORDER, u.getId(), u.getId());
        }
        for (Map<String, Object> r : rows) {
            taskOut(u, r);
        }
        return rows;
    }

    @GetMapping("/tasks/options")
    public Map<String, Object> taskOptions(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "tasks.assign");
        List<Map<String, Object>> people = new ArrayList<>();
        for (Map<String, Object> p : db.rows(
                "SELECT u.id, u.full_name, r.name role_name FROM users u JOIN roles r ON r.id=u.role_id " +
                "WHERE u.active=1 AND r.active=1 ORDER BY u.full_name")) {
            long pid = ((Number) p.get("id")).longValue();
            CurrentUser full = permissionService.loadUser(pid);
            List<String> canList = new ArrayList<>();
            for (Map.Entry<String, WorktasksService.KindSpec> e : WorktasksService.KINDS.entrySet()) {
                String reqPerm = e.getValue().requiredPerm();
                if (reqPerm == null || (full != null && full.can(reqPerm))) {
                    canList.add(e.getKey());
                }
            }
            p.put("can", canList);
            people.add(p);
        }
        List<Map<String, Object>> packs = db.rows(
                "SELECT id, product_name, packs_target, packs_done, pack_g FROM pack_jobs WHERE state!='COMPLETE' ORDER BY id DESC"
        );
        List<Map<String, Object>> orders = db.rows(
                "SELECT o.id, o.item, o.quantity_kg, o.dispatched_kg, m.name customer FROM orders o JOIN masters m " +
                "ON m.id=o.customer_id WHERE o.state IN ('CONFIRMED','RESERVED') ORDER BY o.id DESC"
        );
        List<Map<String, String>> kinds = new ArrayList<>();
        for (Map.Entry<String, WorktasksService.KindSpec> e : WorktasksService.KINDS.entrySet()) {
            kinds.add(Map.of("key", e.getKey(), "label", e.getValue().label(), "unit", e.getValue().unit()));
        }
        return Map.of("kinds", kinds, "people", people, "pack_jobs", packs, "orders", orders);
    }

    @GetMapping("/people")
    public List<Map<String, Object>> peopleForAssignment(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "tasks.assign");
        return db.rows("SELECT u.id, u.full_name, r.name role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 ORDER BY u.full_name");
    }

    @PostMapping("/tasks")
    public Map<String, Object> newTask(@RequestBody(required = false) Map<String, Object> d,
                                       HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "tasks.assign");
        Map<String, Object> body = d != null ? d : Map.of();
        String kind = (body.get("kind") != null && !"".equals(body.get("kind"))) ? body.get("kind").toString() : "GENERAL";
        if (!WorktasksService.KINDS.containsKey(kind)) {
            throw new ApiException("INVALID_WORK_TYPE");
        }
        WorktasksService.KindSpec ks = WorktasksService.KINDS.get(kind);
        String title;
        Double target;
        if ("GENERAL".equals(kind)) {
            title = ValidationUtils.text(body, "title", 3, 120, "TASK_TITLE_REQUIRED");
            target = (body.get("target") == null || "".equals(body.get("target"))) ? null : ValidationUtils.number(body, "target");
        } else {
            int tInt = ValidationUtils.integer(body, "target", 1);
            target = (double) tInt;
            title = body.get("title") != null ? body.get("title").toString().trim() : "";
            if (title.length() > 120) title = title.substring(0, 120);
        }
        Long assigned = (body.get("assigned_to") != null && !"".equals(body.get("assigned_to")))
                ? Long.parseLong(body.get("assigned_to").toString())
                : null;
        if (!"GENERAL".equals(kind) && assigned == null) {
            throw new ApiException("CHOOSE_WHO_DOES_IT");
        }
        String due = (body.get("due") != null && !"".equals(body.get("due"))) ? body.get("due").toString() : null;
        if (due != null) {
            Times.istDayBounds(due);
        }
        Long refId = (body.get("ref_id") != null && !"".equals(body.get("ref_id")))
                ? Long.parseLong(body.get("ref_id").toString())
                : null;
        String initTitle = title;

        return db.tx(() -> {
            if (assigned != null) {
                CurrentUser who = permissionService.loadUser(assigned);
                if (who == null) {
                    throw new ApiException("BAD_ASSIGNEE");
                }
                if (ks.requiredPerm() != null && !who.can(ks.requiredPerm())) {
                    throw new ApiException("ASSIGNEE_CANNOT_DO_THIS_WORK");
                }
            }
            String refName = "";
            if (refId != null) {
                if (ks.refTable() == null) {
                    throw new ApiException("INVALID_LINK");
                }
                Map<String, Object> r = db.one("SELECT * FROM " + ks.refTable() + " WHERE id=?", refId);
                if (r == null) {
                    throw new ApiException("INVALID_LINK");
                }
                refName = "PACK".equals(kind) ? (" — ticket #" + refId + " " + r.get("product_name")) : (" — order #" + refId);
            }
            String finalTitle = initTitle;
            if (finalTitle.isEmpty()) {
                int tgtInt = target != null ? target.intValue() : 1;
                finalTitle = switch (kind) {
                    case "ROAST" -> "Roast " + tgtInt + " batches";
                    case "PACK" -> "Pack " + tgtInt + " packs";
                    case "QC" -> "Make " + tgtInt + " quality decisions";
                    case "OUTSIDE" -> "Roast " + tgtInt + " outside jobs";
                    case "COUNTER" -> "Handle " + tgtInt + " counter bills";
                    case "DISPATCH" -> "Dispatch " + tgtInt + " order" + (tgtInt > 1 ? "s" : "");
                    case "INWARD" -> "Receive " + tgtInt + " bags";
                    case "BLEND" -> "Do " + tgtInt + " blending / grinding jobs";
                    case "ORDERS" -> "Confirm " + tgtInt + " customer order" + (tgtInt > 1 ? "s" : "");
                    case "COUNT" -> "Count " + tgtInt + " stock lots";
                    default -> "Work";
                } + refName;
            }
            long tid = db.insert(
                    "INSERT INTO tasks(title, assigned_to, target, created_by, created_at, due, kind, ref_id) VALUES(?,?,?,?,?,?,?,?)",
                    finalTitle, assigned, target, u.getId(), Times.stamp(), due, kind, refId
            );
            db.audit(u.getId(), "TASK_CREATED", "task:" + tid, ks.label() + ": " + finalTitle);
            if (assigned != null) {
                alerts.notify(List.of(assigned), "normal", "New work: " + finalTitle,
                        due != null ? ("Due " + due) : "", "tasks", "task", tid, null, u.getId());
            }
            return Map.of("id", tid);
        });
    }

    @PutMapping("/tasks/{tid}")
    public Map<String, Object> updateTask(@PathVariable long tid,
                                          @RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        db.txVoid(() -> {
            Map<String, Object> row = db.one("SELECT * FROM tasks WHERE id=?", tid);
            if (row == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            Long assignedTo = row.get("assigned_to") != null ? ((Number) row.get("assigned_to")).longValue() : null;
            if (!(u.can("tasks.update_any") || (u.can("tasks.update_own") && assignedTo != null && assignedTo == u.getId()))) {
                throw new ApiException("ACCESS_DENIED", 403);
            }
            if (List.of("SUBMITTED", "DONE").contains(row.get("status"))) {
                throw new ApiException("TASK_ALREADY_SUBMITTED");
            }
            String status = (body.get("status") != null && !"".equals(body.get("status")))
                    ? body.get("status").toString()
                    : "IN_PROGRESS";
            if (!List.of("IN_PROGRESS", "BLOCKED").contains(status)) {
                throw new ApiException("INVALID_STATUS");
            }
            double progress = row.get("progress") instanceof Number n ? n.doubleValue() : 0.0;
            if ("GENERAL".equals(row.get("kind")) && body.containsKey("progress")) {
                progress = ValidationUtils.number(body, "progress", true);
                if (row.get("target") != null && progress > ((Number) row.get("target")).doubleValue()) {
                    throw new ApiException("PROGRESS_EXCEEDS_TARGET");
                }
            }
            db.exec("UPDATE tasks SET progress=?, status=? WHERE id=?", progress, status, tid);
            db.audit(u.getId(), "TASK_UPDATED", "task:" + tid, "progress=" + progress + ", status=" + status);
            if ("BLOCKED".equals(status) && !"BLOCKED".equals(row.get("status"))) {
                Long boss = alerts.bossOf(u.getId());
                List<Long> recipients = new ArrayList<>();
                recipients.add(((Number) row.get("created_by")).longValue());
                if (boss != null) {
                    recipients.add(boss);
                } else {
                    recipients.addAll(alerts.usersWith("tasks.update_any"));
                }
                alerts.notify(recipients, "high", "Stuck: " + row.get("title"),
                        u.getFullName() + " needs help.", "tasks", "task", tid, null, u.getId());
            }
        });
        return Map.of("ok", true);
    }

    @PostMapping("/tasks/{tid}/submit")
    public Map<String, Object> submitTask(@PathVariable long tid,
                                          @RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        String note = body.get("note") != null ? body.get("note").toString().trim() : "";
        if (note.length() > 300) note = note.substring(0, 300);
        String finalNote = note;
        db.txVoid(() -> {
            Map<String, Object> row = db.one("SELECT * FROM tasks WHERE id=?", tid);
            if (row == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            Long assignedTo = row.get("assigned_to") != null ? ((Number) row.get("assigned_to")).longValue() : null;
            if (assignedTo == null || assignedTo != u.getId()) {
                throw new ApiException("ONLY_THE_ASSIGNED_PERSON_CAN_COMPLETE", 403);
            }
            if (!WorktasksService.OPEN_STATES.contains(row.get("status"))) {
                throw new ApiException("TASK_ALREADY_SUBMITTED");
            }
            double prog = row.get("progress") instanceof Number n ? n.doubleValue() : 0.0;
            Double tgt = row.get("target") instanceof Number n ? n.doubleValue() : null;
            if (tgt != null && prog < tgt && finalNote.length() < 5) {
                throw new ApiException("EXPLAIN_WHY_TARGET_NOT_REACHED");
            }
            db.exec("UPDATE tasks SET status='SUBMITTED', submitted_at=?, submit_note=? WHERE id=?",
                    Times.stamp(), finalNote, tid);
            db.audit(u.getId(), "TASK_SUBMITTED", "task:" + tid, "progress=" + prog + "/" + tgt + "; " + finalNote);
            List<Long> who = worktasks.reviewers(row);
            if (who.isEmpty()) {
                throw new ApiException("NO_ONE_CAN_REVIEW_THIS");
            }
            alerts.notify(who, "normal", "Please review: " + row.get("title"),
                    u.getFullName() + " marked it completed.", "tasks", "task", tid, null, u.getId());
        });
        return Map.of("ok", true);
    }

    @PostMapping("/tasks/{tid}/review")
    public Map<String, Object> reviewTask(@PathVariable long tid,
                                          @RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = Boolean.TRUE.equals(body.get("approve"));
        String note = body.get("note") != null ? body.get("note").toString().trim() : "";
        if (note.length() > 300) note = note.substring(0, 300);
        if (!approve && note.length() < 5) {
            throw new ApiException("REASON_REQUIRED");
        }
        String finalNote = note;
        db.txVoid(() -> {
            Map<String, Object> row = db.one("SELECT * FROM tasks WHERE id=?", tid);
            if (row == null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            if (!"SUBMITTED".equals(row.get("status"))) {
                throw new ApiException("NOT_WAITING_FOR_REVIEW");
            }
            Long assignedTo = row.get("assigned_to") != null ? ((Number) row.get("assigned_to")).longValue() : null;
            if (assignedTo != null && u.getId() == assignedTo) {
                throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);
            }
            if (!worktasks.reviewers(row).contains(u.getId())) {
                throw new ApiException("ONLY_THE_ASSIGNER_REVIEWS_THIS", 403);
            }
            db.exec("UPDATE tasks SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?",
                    approve ? "DONE" : "IN_PROGRESS", u.getId(), Times.stamp(), finalNote, tid);
            db.audit(u.getId(), approve ? "TASK_APPROVED" : "TASK_SENT_BACK", "task:" + tid, finalNote);
            if (assignedTo != null) {
                alerts.notify(List.of(assignedTo), approve ? "normal" : "high",
                        (approve ? "Approved" : "Sent back") + ": " + row.get("title"),
                        finalNote, "tasks", "task", tid, null, null);
            }
        });
        return Map.of("ok", true);
    }
}
