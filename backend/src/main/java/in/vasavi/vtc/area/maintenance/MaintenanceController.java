package in.vasavi.vtc.area.maintenance;

import in.vasavi.vtc.common.AlertsService;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/v1")
public class MaintenanceController {

    private static final Set<String> AREAS = Set.of(
            "ROASTER", "GRINDER", "PACKING_MACHINE", "SCALE", "PRINTER", "GAS", "ELECTRICAL", "BUILDING", "VEHICLE", "OTHER"
    );
    private static final Set<String> URGENCY = Set.of("LOW", "NORMAL", "URGENT");
    private static final Set<String> STATES = Set.of("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED");

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final AlertsService alertsService;

    public MaintenanceController(Db db, SessionService sessionService, PermissionService permissionService, AlertsService alertsService) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.alertsService = alertsService;
    }

    @GetMapping("/maintenance")
    public List<Map<String, Object>> tickets(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "maintenance.raise", "maintenance.manage");

        String q = "SELECT t.*, a.full_name raised_by_name, b.full_name assigned_name, r.full_name resolved_by_name FROM maintenance t " +
                "JOIN users a ON a.id=t.raised_by LEFT JOIN users b ON b.id=t.assigned_to LEFT JOIN users r ON r.id=t.resolved_by";
        String order = " ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, " +
                "CASE t.urgency WHEN 'URGENT' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END, t.id DESC";

        if (u.can("maintenance.manage")) {
            return db.rows(q + order);
        }
        return db.rows(q + " WHERE t.raised_by=? OR t.assigned_to=?" + order, u.getId(), u.getId());
    }

    @PostMapping("/maintenance")
    public Map<String, Object> raiseTicket(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "maintenance.raise");
        Map<String, Object> body = d != null ? d : Map.of();

        String title = ValidationUtils.text(body, "title", 3, 120, "TICKET_TITLE_REQUIRED");
        String area = (String) body.get("area");
        String urgency = body.getOrDefault("urgency", "NORMAL").toString();

        if (!AREAS.contains(area) || !URGENCY.contains(urgency)) {
            throw new ApiException("INVALID_TICKET");
        }

        String details = body.get("details") != null ? body.get("details").toString().trim() : "";
        if (details.length() > 1000) {
            details = details.substring(0, 1000);
        }

        final String finalDetails = details;
        return db.tx(() -> {
            String now = Times.stamp();
            long tid = db.insert("INSERT INTO maintenance(title, area, details, urgency, raised_by, created_at, updated_at) " +
                    "VALUES(?,?,?,?,?,?,?)", title, area, finalDetails, urgency, u.getId(), now, now);

            List<Long> managers = alertsService.usersWith("maintenance.manage");
            Long boss = alertsService.bossOf(u.getId());
            boss = (boss != null && managers.contains(boss)) ? boss : null;

            if (boss != null) {
                db.exec("UPDATE maintenance SET assigned_to=? WHERE id=?", boss, tid);
            }

            db.audit(u.getId(), "MAINTENANCE_RAISED", "maintenance:" + tid, urgency + " " + area + ": " + title);
            List<Long> to = (boss != null && !"URGENT".equals(urgency)) ? List.of(boss) : managers;
            String sev = "URGENT".equals(urgency) ? "critical" : ("NORMAL".equals(urgency) ? "high" : "normal");
            alertsService.notify(to, sev, "Maintenance: " + title,
                    u.getFullName() + " · " + area.replace('_', ' ').toLowerCase(),
                    "maintenance", "maintenance", tid, null, u.getId());

            return Map.of("id", tid);
        });
    }

    @PutMapping("/maintenance/{tid}")
    public Map<String, Object> updateTicket(@PathVariable long tid,
                                            @RequestBody(required = false) Map<String, Object> d,
                                            HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "maintenance.manage");
        Map<String, Object> body = d != null ? d : Map.of();

        String status = (String) body.get("status");
        if (!STATES.contains(status)) {
            throw new ApiException("INVALID_STATUS");
        }

        String note = body.get("note") != null ? body.get("note").toString().trim() : "";
        if (note.length() > 500) {
            note = note.substring(0, 500);
        }

        if (("RESOLVED".equals(status) || "CLOSED".equals(status)) && note.length() < 3) {
            throw new ApiException("SAY_WHAT_WAS_DONE");
        }

        final String finalNote = note;
        return db.tx(() -> {
            Map<String, Object> t = db.one("SELECT * FROM maintenance WHERE id=?", tid);
            if (t == null) {
                throw new ApiException("NOT_FOUND", 404);
            }

            Long assigned = null;
            if (body.get("assigned_to") != null && !"".equals(body.get("assigned_to"))) {
                assigned = ((Number) body.get("assigned_to")).longValue();
            } else if (t.get("assigned_to") != null) {
                assigned = ((Number) t.get("assigned_to")).longValue();
            }

            if (assigned != null) {
                Map<String, Object> uRow = db.one("SELECT 1 FROM users WHERE id=? AND active=1", assigned);
                if (uRow == null) {
                    throw new ApiException("BAD_ASSIGNEE");
                }
            }

            boolean done = "RESOLVED".equals(status) || "CLOSED".equals(status);
            Long resolvedBy = done ? Long.valueOf(u.getId()) : (t.get("resolved_by") != null ? ((Number) t.get("resolved_by")).longValue() : null);

            db.exec("UPDATE maintenance SET status=?, assigned_to=?, resolution=CASE WHEN ? != '' THEN ? ELSE resolution END, " +
                    "resolved_by=?, updated_at=? WHERE id=?", status, assigned, finalNote, finalNote, resolvedBy, Times.stamp(), tid);

            db.audit(u.getId(), "MAINTENANCE_" + status, "maintenance:" + tid, finalNote);

            long raisedBy = ((Number) t.get("raised_by")).longValue();
            Long oldAssigned = t.get("assigned_to") != null ? ((Number) t.get("assigned_to")).longValue() : null;

            List<Long> to = new java.util.ArrayList<>(List.of(raisedBy));
            if (assigned != null && !assigned.equals(oldAssigned)) {
                to.add(assigned);
            }

            alertsService.notify(to, "normal", "Maintenance " + status.replace('_', ' ').toLowerCase() + ": " + t.get("title"),
                    finalNote, "maintenance", "maintenance", tid, null, u.getId());

            return Map.of("ok", true);
        });
    }
}
