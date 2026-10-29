package in.vasavi.vtc.area.pending;

import in.vasavi.vtc.catalog.PermissionCatalog;
import in.vasavi.vtc.common.WorktasksService;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class PendingController {

    private static final Set<String> OPEN = Set.of("OPEN", "IN_PROGRESS", "BLOCKED");

    private static final Map<String, String> MODULE_OF = Map.ofEntries(
            Map.entry("GENERAL", "tasks"),
            Map.entry("ROAST", "roasting"),
            Map.entry("PACK", "packing"),
            Map.entry("QC", "qc"),
            Map.entry("OUTSIDE", "outside"),
            Map.entry("COUNTER", "counter"),
            Map.entry("DISPATCH", "dispatch"),
            Map.entry("INWARD", "inward"),
            Map.entry("BLEND", "blending"),
            Map.entry("ORDERS", "orders"),
            Map.entry("COUNT", "inventory")
    );

    private final Db db;
    private final SessionService sessionService;
    private final PermissionCatalog catalog;
    private final WorktasksService worktasksService;

    public PendingController(Db db, SessionService sessionService, PermissionCatalog catalog, WorktasksService worktasksService) {
        this.db = db;
        this.sessionService = sessionService;
        this.catalog = catalog;
        this.worktasksService = worktasksService;
    }

    private boolean isCleared(Map<String, Object> o) {
        boolean creditReq = o.get("credit_requested") != null && ((Number) o.get("credit_requested")).intValue() != 0;
        if (creditReq) {
            String note = (String) o.get("credit_note");
            return note != null && (note.startsWith("Within approved") || note.startsWith("Credit approved"));
        }
        double qty = ((Number) o.get("quantity_kg")).doubleValue();
        long price = o.get("price_per_kg_paise") != null ? ((Number) o.get("price_per_kg_paise")).longValue() : 0L;
        long gst = o.get("gst_rate_bp") != null ? ((Number) o.get("gst_rate_bp")).longValue() : 0L;
        long need = Math.round(qty * price * (1.0 + (gst / 10000.0)));
        long adv = o.get("advance_paise") != null ? ((Number) o.get("advance_paise")).longValue() : 0L;
        return adv >= need;
    }

    private Map<String, List<Map<String, Object>>> getWaiting(CurrentUser u) {
        long me = u.getId();
        Map<String, List<Map<String, Object>>> w = new LinkedHashMap<>();

        java.util.function.BiConsumer<String, Map<String, Object>> add = (mod, item) -> {
            int cnt = ((Number) item.get("count")).intValue();
            if (cnt > 0) {
                w.computeIfAbsent(mod, k -> new ArrayList<>()).add(item);
            }
        };

        if (u.can("roast.qc_release")) {
            long c = db.count("SELECT COUNT(*) FROM roast_batches WHERE qc_status='QC_HOLD'");
            add.accept("qc", Map.of("label", "roast batches waiting for a quality decision", "count", (int) c));
        }
        if (u.can("inventory.verify_quarantine")) {
            long c = db.count("SELECT COUNT(*) FROM lots WHERE status='QUARANTINE'");
            add.accept("inventory", Map.of("label", "damaged-bag lots to verify", "count", (int) c));
        }
        if (u.can("stock.cycle_approve")) {
            long c = db.count("SELECT COUNT(*) FROM cycle_counts WHERE state='PENDING' AND kind='COUNT' AND counted_by!=?", me);
            add.accept("inventory", Map.of("label", "stock count differences to decide", "count", (int) c));
        }
        if (u.can("inventory.approve_adjust")) {
            long c = db.count("SELECT COUNT(*) FROM cycle_counts WHERE state='PENDING' AND kind='ADJUST' AND counted_by!=?", me);
            add.accept("inventory", Map.of("label", "stock corrections to approve", "count", (int) c));
        }
        if (u.can("outside.execute")) {
            long c1 = db.count("SELECT COUNT(*) FROM outside_jobs WHERE state='RECEIVED'");
            add.accept("outside", Map.of("label", "customer coffee waiting to be roasted", "count", (int) c1));
            long c2 = db.count("SELECT COUNT(*) FROM outside_jobs WHERE state='ROASTED'");
            add.accept("outside", Map.of("label", "roasted customer coffee to hand back", "count", (int) c2));
        }
        if (u.can("pack.qa_approve")) {
            long c = db.count("SELECT COUNT(*) FROM lots WHERE stage='PACKED' AND status='QC_HOLD'");
            add.accept("packing", Map.of("label", "packed lots waiting for QA release", "count", (int) c));
        }
        if (u.can("pack.execute")) {
            long c = db.count("SELECT COUNT(*) FROM pack_jobs WHERE state IN ('DRAFT','IN_PROGRESS')");
            add.accept("packing", Map.of("label", "packing tickets not finished", "count", (int) c));
        }
        if (u.can("counter.sell")) {
            long c = db.count("SELECT COUNT(*) FROM transfers WHERE state='IN_TRANSIT' AND sent_by!=?", me);
            add.accept("counter", Map.of("label", "transfers from production to receive", "count", (int) c));
        }
        if (u.can("counter.refund")) {
            long c = db.count("SELECT COUNT(*) FROM counter_refunds WHERE state='REQUESTED' AND requested_by!=?", me);
            add.accept("counter", Map.of("label", "refunds to approve", "count", (int) c));
        }
        if (u.can("counter.close_approve")) {
            long c = db.count("SELECT COUNT(*) FROM cash_closes WHERE state='VARIANCE_REVIEW' AND submitted_by!=?", me);
            add.accept("counter", Map.of("label", "cash differences to decide", "count", (int) c));
        }
        if (u.can("outgoing.credit.approve")) {
            long c = db.count("SELECT COUNT(*) FROM orders WHERE state='CREDIT_REVIEW' AND created_by!=?", me);
            add.accept("orders", Map.of("label", "orders waiting for a credit decision", "count", (int) c));
        }
        if (u.can("outgoing.price_override")) {
            long c = db.count("SELECT COUNT(*) FROM orders WHERE state='DRAFT' AND price_per_kg_paise IS NULL");
            add.accept("orders", Map.of("label", "draft orders that need a price", "count", (int) c));
        }
        if (u.can("outgoing.create")) {
            long c = db.count("SELECT COUNT(*) FROM orders WHERE state='DRAFT' AND price_per_kg_paise IS NOT NULL");
            add.accept("orders", Map.of("label", "priced drafts to confirm", "count", (int) c));
        }
        if (u.can("finance.collection.verify")) {
            List<Map<String, Object>> rows = db.rows("SELECT * FROM orders WHERE credit_requested=0 AND state IN ('CONFIRMED','RESERVED') AND price_per_kg_paise IS NOT NULL");
            int payFirstNotCleared = 0;
            for (Map<String, Object> o : rows) {
                if (!isCleared(o)) {
                    payFirstNotCleared++;
                }
            }
            add.accept("orders", Map.of("label", "pay-first orders waiting for payment", "count", payFirstNotCleared));
            long c2 = db.count("SELECT COUNT(*) FROM collections WHERE state='RECORDED' AND recorded_by!=?", me);
            add.accept("finance", Map.of("label", "customer payments to verify", "count", (int) c2));
        }
        if (u.can("dispatch.handover")) {
            List<Map<String, Object>> rows = db.rows("SELECT * FROM orders WHERE state='RESERVED'");
            int ready = 0;
            for (Map<String, Object> o : rows) {
                if (isCleared(o)) {
                    ready++;
                }
            }
            add.accept("dispatch", Map.of("label", "orders ready to hand over", "count", ready));
            long c2 = db.count("SELECT COUNT(*) FROM dispatches WHERE delivered_at IS NULL");
            add.accept("dispatch", Map.of("label", "deliveries to confirm", "count", (int) c2));
        }
        if (u.can("supplier.pay.approve")) {
            long c = db.count("SELECT COUNT(*) FROM supplier_payments WHERE state='PENDING_APPROVAL' AND recorded_by!=?", me);
            add.accept("finance", Map.of("label", "supplier payments to approve", "count", (int) c));
        }
        if (u.can("invoice.reconcile")) {
            long c = db.count("SELECT COUNT(*) FROM receipts WHERE invoice_status='PENDING' AND reversed_at IS NULL");
            add.accept("finance", Map.of("label", "supplier invoices to match", "count", (int) c));
        }
        if (u.can("exceptions.view")) {
            long c = db.count("SELECT COUNT(*) FROM stock_cards WHERE low_alerted=1 AND hidden=0");
            add.accept("inventory", Map.of("label", "beans below their low-stock level", "count", (int) c));
        }
        if (u.can("maintenance.manage")) {
            long c = db.count("SELECT COUNT(*) FROM maintenance WHERE status IN ('OPEN','IN_PROGRESS')");
            add.accept("maintenance", Map.of("label", "maintenance tickets open", "count", (int) c));
        }
        if (u.can("masters.approve")) {
            long c = db.count("SELECT COUNT(*) FROM masters WHERE state='DRAFT'");
            add.accept("admin", Map.of("label", "suggested records to approve", "count", (int) c));
        }

        return w;
    }

    @GetMapping("/pending")
    public Map<String, Object> pending(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        long me = u.getId();
        boolean team = u.can("tasks.view_all");

        List<String> visible = new ArrayList<>();
        for (String m : catalog.getModuleMap().keySet()) {
            if (catalog.moduleVisible(m, u.getPerms())) {
                visible.add(m);
            }
        }

        String sql = "SELECT t.*, us.full_name assignee, cr.full_name assigned_by FROM tasks t " +
                "LEFT JOIN users us ON us.id=t.assigned_to LEFT JOIN users cr ON cr.id=t.created_by " +
                "WHERE t.status IN ('OPEN','IN_PROGRESS','BLOCKED','SUBMITTED') " +
                (team ? "" : "AND (t.assigned_to=? OR t.created_by=?) ") +
                "ORDER BY COALESCE(t.due,'9999'), t.id";

        List<Map<String, Object>> rows = team ? db.rows(sql) : db.rows(sql, me, me);
        for (Map<String, Object> t : rows) {
            String kind = (String) t.get("kind");
            WorktasksService.KindSpec spec = WorktasksService.KINDS.getOrDefault(kind, WorktasksService.KINDS.get("GENERAL"));
            t.put("kind_label", spec.label());
            t.put("unit", spec.unit());
            boolean mayReview = "SUBMITTED".equals(t.get("status")) && worktasksService.reviewers(t).contains(me);
            t.put("may_review", mayReview);
            Long assignedTo = t.get("assigned_to") != null ? ((Number) t.get("assigned_to")).longValue() : null;
            t.put("mine", assignedTo != null && assignedTo == me);
        }

        Map<String, List<Map<String, Object>>> waiting = getWaiting(u);
        if ("staff".equals(u.getTier())) {
            List<Map<String, Object>> ctrWait = waiting.getOrDefault("counter", List.of());
            List<Map<String, Object>> filtered = new ArrayList<>();
            for (Map<String, Object> x : ctrWait) {
                String lbl = (String) x.get("label");
                if (lbl != null && lbl.startsWith("transfers")) {
                    filtered.add(x);
                }
            }
            waiting = new LinkedHashMap<>();
            if (!filtered.isEmpty()) {
                waiting.put("counter", filtered);
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        for (String m : visible) {
            List<Map<String, Object>> tasks = new ArrayList<>();
            for (Map<String, Object> t : rows) {
                String mod = MODULE_OF.get(t.get("kind"));
                if ("tasks".equals(m)) {
                    boolean mine = Boolean.TRUE.equals(t.get("mine"));
                    boolean stOpen = OPEN.contains((String) t.get("status"));
                    boolean mayRev = Boolean.TRUE.equals(t.get("may_review"));
                    if ((mine && stOpen) || mayRev || "tasks".equals(mod)) {
                        tasks.add(t);
                    }
                } else if (Objects.equals(mod, m)) {
                    tasks.add(t);
                }
            }

            List<Map<String, Object>> waitList = waiting.getOrDefault(m, List.of());
            int n = 0;
            for (Map<String, Object> t : tasks) {
                String status = (String) t.get("status");
                boolean mine = Boolean.TRUE.equals(t.get("mine"));
                boolean mayRev = Boolean.TRUE.equals(t.get("may_review"));
                if ((OPEN.contains(status) && (mine || team)) || mayRev) {
                    n++;
                }
            }
            for (Map<String, Object> x : waitList) {
                n += ((Number) x.get("count")).intValue();
            }

            if (!tasks.isEmpty() || !waitList.isEmpty()) {
                out.put(m, Map.of("count", n, "tasks", tasks, "waiting", waitList));
            }
        }

        return out;
    }
}
