package in.vasavi.vtc.common;

import in.vasavi.vtc.db.Db;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class WorktasksService {

    public record KindSpec(String label, String unit, String requiredPerm, String refTable) {}

    public static final Map<String, KindSpec> KINDS = new LinkedHashMap<>();
    static {
        KINDS.put("GENERAL", new KindSpec("General work", "", null, null));
        KINDS.put("ROAST", new KindSpec("Roasting", "batches", "roast.execute", null));
        KINDS.put("PACK", new KindSpec("Packing", "packs", "pack.execute", "pack_jobs"));
        KINDS.put("QC", new KindSpec("Quality control", "decisions", "roast.qc_release", null));
        KINDS.put("OUTSIDE", new KindSpec("Outside roasting", "jobs roasted", "outside.execute", null));
        KINDS.put("COUNTER", new KindSpec("Counter sales", "bills", "counter.sell", null));
        KINDS.put("DISPATCH", new KindSpec("Dispatch", "dispatches", "dispatch.handover", "orders"));
        KINDS.put("INWARD", new KindSpec("Stock inward", "bags received", "goods.receive", null));
        KINDS.put("BLEND", new KindSpec("Blending & grinding", "jobs", "grind.execute", null));
        KINDS.put("ORDERS", new KindSpec("Outgoing sales", "orders confirmed", "outgoing.create", null));
        KINDS.put("COUNT", new KindSpec("Stock counts", "lots counted", "stock.cycle_count", null));
    }

    public static final Set<String> OPEN_STATES = Set.of("OPEN", "IN_PROGRESS", "BLOCKED");

    private final Db db;
    private final AlertsService alerts;

    public WorktasksService(Db db, AlertsService alerts) {
        this.db = db;
        this.alerts = alerts;
    }

    public void bump(long userId, String kind, double amount, Long refId) {
        List<Map<String, Object>> rows = db.rows(
                "SELECT id, target, progress FROM tasks WHERE assigned_to=? AND kind=? " +
                "AND status IN ('OPEN','IN_PROGRESS','BLOCKED') AND (ref_id IS NULL OR ref_id=?) " +
                "ORDER BY CASE WHEN ref_id IS NULL THEN 1 ELSE 0 END, id",
                userId, kind, refId
        );
        if (rows.isEmpty()) {
            return;
        }
        Map<String, Object> pick = rows.get(0);
        for (Map<String, Object> r : rows) {
            Object tgt = r.get("target");
            double prog = r.get("progress") instanceof Number n ? n.doubleValue() : 0.0;
            if (tgt == null || prog < ((Number) tgt).doubleValue()) {
                pick = r;
                break;
            }
        }
        long pickId = ((Number) pick.get("id")).longValue();
        db.exec("UPDATE tasks SET progress=progress+?, status=CASE WHEN status='OPEN' THEN 'IN_PROGRESS' ELSE status END WHERE id=?",
                amount, pickId);
        Map<String, Object> t = db.one("SELECT * FROM tasks WHERE id=?", pickId);
        if (t != null && t.get("target") != null) {
            double tgt = ((Number) t.get("target")).doubleValue();
            double prog = ((Number) t.get("progress")).doubleValue();
            if (prog >= tgt && prog - amount < tgt) {
                alerts.notify(List.of(userId), "normal", "Target reached: " + t.get("title"),
                        "Mark it completed so it can be reviewed.", "tasks", "task", pickId, null, null);
            }
        }
    }

    public List<Long> reviewers(Map<String, Object> task) {
        long createdBy = ((Number) task.get("created_by")).longValue();
        Long assignedTo = task.get("assigned_to") != null ? ((Number) task.get("assigned_to")).longValue() : null;
        Map<String, Object> creator = db.one("SELECT active FROM users WHERE id=?", createdBy);
        boolean creatorActive = creator != null && creator.get("active") instanceof Number n && n.intValue() != 0;
        if ((assignedTo == null || createdBy != assignedTo) && creatorActive) {
            return List.of(createdBy);
        }
        if (assignedTo != null) {
            Long boss = alerts.bossOf(assignedTo);
            List<Long> approvers = alerts.usersWith("tasks.approve");
            if (boss != null && approvers.contains(boss)) {
                return List.of(boss);
            }
            List<Long> out = new ArrayList<>();
            for (Long u : approvers) {
                if (!u.equals(assignedTo)) {
                    out.add(u);
                }
            }
            return out;
        }
        return alerts.usersWith("tasks.approve");
    }
}
