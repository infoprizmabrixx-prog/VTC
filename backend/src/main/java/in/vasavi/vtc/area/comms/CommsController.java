package in.vasavi.vtc.area.comms;

import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class CommsController {

    private static final Map<String, List<String>> RECORD_PERMS = Map.of(
            "roast", List.of("roast.view", "qc.view"),
            "lot", List.of("inventory.view"),
            "receipt", List.of("goods.view"),
            "pack", List.of("pack.view"),
            "order", List.of("outgoing.view"),
            "sale", List.of("counter.sell"),
            "outside", List.of("outside.view"),
            "blend", List.of("recipe.view_public", "recipe.execute_secret"),
            "transfer", List.of("inventory.transfer", "inventory.view"),
            "task", List.of()
    );
    private static final Set<String> VOICE_TYPES = Set.of(
            "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"
    );

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;

    public CommsController(Db db, SessionService sessionService, PermissionService permissionService) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
    }

    private Path filesDir() {
        Path p = Paths.get(System.getProperty("java.io.tmpdir"), "vtc_files");
        try {
            Files.createDirectories(p);
        } catch (Exception ignored) {
        }
        return p;
    }

    private Set<Long> teamIds(long uid) {
        Set<Long> set = new HashSet<>();
        for (Map<String, Object> r : db.rows("SELECT team_id FROM user_teams WHERE user_id=?", uid)) {
            set.add(((Number) r.get("team_id")).longValue());
        }
        return set;
    }

    private boolean recordVisible(CurrentUser u, String rtype, long rid) {
        if ("task".equals(rtype)) {
            Map<String, Object> t = db.one("SELECT assigned_to, created_by FROM tasks WHERE id=?", rid);
            if (t == null) return false;
            Long ass = t.get("assigned_to") != null ? ((Number) t.get("assigned_to")).longValue() : null;
            Long cr = t.get("created_by") != null ? ((Number) t.get("created_by")).longValue() : null;
            return u.can("tasks.view_all") || (ass != null && ass == u.getId()) || (cr != null && cr == u.getId());
        }
        List<String> perms = RECORD_PERMS.getOrDefault(rtype, List.of());
        for (String p : perms) {
            if (u.can(p)) return true;
        }
        return false;
    }

    private boolean canSee(CurrentUser u, Map<String, Object> conv, boolean oversightOk) {
        if (!u.can("comms.read")) return false;
        String k = (String) conv.get("kind");
        long cid = ((Number) conv.get("id")).longValue();

        if ("announcement".equals(k)) return true;
        if ("group".equals(k)) {
            Long tid = conv.get("team_id") != null ? ((Number) conv.get("team_id")).longValue() : null;
            if (tid != null && teamIds(u.getId()).contains(tid)) return true;
        } else if ("direct".equals(k)) {
            if (db.queryForLong("SELECT COUNT(*) FROM conversation_members WHERE conversation_id=? AND user_id=?", cid, u.getId()) > 0) {
                return true;
            }
        } else if ("record".equals(k)) {
            String rtype = (String) conv.get("record_type");
            long rid = ((Number) conv.get("record_id")).longValue();
            if (recordVisible(u, rtype, rid)) return true;
        }
        return oversightOk && u.can("comms.oversight");
    }

    private boolean announcementFor(CurrentUser u, Map<String, Object> msg) {
        String a = msg.get("audience") != null ? (String) msg.get("audience") : "all";
        Long authorId = msg.get("author_id") != null ? ((Number) msg.get("author_id")).longValue() : null;
        if ("all".equals(a) || (authorId != null && authorId == u.getId()) || u.can("comms.oversight")) {
            return true;
        }
        String[] parts = a.split(":", 2);
        String kind = parts[0];
        String val = parts.length > 1 ? parts[1] : "";
        if ("role".equals(kind)) {
            return String.valueOf(u.getRoleId()).equals(val);
        }
        if ("team".equals(kind)) {
            try {
                return teamIds(u.getId()).contains(Long.parseLong(val));
            } catch (Exception e) {
                return false;
            }
        }
        return false;
    }

    private String getTitle(Map<String, Object> conv, long me) {
        String k = (String) conv.get("kind");
        long cid = ((Number) conv.get("id")).longValue();
        if ("direct".equals(k)) {
            Map<String, Object> other = db.one(
                    "SELECT u.full_name FROM conversation_members m JOIN users u ON u.id=m.user_id " +
                            "WHERE m.conversation_id=? AND m.user_id!=?", cid, me
            );
            return other != null ? (String) other.get("full_name") : "Direct";
        }
        if ("record".equals(k)) {
            String t = (String) conv.get("title");
            return t != null ? t : (conv.get("record_type") + " #" + conv.get("record_id"));
        }
        return (String) conv.get("title");
    }

    private void addMember(long cid, long uid) {
        db.exec("INSERT IGNORE INTO conversation_members(conversation_id, user_id) VALUES(?,?)", cid, uid);
    }

    private int unreadCount(CurrentUser u, Map<String, Object> conv) {
        long cid = ((Number) conv.get("id")).longValue();
        String k = (String) conv.get("kind");
        if ("announcement".equals(k)) {
            List<Map<String, Object>> msgs = db.rows(
                    "SELECT id, author_id, audience FROM messages WHERE conversation_id=? AND id NOT IN " +
                            "(SELECT message_id FROM announcement_reads WHERE user_id=?) AND author_id!=?",
                    cid, u.getId(), u.getId()
            );
            int count = 0;
            for (Map<String, Object> m : msgs) {
                if (announcementFor(u, m)) count++;
            }
            return count;
        }
        Map<String, Object> row = db.one("SELECT last_read_id FROM conversation_members WHERE conversation_id=? AND user_id=?", cid, u.getId());
        if (row == null && "record".equals(k)) return 0;
        long last = row != null && row.get("last_read_id") != null ? ((Number) row.get("last_read_id")).longValue() : 0;
        return (int) db.queryForLong("SELECT COUNT(*) FROM messages WHERE conversation_id=? AND id>? AND COALESCE(author_id,0)!=?", cid, last, u.getId());
    }

    // --- Alerts ---

    @GetMapping("/alerts")
    public List<Map<String, Object>> myAlerts(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        return db.rows("SELECT * FROM alerts WHERE user_id=? AND visible_at<=? AND severity!='normal' ORDER BY id DESC LIMIT 60",
                u.getId(), Times.stamp());
    }

    @PostMapping("/alerts/read")
    public Map<String, Object> readAlerts(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        Object idsObj = body.get("ids");

        db.txVoid(() -> {
            if ("all".equals(idsObj)) {
                db.exec("UPDATE alerts SET read_at=? WHERE user_id=? AND read_at IS NULL AND visible_at<=?",
                        Times.stamp(), u.getId(), Times.stamp());
            } else if (idsObj instanceof List<?> list) {
                for (Object id : list) {
                    if (id instanceof Number n) {
                        db.exec("UPDATE alerts SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL",
                                Times.stamp(), n.longValue(), u.getId());
                    }
                }
            }
        });
        return Map.of("ok", true);
    }

    // --- Comms Inbox & Badge ---

    @GetMapping("/comms/inbox")
    public Map<String, Object> inbox(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "comms.read");

        List<Map<String, Object>> convs = db.rows("SELECT * FROM conversations ORDER BY id");
        List<Map<String, Object>> out = new ArrayList<>();

        for (Map<String, Object> conv : convs) {
            if (!canSee(u, conv, false)) continue;
            long cid = ((Number) conv.get("id")).longValue();
            String kind = (String) conv.get("kind");

            if ("record".equals(kind) && db.queryForLong("SELECT COUNT(*) FROM conversation_members WHERE conversation_id=? AND user_id=?", cid, u.getId()) == 0) {
                continue;
            }

            Map<String, Object> last = db.one(
                    "SELECT m.*, x.full_name author FROM messages m LEFT JOIN users x ON x.id=m.author_id " +
                            "WHERE conversation_id=? ORDER BY m.id DESC LIMIT 1", cid
            );
            if ("announcement".equals(kind)) {
                List<Map<String, Object>> visible = new ArrayList<>();
                for (Map<String, Object> m : db.rows("SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC", cid)) {
                    if (announcementFor(u, m)) visible.add(m);
                }
                last = !visible.isEmpty() ? visible.get(0) : null;
                if (last != null && last.get("author_id") != null) {
                    Map<String, Object> auth = db.one("SELECT full_name FROM users WHERE id=?", last.get("author_id"));
                    last.put("author", auth != null ? auth.get("full_name") : "System");
                }
            }

            Map<String, Object> lastMap = null;
            if (last != null) {
                String bodyText = (String) last.get("body");
                if (bodyText == null || bodyText.isEmpty()) {
                    bodyText = last.get("voice_file_id") != null ? "\uD83C\uDFA4 Voice note" : "";
                }
                if (bodyText.length() > 90) bodyText = bodyText.substring(0, 90);
                lastMap = Map.of(
                        "body", bodyText,
                        "author", last.getOrDefault("author", "System"),
                        "at", last.get("created_at")
                );
            }

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", cid);
            item.put("kind", kind);
            item.put("title", getTitle(conv, u.getId()));
            item.put("record_type", conv.get("record_type"));
            item.put("record_id", conv.get("record_id"));
            item.put("unread", unreadCount(u, conv));
            item.put("last", lastMap);
            out.add(item);
        }

        Map<String, Integer> order = Map.of("announcement", 0, "group", 1, "direct", 2, "record", 3);
        out.sort(Comparator.comparingInt((Map<String, Object> a) -> order.getOrDefault(a.get("kind"), 4)));

        long unreadAlerts = db.queryForLong(
                "SELECT COUNT(*) FROM alerts WHERE user_id=? AND read_at IS NULL AND visible_at<=? AND severity!='normal'",
                u.getId(), Times.stamp()
        );
        int unreadTotal = 0;
        for (Map<String, Object> c : out) unreadTotal += ((Number) c.get("unread")).intValue();

        return Map.of("conversations", out, "unread_total", unreadTotal, "alerts_unread", unreadAlerts);
    }

    @GetMapping("/comms/badge")
    public Map<String, Object> badge(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        if (!u.can("comms.read")) {
            long a = db.queryForLong("SELECT COUNT(*) FROM alerts WHERE user_id=? AND read_at IS NULL AND visible_at<=? AND severity!='normal'",
                    u.getId(), Times.stamp());
            return Map.of("messages", 0, "alerts", a);
        }
        Map<String, Object> data = inbox(req);
        return Map.of("messages", data.get("unread_total"), "alerts", data.get("alerts_unread"));
    }

    @GetMapping("/comms/contacts")
    public List<Map<String, Object>> contacts(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "comms.chat");

        boolean allowAdmins = Boolean.TRUE.equals(db.getSetting("staff_can_message_admins"));
        List<Map<String, Object>> rows = db.rows(
                "SELECT u.id, u.full_name, r.name role_name, r.tier FROM users u JOIN roles r " +
                        "ON r.id=u.role_id WHERE u.active=1 AND u.id!=? ORDER BY u.full_name", u.getId()
        );
        if ("staff".equals(u.getTier())) {
            List<Map<String, Object>> filtered = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                String tier = (String) r.get("tier");
                if ("manager".equals(tier) || (allowAdmins && "admin".equals(tier))) {
                    filtered.add(r);
                }
            }
            return filtered;
        }
        return rows;
    }

    @PostMapping("/comms/direct")
    public Map<String, Object> openDirect(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "comms.chat");
        Map<String, Object> body = d != null ? d : Map.of();

        long other = body.get("user_id") instanceof Number n ? n.longValue() : 0;
        List<Map<String, Object>> allowed = contacts(req);
        boolean found = false;
        for (Map<String, Object> a : allowed) {
            if (((Number) a.get("id")).longValue() == other) {
                found = true;
                break;
            }
        }
        if (!found) throw new ApiException("CANNOT_MESSAGE_THIS_PERSON", 403);

        return db.tx(() -> {
            Map<String, Object> existing = db.one(
                    "SELECT c.id FROM conversations c WHERE c.kind='direct' AND " +
                            "(SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id=c.id AND m.user_id IN (?,?))=2",
                    u.getId(), other
            );
            if (existing != null) return Map.of("id", existing.get("id"));

            long cid = db.insert("INSERT INTO conversations(kind, created_by, created_at) VALUES('direct',?,?)", u.getId(), Times.stamp());
            addMember(cid, u.getId());
            addMember(cid, other);
            return Map.of("id", cid);
        });
    }

    @GetMapping("/comms/record/{rtype}/{rid}")
    public Map<String, Object> recordThread(@PathVariable String rtype, @PathVariable long rid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "comms.read");
        if (!RECORD_PERMS.containsKey(rtype)) throw new ApiException("INVALID_RECORD_TYPE");

        return db.tx(() -> {
            if (!recordVisible(u, rtype, rid)) throw new ApiException("ACCESS_DENIED", 403);
            Map<String, Object> row = db.one("SELECT id FROM conversations WHERE kind='record' AND record_type=? AND record_id=?", rtype, rid);
            if (row != null) return Map.of("id", row.get("id"));

            Map<String, String> labels = Map.of(
                    "roast", "Roast batch", "lot", "Lot", "receipt", "Receipt", "pack", "Packing ticket",
                    "order", "Order", "sale", "Counter bill", "outside", "Outside roast job",
                    "blend", "Blend job", "transfer", "Transfer", "task", "Task"
            );
            String title = labels.getOrDefault(rtype, "Record") + " #" + rid;
            if ("task".equals(rtype)) {
                Map<String, Object> t = db.one("SELECT title FROM tasks WHERE id=?", rid);
                if (t != null && t.get("title") != null) {
                    title = "Task: " + t.get("title");
                }
            }

            long cid = db.insert("INSERT INTO conversations(kind, title, record_type, record_id, created_by, created_at) VALUES('record',?,?,?,?,?)",
                    title, rtype, rid, u.getId(), Times.stamp());
            return Map.of("id", cid);
        });
    }

    @GetMapping("/comms/conversations/{cid}")
    public Map<String, Object> readConversation(@PathVariable long cid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "comms.read");

        return db.tx(() -> {
            Map<String, Object> conv = db.one("SELECT * FROM conversations WHERE id=?", cid);
            if (conv == null) throw new ApiException("NOT_FOUND", 404);

            boolean oversight = false;
            if (!canSee(u, conv, false)) {
                if (!canSee(u, conv, true)) throw new ApiException("ACCESS_DENIED", 403);
                db.audit(u.getId(), "OVERSIGHT_READ", "conversation:" + cid, getTitle(conv, u.getId()), "access");
                oversight = true;
            }

            List<Map<String, Object>> msgs = db.rows(
                    "SELECT m.*, x.full_name author FROM messages m LEFT JOIN users x ON x.id=m.author_id " +
                            "WHERE conversation_id=? ORDER BY m.id DESC LIMIT 200", cid
            );
            Collections.reverse(msgs);

            String kind = (String) conv.get("kind");
            if ("announcement".equals(kind)) {
                List<Map<String, Object>> vis = new ArrayList<>();
                for (Map<String, Object> m : msgs) {
                    if (announcementFor(u, m)) vis.add(m);
                }
                msgs = vis;
                if (!oversight) {
                    for (Map<String, Object> m : msgs) {
                        db.exec("INSERT IGNORE INTO announcement_reads(message_id, user_id, read_at) VALUES(?,?,?)",
                                m.get("id"), u.getId(), Times.stamp());
                    }
                }
                for (Map<String, Object> m : msgs) {
                    Long authId = m.get("author_id") != null ? ((Number) m.get("author_id")).longValue() : null;
                    if ((authId != null && authId == u.getId()) || u.can("comms.announce")) {
                        m.put("receipts", getReceipts(m));
                    }
                }
            } else if (!oversight && !msgs.isEmpty()) {
                addMember(cid, u.getId());
                long lastId = ((Number) msgs.get(msgs.size() - 1).get("id")).longValue();
                db.exec("UPDATE conversation_members SET last_read_id=? WHERE conversation_id=? AND user_id=?",
                        lastId, cid, u.getId());
            }

            boolean mayPost = ("announcement".equals(kind) ? u.can("comms.announce") : u.can("comms.chat")) && !oversight;
            List<String> members = new ArrayList<>();
            if ("group".equals(kind)) {
                for (Map<String, Object> row : db.rows(
                        "SELECT u.full_name FROM user_teams t JOIN users u ON u.id=t.user_id WHERE t.team_id=? AND u.active=1 ORDER BY u.full_name",
                        conv.get("team_id"))) {
                    members.add((String) row.get("full_name"));
                }
            }

            Map<String, Object> convData = new LinkedHashMap<>(conv);
            convData.put("title", getTitle(conv, u.getId()));

            Map<String, Object> res = new LinkedHashMap<>();
            res.put("conversation", convData);
            res.put("messages", msgs);
            res.put("may_post", mayPost);
            res.put("oversight", oversight);
            res.put("members", members);
            res.put("teams", "announcement".equals(kind) ? db.rows("SELECT id, name FROM teams ORDER BY id") : List.of());
            res.put("roles", "announcement".equals(kind) ? db.rows("SELECT id, name FROM roles WHERE active=1 ORDER BY id") : List.of());
            res.put("notice", "Work messages can be read by the admin for oversight. Please keep them about work.");
            return res;
        });
    }

    private Map<String, Object> getReceipts(Map<String, Object> msg) {
        long mid = ((Number) msg.get("id")).longValue();
        Long authorId = msg.get("author_id") != null ? ((Number) msg.get("author_id")).longValue() : null;

        List<Map<String, Object>> audience = new ArrayList<>();
        for (Map<String, Object> uRow : db.rows("SELECT id, full_name, role_id FROM users WHERE active=1 AND id!=?", authorId)) {
            CurrentUser x = permissionService.loadUser(((Number) uRow.get("id")).longValue());
            if (x != null && x.can("comms.read") && announcementFor(x, msg)) {
                audience.add(uRow);
            }
        }

        Map<Long, String> seen = new HashMap<>();
        for (Map<String, Object> r : db.rows("SELECT user_id, read_at FROM announcement_reads WHERE message_id=?", mid)) {
            seen.put(((Number) r.get("user_id")).longValue(), (String) r.get("read_at"));
        }

        List<Map<String, Object>> seenList = new ArrayList<>();
        List<String> notSeenList = new ArrayList<>();
        for (Map<String, Object> x : audience) {
            long uid = ((Number) x.get("id")).longValue();
            String name = (String) x.get("full_name");
            if (seen.containsKey(uid)) {
                seenList.add(Map.of("name", name, "at", seen.get(uid)));
            } else {
                notSeenList.add(name);
            }
        }
        return Map.of("total", audience.size(), "seen", seenList, "not_seen", notSeenList);
    }

    @PostMapping("/comms/conversations/{cid}/messages")
    public Map<String, Object> postMessage(@PathVariable long cid,
                                           @RequestBody(required = false) Map<String, Object> d,
                                           HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        String text = body.containsKey("body") ? String.valueOf(body.get("body")).trim() : "";
        if (text.length() > 2000) text = text.substring(0, 2000);
        Object voiceObj = body.get("voice_file_id");
        Long voiceId = voiceObj instanceof Number n ? n.longValue() : null;

        if (text.isEmpty() && voiceId == null) throw new ApiException("EMPTY_MESSAGE");

        final String finalText = text;
        return db.tx(() -> {
            Map<String, Object> conv = db.one("SELECT * FROM conversations WHERE id=?", cid);
            if (conv == null) throw new ApiException("NOT_FOUND", 404);
            if (!canSee(u, conv, false)) throw new ApiException("ACCESS_DENIED", 403);

            String kind = (String) conv.get("kind");
            String audience = null;
            if ("announcement".equals(kind)) {
                permissionService.require(u, "comms.announce");
                audience = body.containsKey("audience") ? String.valueOf(body.get("audience")) : "all";
                String[] parts = audience.split(":", 2);
                String k = parts[0];
                String v = parts.length > 1 ? parts[1] : "";
                if ("role".equals(k) && db.queryForLong("SELECT COUNT(*) FROM roles WHERE id=?", v) == 0) {
                    throw new ApiException("INVALID_AUDIENCE");
                }
                if ("team".equals(k) && db.queryForLong("SELECT COUNT(*) FROM teams WHERE id=?", v) == 0) {
                    throw new ApiException("INVALID_AUDIENCE");
                }
                if (!List.of("all", "role", "team").contains(k)) throw new ApiException("INVALID_AUDIENCE");
            } else {
                permissionService.require(u, "comms.chat");
            }

            if (voiceId != null) {
                Map<String, Object> f = db.one("SELECT * FROM files WHERE id=? AND created_by=? AND deleted_at IS NULL", voiceId, u.getId());
                if (f == null) throw new ApiException("VOICE_NOTE_NOT_FOUND");
            }

            long mid = db.insert("INSERT INTO messages(conversation_id, author_id, body, voice_file_id, audience, created_at) VALUES(?,?,?,?,?,?)",
                    cid, u.getId(), finalText, voiceId, audience, Times.stamp());

            if (!"announcement".equals(kind)) {
                addMember(cid, u.getId());
                db.exec("UPDATE conversation_members SET last_read_id=? WHERE conversation_id=? AND user_id=?", mid, cid, u.getId());
            }
            if ("record".equals(kind)) {
                joinRecordPeople(conv);
            }
            return Map.of("id", mid);
        });
    }

    private void joinRecordPeople(Map<String, Object> conv) {
        String rt = (String) conv.get("record_type");
        long rid = ((Number) conv.get("record_id")).longValue();
        long cid = ((Number) conv.get("id")).longValue();

        Map<String, String> queries = Map.of(
                "task", "SELECT assigned_to, created_by FROM tasks WHERE id=?",
                "roast", "SELECT created_by FROM roast_batches WHERE id=?",
                "receipt", "SELECT created_by FROM receipts WHERE id=?",
                "order", "SELECT created_by FROM orders WHERE id=?",
                "pack", "SELECT created_by FROM pack_jobs WHERE id=?"
        );
        String sql = queries.get(rt);
        if (sql == null) return;
        Map<String, Object> r = db.one(sql, rid);
        if (r == null) return;
        for (Object val : r.values()) {
            if (val instanceof Number n) addMember(cid, n.longValue());
        }
    }

    // --- Voice Notes ---

    @PostMapping("/comms/voice")
    public Map<String, Object> uploadVoice(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "comms.chat");
        Map<String, Object> body = d != null ? d : Map.of();

        String rawMime = String.valueOf(body.getOrDefault("mime", "")).split(";")[0].trim().toLowerCase();
        if (!VOICE_TYPES.contains(rawMime)) throw new ApiException("VOICE_FORMAT_NOT_SUPPORTED");

        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(String.valueOf(body.getOrDefault("data", "")));
        } catch (Exception e) {
            throw new ApiException("VOICE_DATA_INVALID");
        }

        if (raw.length < 100 || raw.length > 2_500_000) throw new ApiException("VOICE_NOTE_TOO_LONG");

        String digest;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(raw);
            StringBuilder sb = new StringBuilder();
            for (byte b : h) sb.append(String.format("%02x", b));
            digest = sb.toString();
        } catch (Exception e) {
            digest = "sha256error";
        }

        String fileName = "voice_" + digest.substring(0, Math.min(24, digest.length())) + ".bin";
        try {
            Files.write(filesDir().resolve(fileName), raw);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to write voice file", e);
        }

        final String finalDigest = digest;
        return db.tx(() -> {
            Object retObj = db.getSetting("voice_retention_days");
            int days = retObj != null ? Integer.parseInt(retObj.toString()) : 30;
            String expiresAt = Times.stamp(Times.now().plus(Duration.ofDays(days)));

            long fid = db.insert("INSERT INTO files(kind, mime, bytes, sha256, path, created_by, created_at, expires_at) VALUES('voice',?,?,?,?,?,?,?)",
                    rawMime, raw.length, finalDigest, fileName, u.getId(), Times.stamp(), expiresAt);
            return Map.of("id", fid);
        });
    }

    @GetMapping("/comms/files/{fid}")
    public ResponseEntity<byte[]> getFile(@PathVariable long fid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> f = db.one("SELECT * FROM files WHERE id=?", fid);
        if (f == null || f.get("deleted_at") != null) throw new ApiException("FILE_EXPIRED_OR_MISSING", 404);
        if (!"voice".equals(f.get("kind"))) throw new ApiException("ACCESS_DENIED", 403);

        boolean allowed = ((Number) f.get("created_by")).longValue() == u.getId();
        if (!allowed) {
            for (Map<String, Object> m : db.rows("SELECT * FROM messages WHERE voice_file_id=?", fid)) {
                long cid = ((Number) m.get("conversation_id")).longValue();
                Map<String, Object> conv = db.one("SELECT * FROM conversations WHERE id=?", cid);
                if (conv != null && canSee(u, conv, true) && (!"announcement".equals(conv.get("kind")) || announcementFor(u, m))) {
                    allowed = true;
                    break;
                }
            }
        }
        if (!allowed) throw new ApiException("ACCESS_DENIED", 403);

        Path path = filesDir().resolve((String) f.get("path"));
        if (!Files.exists(path)) throw new ApiException("FILE_EXPIRED_OR_MISSING", 404);

        try {
            byte[] bytes = Files.readAllBytes(path);
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType((String) f.get("mime")))
                    .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
                    .body(bytes);
        } catch (Exception e) {
            throw new ApiException("NOT_FOUND", 404);
        }
    }

    // --- Oversight ---

    @GetMapping("/comms/oversight")
    public List<Map<String, Object>> oversight(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "comms.oversight");

        List<Map<String, Object>> rows = db.rows(
                "SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) messages, " +
                        "(SELECT MAX(created_at) FROM messages m WHERE m.conversation_id=c.id) last_at FROM conversations c " +
                        "WHERE c.kind IN ('direct','group','record') ORDER BY last_at DESC"
        );
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            long count = ((Number) r.get("messages")).longValue();
            if (count > 0) {
                long cid = ((Number) r.get("id")).longValue();
                String k = (String) r.get("kind");
                if ("direct".equals(k)) {
                    List<String> names = new ArrayList<>();
                    for (Map<String, Object> uRow : db.rows("SELECT u.full_name FROM conversation_members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=?", cid)) {
                        names.add((String) uRow.get("full_name"));
                    }
                    r.put("title", String.join(" \u2194 ", names));
                } else {
                    r.put("title", getTitle(r, u.getId()));
                }
                out.add(r);
            }
        }
        return out;
    }

    // --- Teams ---

    @GetMapping("/teams")
    public List<Map<String, Object>> teams(HttpServletRequest req) {
        return db.rows("SELECT t.id, t.key, t.name, (SELECT COUNT(*) FROM user_teams x JOIN users y ON y.id=x.user_id " +
                "WHERE x.team_id=t.id AND y.active=1) people FROM teams t ORDER BY t.id");
    }

    @PutMapping("/admin/users/{uid}/teams")
    public Map<String, Object> setUserTeams(@PathVariable long uid,
                                           @RequestBody(required = false) Map<String, Object> d,
                                           HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.users");
        Map<String, Object> body = d != null ? d : Map.of();
        List<?> idsList = body.get("team_ids") instanceof List<?> list ? list : List.of();

        return db.tx(() -> {
            Map<String, Object> target = db.one("SELECT 1 FROM users WHERE id=?", uid);
            if (target == null) throw new ApiException("NOT_FOUND", 404);

            Set<Long> valid = new HashSet<>();
            for (Map<String, Object> row : db.rows("SELECT id FROM teams")) {
                valid.add(((Number) row.get("id")).longValue());
            }

            List<Long> ids = new ArrayList<>();
            for (Object item : idsList) {
                if (item instanceof Number n) {
                    long tid = n.longValue();
                    if (!valid.contains(tid)) throw new ApiException("INVALID_TEAM");
                    ids.add(tid);
                }
            }

            db.exec("DELETE FROM user_teams WHERE user_id=?", uid);
            for (long tid : ids) {
                db.exec("INSERT INTO user_teams(user_id, team_id) VALUES(?,?)", uid, tid);
            }

            db.audit(u.getId(), "TEAMS_CHANGED", "user:" + uid, ids.size() + " teams assigned", "access");
            return Map.of("ok", true);
        });
    }

    @GetMapping("/admin/users/{uid}/teams")
    public List<Long> getUserTeams(@PathVariable long uid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.users");
        List<Long> out = new ArrayList<>();
        for (Map<String, Object> row : db.rows("SELECT team_id FROM user_teams WHERE user_id=?", uid)) {
            out.add(((Number) row.get("team_id")).longValue());
        }
        return out;
    }

    @PostMapping("/admin/teams")
    public Map<String, Object> createTeam(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.users");
        Map<String, Object> body = d != null ? d : Map.of();
        String name = ValidationUtils.text(body, "name", 2, 40, "INVALID_NAME");

        StringBuilder keyBuilder = new StringBuilder();
        for (char ch : name.toLowerCase().toCharArray()) {
            if (Character.isLetterOrDigit(ch)) keyBuilder.append(ch);
            else keyBuilder.append('_');
        }
        String key = keyBuilder.toString().replaceAll("^_+|_+$", "");

        return db.tx(() -> {
            if (db.queryForLong("SELECT COUNT(*) FROM teams WHERE `key`=? OR LOWER(name)=LOWER(?)", key, name) > 0) {
                throw new ApiException("TEAM_EXISTS");
            }
            long tid = db.insert("INSERT INTO teams(`key`, name) VALUES(?,?)", key, name);
            db.insert("INSERT INTO conversations(kind, title, team_id, created_at) VALUES('group',?,?,?)", name, tid, Times.stamp());
            db.audit(u.getId(), "TEAM_CREATED", "team:" + tid, name, "access");
            return Map.of("id", tid);
        });
    }
}
