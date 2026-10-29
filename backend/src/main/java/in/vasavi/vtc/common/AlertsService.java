package in.vasavi.vtc.common;

import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import org.springframework.stereotype.Service;

import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

@Service
public class AlertsService {

    private final Db db;
    private final PermissionService permissionService;

    public AlertsService(Db db, PermissionService permissionService) {
        this.db = db;
        this.permissionService = permissionService;
    }

    public List<Long> usersWith(String perm) {
        List<Long> ids = new ArrayList<>();
        for (Map<String, Object> r : db.rows("SELECT id FROM users WHERE active=1")) {
            long uid = ((Number) r.get("id")).longValue();
            CurrentUser u = permissionService.loadUser(uid);
            if (u != null && u.can(perm)) {
                ids.add(uid);
            }
        }
        return ids;
    }

    private String visibleAt(String severity) {
        if ("critical".equals(severity)) {
            return Times.stamp();
        }
        ZonedDateTime now = Times.now().atZone(Times.IST_OFFSET);
        int start = ((Number) db.getSetting("quiet_start_hour")).intValue();
        int end = ((Number) db.getSetting("quiet_end_hour")).intValue();
        if (start == end) {
            return Times.stamp();
        }
        int hr = now.getHour();
        boolean inQuiet = start > end ? (hr >= start || hr < end) : (hr >= start && hr < end);
        if (!inQuiet) {
            return Times.stamp();
        }
        ZonedDateTime morning = now.withHour(end).withMinute(0).withSecond(0).withNano(0);
        if (!morning.isAfter(now)) {
            morning = morning.plusDays(1);
        }
        return Times.stamp(morning.toInstant());
    }

    public void notify(Collection<Long> userIds, String severity, String title, String body,
                       String view, String recordType, Long recordId, String dedupe, Long skipUser) {
        String visible = visibleAt(severity);
        String t = title != null && title.length() > 140 ? title.substring(0, 140) : (title != null ? title : "");
        String b = body != null && body.length() > 400 ? body.substring(0, 400) : (body != null ? body : "");
        for (Long uid : new TreeSet<>(userIds)) {
            if (uid == null || uid.equals(skipUser)) {
                continue;
            }
            if (dedupe != null && db.one("SELECT 1 FROM alerts WHERE user_id=? AND dedupe_key=? AND read_at IS NULL", uid, dedupe) != null) {
                continue;
            }
            db.exec("INSERT INTO alerts(user_id, severity, title, body, `view`, record_type, record_id, dedupe_key, created_at, visible_at) " +
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    uid, severity, t, b, view, recordType, recordId, dedupe, Times.stamp(), visible);
        }
    }

    public void notifyPerm(String perm, String severity, String title, String body,
                           String view, String recordType, Long recordId, String dedupe, Long skipUser) {
        notify(usersWith(perm), severity, title, body, view, recordType, recordId, dedupe, skipUser);
    }

    public void notifyPerm(String perm, String severity, String title, String body, String view, Long skipUser) {
        notifyPerm(perm, severity, title, body, view, null, null, null, skipUser);
    }

    public Long bossOf(long userId) {
        Map<String, Object> r = db.one(
                "SELECT b.id FROM users u JOIN users b ON b.id=u.reports_to AND b.active=1 WHERE u.id=?",
                userId
        );
        return r != null && r.get("id") != null ? ((Number) r.get("id")).longValue() : null;
    }
}
