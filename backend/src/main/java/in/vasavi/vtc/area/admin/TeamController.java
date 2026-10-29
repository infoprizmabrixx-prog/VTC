package in.vasavi.vtc.area.admin;

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

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/v1")
public class TeamController {

    private static final Set<String> DOC_KINDS = Set.of("AADHAAR", "PAN", "LICENCE", "PHOTO", "BANK", "CERTIFICATE", "CONTRACT", "OTHER");
    private static final Set<String> DOC_TYPES = Set.of("application/pdf", "image/jpeg", "image/png", "image/webp");
    private static final Pattern HEX = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Pattern PHONE_RE = Pattern.compile("^\\+?[0-9 ]{10,15}$");
    private static final Pattern EMAIL_RE = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final Pattern IFSC_RE = Pattern.compile("^[A-Z]{4}0[A-Z0-9]{6}$");
    private static final Pattern DATE_RE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final in.vasavi.vtc.common.StockwatchService stockwatchService;

    public TeamController(Db db, SessionService sessionService, PermissionService permissionService,
                          in.vasavi.vtc.common.StockwatchService stockwatchService) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.stockwatchService = stockwatchService;
    }

    private Path filesDir() {
        Path p = Paths.get(System.getProperty("java.io.tmpdir"), "vtc_files");
        try {
            Files.createDirectories(p);
        } catch (Exception e) {}
        return p;
    }

    private void guardOwner(CurrentUser u, long targetUid) {
        Map<String, Object> r = db.one("SELECT is_owner FROM users WHERE id=?", targetUid);
        if (r != null && ((Number) r.get("is_owner")).intValue() != 0 && !u.isOwner()) {
            throw new ApiException("OWNER_IS_PROTECTED", 403);
        }
    }

    private String last4(Object v) {
        if (v == null) return "";
        String s = v.toString().replaceAll("[^0-9A-Za-z]", "").toUpperCase();
        return s.length() > 4 ? s.substring(s.length() - 4) : s;
    }

    // --- Stock Cards ---

    @GetMapping("/stock-cards")
    public List<Map<String, Object>> stockCards(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "inventory.view");

        List<Map<String, Object>> rows = db.rows(
                "SELECT m.id product_id, m.name, m.code, m.category, m.nominal_kg, " +
                "COALESCE(s.label,'') label, COALESCE(s.color,'') color, " +
                "COALESCE(s.sort, 0) sort, COALESCE(s.hidden, 0) hidden, COALESCE(s.pinned, 0) pinned, s.low_kg " +
                "FROM masters m LEFT JOIN stock_cards s ON s.product_id=m.id WHERE m.kind='product' AND m.state='ACTIVE' " +
                "ORDER BY COALESCE(s.sort, 0), m.name"
        );
        Map<Long, Double> used = stockwatchService.used30();
        for (Map<String, Object> r : rows) {
            long pid = ((Number) r.get("product_id")).longValue();
            r.put("used_30_kg", used.getOrDefault(pid, 0.0));
        }
        return rows;
    }

    @PutMapping("/stock-cards/{pid}")
    public Map<String, Object> editCard(@PathVariable long pid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "inventory.cards");
        Map<String, Object> body = d != null ? d : Map.of();

        return db.tx(() -> {
            Map<String, Object> pCheck = db.one("SELECT 1 FROM masters WHERE id=? AND kind='product'", pid);
            if (pCheck == null) throw new ApiException("NOT_FOUND", 404);

            Map<String, Object> old = db.one("SELECT * FROM stock_cards WHERE product_id=?", pid);
            String label = old != null && old.get("label") != null ? (String) old.get("label") : "";
            String color = old != null && old.get("color") != null ? (String) old.get("color") : "";
            int sort = old != null && old.get("sort") != null ? ((Number) old.get("sort")).intValue() : 0;
            int hidden = old != null && old.get("hidden") != null ? ((Number) old.get("hidden")).intValue() : 0;
            int pinned = old != null && old.get("pinned") != null ? ((Number) old.get("pinned")).intValue() : 0;
            Double lowKg = old != null && old.get("low_kg") != null ? ((Number) old.get("low_kg")).doubleValue() : null;

            if (body.containsKey("label")) {
                label = body.get("label") != null ? body.get("label").toString().trim() : "";
                if (label.length() > 60) label = label.substring(0, 60);
            }
            if (body.containsKey("color")) {
                String c = body.get("color") != null ? body.get("color").toString().trim() : "";
                if (!c.isEmpty() && !HEX.matcher(c).matches()) {
                    throw new ApiException("INVALID_COLOUR");
                }
                color = c;
            }
            if (body.containsKey("low_kg")) {
                Object lk = body.get("low_kg");
                if (lk == null || "".equals(lk)) {
                    lowKg = null;
                } else {
                    lowKg = ValidationUtils.number(body, "low_kg", true);
                }
            }
            if (body.containsKey("hidden")) {
                hidden = Boolean.TRUE.equals(body.get("hidden")) || "1".equals(String.valueOf(body.get("hidden"))) ? 1 : 0;
            }
            if (body.containsKey("pinned")) {
                pinned = Boolean.TRUE.equals(body.get("pinned")) || "1".equals(String.valueOf(body.get("pinned"))) ? 1 : 0;
            }
            if (body.containsKey("sort")) {
                sort = body.get("sort") != null ? ((Number) body.get("sort")).intValue() : 0;
            }

            db.exec(
                    "INSERT INTO stock_cards(product_id, label, color, sort, hidden, pinned, low_kg, updated_by, updated_at) " +
                    "VALUES(?,?,?,?,?,?,?,?,?) " +
                    "ON DUPLICATE KEY UPDATE label=VALUES(label), color=VALUES(color), sort=VALUES(sort), hidden=VALUES(hidden), " +
                    "pinned=VALUES(pinned), low_kg=VALUES(low_kg), updated_by=VALUES(updated_by), updated_at=VALUES(updated_at)",
                    pid, label, color, sort, hidden, pinned, lowKg, u.getId(), Times.stamp()
            );

            db.exec("UPDATE stock_dirty SET dirty=1 WHERE id=1");
            stockwatchService.watch();
            db.audit(u.getId(), "STOCK_CARD_CHANGED", "product:" + pid, "label=" + label + ", color=" + color);
            return Map.of("ok", true);
        });
    }

    @PostMapping("/stock-cards/order")
    public Map<String, Object> orderCards(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "inventory.cards");
        Map<String, Object> body = d != null ? d : Map.of();
        List<?> ids = (List<?>) body.getOrDefault("ids", List.of());

        return db.tx(() -> {
            for (int i = 0; i < ids.size(); i++) {
                long pid = ((Number) ids.get(i)).longValue();
                db.exec(
                        "INSERT INTO stock_cards(product_id, sort, updated_by, updated_at) VALUES(?,?,?,?) " +
                        "ON DUPLICATE KEY UPDATE sort=VALUES(sort), updated_by=VALUES(updated_by), updated_at=VALUES(updated_at)",
                        pid, i + 1, u.getId(), Times.stamp()
                );
            }
            db.audit(u.getId(), "STOCK_CARDS_REORDERED", "stock_cards", ids.size() + " cards");
            return Map.of("ok", true);
        });
    }

    // --- Hierarchy ---

    @GetMapping("/team")
    public List<Map<String, Object>> team(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "team.view");

        return db.rows(
                "SELECT u.id, u.full_name, u.is_owner, u.reports_to, r.name role_name, r.tier, COALESCE(p.designation,'') designation " +
                "FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN staff_profiles p ON p.user_id=u.id " +
                "WHERE u.active=1 ORDER BY u.is_owner DESC, CASE r.tier WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.full_name"
        );
    }

    @PutMapping("/team/{uid}/reports-to")
    public Map<String, Object> setBoss(@PathVariable long uid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "team.hierarchy");
        Map<String, Object> body = d != null ? d : Map.of();

        Object bObj = body.get("reports_to");
        Long boss = (bObj != null && !"".equals(bObj) && !"0".equals(bObj.toString())) ? ((Number) bObj).longValue() : null;

        return db.tx(() -> {
            Map<String, Object> who = db.one("SELECT 1 FROM users WHERE id=? AND active=1", uid);
            if (who == null) throw new ApiException("NOT_FOUND", 404);

            if (boss != null) {
                if (boss == uid) throw new ApiException("BAD_BOSS");
                Map<String, Object> bCheck = db.one("SELECT 1 FROM users WHERE id=? AND active=1", boss);
                if (bCheck == null) throw new ApiException("BAD_BOSS");

                Set<Long> seen = new HashSet<>();
                Long cur = boss;
                while (cur != null && !seen.contains(cur)) {
                    if (cur == uid) {
                        throw new ApiException("HIERARCHY_LOOP", 400);
                    }
                    seen.add(cur);
                    Map<String, Object> r = db.one("SELECT reports_to FROM users WHERE id=?", cur);
                    cur = (r != null && r.get("reports_to") != null) ? ((Number) r.get("reports_to")).longValue() : null;
                }
            }

            db.exec("UPDATE users SET reports_to=? WHERE id=?", boss, uid);
            db.audit(u.getId(), "REPORTS_TO_CHANGED", "user:" + uid, "reports to user:" + boss, "access");
            return Map.of("ok", true);
        });
    }

    // --- Staff Profiles and Documents ---

    @GetMapping("/team/{uid}/profile")
    public Map<String, Object> profile(@PathVariable long uid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "team.profiles");

        return db.tx(() -> {
            Map<String, Object> who = db.one("SELECT id, full_name FROM users WHERE id=?", uid);
            if (who == null) throw new ApiException("NOT_FOUND", 404);
            guardOwner(u, uid);

            Map<String, Object> p = db.one("SELECT * FROM staff_profiles WHERE user_id=?", uid);
            List<Map<String, Object>> docs = db.rows(
                    "SELECT d.id, d.kind, d.label, d.created_at, f.mime, f.bytes, x.full_name uploaded_by_name " +
                    "FROM staff_documents d JOIN files f ON f.id=d.file_id JOIN users x ON x.id=d.uploaded_by " +
                    "WHERE d.user_id=? AND d.removed_at IS NULL ORDER BY d.id DESC", uid
            );

            db.audit(u.getId(), "STAFF_PROFILE_VIEWED", "user:" + uid, "", "access");
            return Map.of("user", who, "profile", p != null ? p : Map.of(), "documents", docs);
        });
    }

    @PutMapping("/team/{uid}/profile")
    public Map<String, Object> saveProfile(@PathVariable long uid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "team.profiles");
        Map<String, Object> body = d != null ? d : Map.of();

        Map<String, Object> vals = new LinkedHashMap<>();
        for (String k : List.of("designation", "phone", "alt_phone", "email", "address", "emergency_name", "emergency_phone", "bank_name", "ifsc", "notes")) {
            if (body.containsKey(k)) {
                String val = body.get(k) != null ? body.get(k).toString().trim() : "";
                if (("phone".equals(k) || "alt_phone".equals(k) || "emergency_phone".equals(k)) && !val.isEmpty()) {
                    if (!PHONE_RE.matcher(val).matches()) throw new ApiException("INVALID_PHONE");
                }
                if ("email".equals(k) && !val.isEmpty()) {
                    if (!EMAIL_RE.matcher(val).matches()) throw new ApiException("INVALID_EMAIL");
                }
                vals.put(k, val);
            }
        }

        if (vals.containsKey("ifsc")) {
            String ifsc = vals.get("ifsc").toString().toUpperCase();
            if (!ifsc.isEmpty() && !IFSC_RE.matcher(ifsc).matches()) {
                throw new ApiException("INVALID_IFSC");
            }
            vals.put("ifsc", ifsc);
        }

        for (String k : List.of("dob", "joined_on")) {
            if (body.containsKey(k)) {
                String val = body.get(k) != null ? body.get(k).toString().trim() : "";
                if (!val.isEmpty() && !DATE_RE.matcher(val).matches()) {
                    throw new ApiException("INVALID_DATE");
                }
                vals.put(k, val.isEmpty() ? null : val);
            }
        }

        if (body.containsKey("aadhaar") && body.get("aadhaar") != null) {
            vals.put("aadhaar_last4", last4(body.get("aadhaar")));
        }
        if (body.containsKey("pan") && body.get("pan") != null) {
            vals.put("pan_last4", last4(body.get("pan")));
        }
        if (body.containsKey("bank_account") && body.get("bank_account") != null) {
            vals.put("bank_last4", last4(body.get("bank_account")));
        }

        if (vals.isEmpty()) {
            throw new ApiException("NOTHING_TO_CHANGE");
        }

        return db.tx(() -> {
            Map<String, Object> who = db.one("SELECT 1 FROM users WHERE id=?", uid);
            if (who == null) throw new ApiException("NOT_FOUND", 404);
            guardOwner(u, uid);

            db.exec("INSERT INTO staff_profiles(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)", uid);

            StringBuilder sql = new StringBuilder("UPDATE staff_profiles SET ");
            List<Object> args = new ArrayList<>();
            for (Map.Entry<String, Object> e : vals.entrySet()) {
                sql.append(e.getKey()).append("=?, ");
                args.add(e.getValue());
            }
            sql.append("updated_by=?, updated_at=? WHERE user_id=?");
            args.add(u.getId());
            args.add(Times.stamp());
            args.add(uid);

            db.exec(sql.toString(), args.toArray());
            db.audit(u.getId(), "STAFF_PROFILE_CHANGED", "user:" + uid, String.join(", ", vals.keySet()), "access");
            return Map.of("ok", true);
        });
    }

    @PostMapping("/team/{uid}/documents")
    public Map<String, Object> addDocument(@PathVariable long uid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "team.profiles");
        Map<String, Object> body = d != null ? d : Map.of();

        String kind = (String) body.get("kind");
        String mime = body.get("mime") != null ? body.get("mime").toString().toLowerCase().trim() : "";
        if (!DOC_KINDS.contains(kind)) throw new ApiException("INVALID_DOCUMENT_KIND");
        if (!DOC_TYPES.contains(mime)) throw new ApiException("FILE_TYPE_NOT_ALLOWED");

        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(String.valueOf(body.getOrDefault("data", "")));
        } catch (Exception e) {
            throw new ApiException("FILE_DATA_INVALID");
        }

        if (raw.length < 100) throw new ApiException("FILE_EMPTY");
        if (raw.length > 8_000_000) throw new ApiException("FILE_TOO_LARGE");

        Map<String, Object> who = db.one("SELECT 1 FROM users WHERE id=?", uid);
        if (who == null) throw new ApiException("NOT_FOUND", 404);
        guardOwner(u, uid);

        String digest;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(raw);
            StringBuilder sb = new StringBuilder();
            for (byte b : h) sb.append(String.format("%02x", b));
            digest = sb.toString();
        } catch (Exception e) {
            digest = "sha256err";
        }

        String fileName = "staffdoc_" + digest.substring(0, Math.min(24, digest.length())) + ".bin";
        try {
            Files.write(filesDir().resolve(fileName), raw);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to write staff doc", e);
        }

        final String finalDigest = digest;
        return db.tx(() -> {
            long fid = db.insert("INSERT INTO files(kind, mime, bytes, sha256, path, created_by, created_at) VALUES('staff_doc',?,?,?,?,?,?)",
                    mime, raw.length, finalDigest, fileName, u.getId(), Times.stamp());
            long did = db.insert("INSERT INTO staff_documents(user_id, kind, label, file_id, uploaded_by, created_at) VALUES(?,?,?,?,?,?)",
                    uid, kind, body.getOrDefault("label", "").toString().trim(), fid, u.getId(), Times.stamp());
            db.audit(u.getId(), "STAFF_DOCUMENT_ADDED", "user:" + uid, kind + " #" + did, "access");
            return Map.of("id", did);
        });
    }

    @GetMapping("/team/documents/{did}")
    public ResponseEntity<byte[]> getDocument(@PathVariable long did, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "team.profiles");

        Map<String, Object> f = db.tx(() -> {
            Map<String, Object> row = db.one(
                    "SELECT f.*, d.user_id, d.kind doc_kind FROM staff_documents d JOIN files f ON f.id=d.file_id " +
                    "WHERE d.id=? AND d.removed_at IS NULL", did
            );
            if (row == null) throw new ApiException("NOT_FOUND", 404);
            guardOwner(u, ((Number) row.get("user_id")).longValue());
            db.audit(u.getId(), "STAFF_DOCUMENT_VIEWED", "user:" + row.get("user_id"), row.get("doc_kind") + " #" + did, "access");
            return row;
        });

        Path path = filesDir().resolve((String) f.get("path"));
        if (!Files.exists(path)) throw new ApiException("FILE_EXPIRED_OR_MISSING", 404);

        try {
            byte[] bytes = Files.readAllBytes(path);
            return ResponseEntity.ok()
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .contentType(MediaType.parseMediaType((String) f.get("mime")))
                    .body(bytes);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to read doc bytes", e);
        }
    }

    @DeleteMapping("/team/documents/{did}")
    public Map<String, Object> removeDocument(@PathVariable long did, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "team.profiles");

        return db.tx(() -> {
            Map<String, Object> r = db.one("SELECT * FROM staff_documents WHERE id=? AND removed_at IS NULL", did);
            if (r == null) throw new ApiException("NOT_FOUND", 404);
            long uid = ((Number) r.get("user_id")).longValue();
            guardOwner(u, uid);

            db.exec("UPDATE staff_documents SET removed_at=?, removed_by=? WHERE id=?", Times.stamp(), u.getId(), did);
            db.audit(u.getId(), "STAFF_DOCUMENT_REMOVED", "user:" + uid, r.get("kind") + " #" + did, "access");
            return Map.of("ok", true);
        });
    }
}
