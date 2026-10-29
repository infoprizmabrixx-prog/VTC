package in.vasavi.vtc.area.auth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.vasavi.vtc.catalog.PermissionCatalog;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.security.PasswordHasher;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.regex.Pattern;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/v1")
public class AuthController {

    private static final int MAX_ATTEMPTS = 5;
    private static final int LOCK_MINUTES = 10;

    private final Db db;
    private final PasswordHasher hasher;
    private final SessionService sessionService;
    private final PermissionCatalog catalog;
    private final ObjectMapper mapper;

    public AuthController(Db db, PasswordHasher hasher, SessionService sessionService,
                          PermissionCatalog catalog, ObjectMapper mapper) {
        this.db = db;
        this.hasher = hasher;
        this.sessionService = sessionService;
        this.catalog = catalog;
        this.mapper = mapper;
    }

    private static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() != 0;
        return Boolean.parseBoolean(v.toString());
    }

    private void attempt(Map<String, Object> row, String raw, String kind) {
        if (row == null) {
            db.newTxVoid(() -> db.audit(null, "LOGIN_FAILED", "unknown", kind, "access"));
            throw new ApiException("INVALID_CREDENTIALS", 401);
        }
        long uid = ((Number) row.get("id")).longValue();
        if (!truthy(row.get("active")) || !truthy(row.get("role_active"))) {
            db.newTxVoid(() -> db.audit(uid, "LOGIN_BLOCKED_INACTIVE", "user:" + uid, kind, "access"));
            throw new ApiException("ACCOUNT_DISABLED", 403);
        }
        String lockedUntil = (String) row.get("locked_until");
        if (lockedUntil != null && Times.parse(lockedUntil).isAfter(Times.now())) {
            throw new ApiException("ACCOUNT_LOCKED_TRY_LATER", 423);
        }
        if (!kind.equals(row.get("login_type"))) {
            throw new ApiException("WRONG_SIGN_IN_METHOD", 400);
        }
        if (!hasher.verifySecret(raw, (String) row.get("secret_hash"))) {
            int tries = ((Number) row.get("failed_attempts")).intValue() + 1;
            boolean lock = tries >= MAX_ATTEMPTS;
            String lockUntil = lock ? Times.later(LOCK_MINUTES) : null;
            db.newTxVoid(() -> {
                db.exec("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?",
                        lock ? 0 : tries, lockUntil, uid);
                db.audit(null, "LOGIN_FAILED", "user:" + uid, lock ? "locked" : ("attempt " + tries), "access");
            });
            throw new ApiException("INVALID_CREDENTIALS", 401);
        }
        db.txVoid(() -> {
            db.exec("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?", uid);
            db.audit(uid, "LOGIN_OK", "user:" + uid, kind, "access");
        });
    }

    @PostMapping("/login")
    public Map<String, Object> loginPassword(@RequestBody(required = false) Map<String, Object> d,
                                             HttpServletRequest req, HttpServletResponse res) {
        String username = d != null && d.get("username") != null ? d.get("username").toString().trim().toLowerCase() : "";
        String password = d != null && d.get("password") != null ? d.get("password").toString() : "";
        String mode = d != null && d.get("device_mode") != null ? d.get("device_mode").toString() : "personal";
        Map<String, Object> row = db.one(
                "SELECT u.*, r.active role_active FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.username)=?",
                username
        );
        attempt(row, password, "password");
        long uid = ((Number) row.get("id")).longValue();
        String m = sessionService.createSession(uid, mode, req, res);
        return Map.of(
                "ok", true,
                "device_mode", m,
                "must_change_secret", truthy(row.get("must_change_secret"))
        );
    }

    @GetMapping("/login/pin-people")
    public List<Map<String, Object>> pinPeople() {
        return db.rows(
                "SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id=u.role_id " +
                "WHERE u.login_type='pin' AND u.active=1 AND r.active=1 ORDER BY u.full_name"
        );
    }

    @PostMapping("/login/pin")
    public Map<String, Object> loginPin(@RequestBody(required = false) Map<String, Object> d,
                                        HttpServletRequest req, HttpServletResponse res) {
        String pin = d != null && d.get("pin") != null ? d.get("pin").toString().trim() : "";
        String mode = d != null && d.get("device_mode") != null ? d.get("device_mode").toString() : "shared";
        Map<String, Object> row = null;
        if (d != null && d.get("user_id") != null && !"".equals(d.get("user_id"))) {
            try {
                long uid = Long.parseLong(d.get("user_id").toString());
                row = db.one("SELECT u.*, r.active role_active FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?", uid);
            } catch (NumberFormatException ignored) {
            }
        } else {
            String uname = d != null && d.get("username") != null ? d.get("username").toString().trim().toLowerCase() : "";
            row = db.one("SELECT u.*, r.active role_active FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.username)=?", uname);
        }
        attempt(row, pin, "pin");
        long uid = ((Number) row.get("id")).longValue();
        String m = sessionService.createSession(uid, mode, req, res);
        return Map.of(
                "ok", true,
                "device_mode", m,
                "must_change_secret", truthy(row.get("must_change_secret"))
        );
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest req, HttpServletResponse res) {
        String token = sessionService.extractCookie(req);
        if (token != null) {
            String th = hasher.tokenHash(token);
            db.txVoid(() -> {
                Map<String, Object> s = db.one("SELECT user_id FROM sessions WHERE token_hash=?", th);
                db.exec("DELETE FROM sessions WHERE token_hash=?", th);
                if (s != null && s.get("user_id") != null) {
                    long uid = ((Number) s.get("user_id")).longValue();
                    db.audit(uid, "LOGOUT", "user:" + uid, "", "access");
                }
            });
        }
        sessionService.clearCookie(res);
        return Map.of("ok", true);
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> prefs = db.one("SELECT * FROM dashboard_prefs WHERE user_id=?", u.getId());
        Map<String, Object> defs = db.one("SELECT * FROM role_dashboard_defaults WHERE role_id=?", u.getRoleId());
        Map<String, Object> settings = db.allSettings();

        List<String> defWidgets = catalog.getDefaultWidgets().getOrDefault(u.getTier(), List.of());
        List<String> defShortcuts = catalog.getDefaultShortcuts();
        try {
            if (defs != null && defs.get("widgets") != null) {
                defWidgets = mapper.readValue(defs.get("widgets").toString(), new TypeReference<>() {});
            }
            if (defs != null && defs.get("shortcuts") != null) {
                defShortcuts = mapper.readValue(defs.get("shortcuts").toString(), new TypeReference<>() {});
            }
        } catch (Exception ignored) {
        }

        List<String> rawWidgets = defWidgets;
        List<String> rawShortcuts = defShortcuts;
        Map<String, String> rawSizes = new LinkedHashMap<>();
        try {
            if (prefs != null && prefs.get("widgets") != null) {
                rawWidgets = mapper.readValue(prefs.get("widgets").toString(), new TypeReference<>() {});
            }
            if (prefs != null && prefs.get("shortcuts") != null) {
                rawShortcuts = mapper.readValue(prefs.get("shortcuts").toString(), new TypeReference<>() {});
            }
            if (prefs != null && prefs.get("sizes") != null) {
                rawSizes = mapper.readValue(prefs.get("sizes").toString(), new TypeReference<>() {});
            }
        } catch (Exception ignored) {
        }

        List<String> widgets = new ArrayList<>();
        for (String w : rawWidgets) {
            List<String> wSpec = catalog.getWidgets().get(w);
            if (wSpec != null && u.can(wSpec.get(1))) {
                widgets.add(w);
            }
        }

        List<String> visibleModules = new ArrayList<>();
        for (List<String> m : catalog.getModules()) {
            String mk = m.get(0);
            if (catalog.moduleVisible(mk, u.getPerms())) {
                visibleModules.add(mk);
            }
        }

        List<String> shortcuts = new ArrayList<>();
        for (String s : rawShortcuts) {
            if (visibleModules.contains(s)) {
                shortcuts.add(s);
            }
        }

        Map<String, String> sizes = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : rawSizes.entrySet()) {
            if (catalog.getWidgets().containsKey(e.getKey()) && List.of("s", "m", "l").contains(e.getValue())) {
                sizes.put(e.getKey(), e.getValue());
            }
        }

        List<Map<String, String>> availableWidgets = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : catalog.getWidgets().entrySet()) {
            if (u.can(e.getValue().get(1))) {
                availableWidgets.add(Map.of(
                        "id", e.getKey(),
                        "key", e.getKey(),
                        "title", e.getValue().get(0),
                        "label", e.getValue().get(0)
                ));
            }
        }

        Set<String> liveModules = catalog.getLiveModules();
        int idleMinutes = "shared".equals(u.getDeviceMode())
                ? ((Number) settings.getOrDefault("idle_shared_min", 15)).intValue()
                : ((Number) settings.getOrDefault("idle_personal_min", 480)).intValue();

        String insightsUntil = (String) u.get("insights_until");
        boolean insightsUnlocked = insightsUntil != null && Times.parse(insightsUntil).isAfter(Times.now());

        List<String> sortedPerms = new ArrayList<>(u.getPerms());
        Collections.sort(sortedPerms);

        Map<String, Object> userOut = new LinkedHashMap<>();
        userOut.put("id", u.getId());
        userOut.put("username", u.getUsername());
        userOut.put("full_name", u.getFullName());
        userOut.put("role_id", u.getRoleId());
        userOut.put("role_key", u.getRoleKey());
        userOut.put("role_name", u.getRoleName());
        userOut.put("tier", u.getTier());
        userOut.put("login_type", u.getLoginType());
        userOut.put("is_owner", u.isOwner());
        userOut.put("must_change_secret", u.isMustChangeSecret());
        userOut.put("device_mode", u.getDeviceMode());
        userOut.put("insights_unlocked", insightsUnlocked);

        Map<String, Object> prefsOut = new LinkedHashMap<>();
        prefsOut.put("widgets", widgets);
        prefsOut.put("shortcuts", shortcuts);
        prefsOut.put("sizes", sizes);
        prefsOut.put("welcome", prefs != null && prefs.get("welcome") != null ? prefs.get("welcome") : "");
        prefsOut.put("lang", prefs != null && prefs.get("lang") != null ? prefs.get("lang") : settings.get("default_language"));
        prefsOut.put("large_text", prefs != null && truthy(prefs.get("large_text")));
        prefsOut.put("voice_rate", prefs != null && prefs.get("voice_rate") != null ? ((Number) prefs.get("voice_rate")).doubleValue() : 0.95);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", userOut);
        out.put("perms", sortedPerms);
        out.put("permissions", sortedPerms);
        out.put("modules", visibleModules);
        out.put("live_modules", liveModules);
        out.put("available_widgets", availableWidgets);
        out.put("prefs", prefsOut);
        out.put("settings", settings);
        out.put("idle_minutes", idleMinutes);
        return out;
    }

    @PostMapping("/me/secret")
    public Map<String, Object> changeOwnSecret(@RequestBody(required = false) Map<String, Object> d,
                                               HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        String currentSecret = d != null && d.get("current") != null ? d.get("current").toString() : "";
        String newSecret = d != null && d.get("new") != null ? d.get("new").toString() : (d != null && d.get("new_secret") != null ? d.get("new_secret").toString() : "");
        db.txVoid(() -> {
            Map<String, Object> row = db.one("SELECT secret_hash, login_type FROM users WHERE id=?", u.getId());
            if (!hasher.verifySecret(currentSecret, (String) row.get("secret_hash"))) {
                throw new ApiException("CURRENT_SECRET_WRONG", 400);
            }
            if ("password".equals(row.get("login_type"))) {
                hasher.validPassword(newSecret);
            } else {
                hasher.validPin(newSecret);
            }
            db.exec("UPDATE users SET secret_hash=?, must_change_secret=0 WHERE id=?", hasher.hashSecret(newSecret), u.getId());
            db.exec("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", u.getId(), u.getSessionTokenHash());
            db.audit(u.getId(), "OWN_SECRET_CHANGED", "user:" + u.getId(), "", "access");
        });
        return Map.of("ok", true);
    }

    @PutMapping("/me/preferences")
    @SuppressWarnings("unchecked")
    public Map<String, Object> savePreferences(@RequestBody(required = false) Map<String, Object> d,
                                               HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        if (d == null) d = Map.of();

        Set<String> allowedWidgets = new LinkedHashSet<>();
        for (Map.Entry<String, List<String>> e : catalog.getWidgets().entrySet()) {
            if (u.can(e.getValue().get(1))) {
                allowedWidgets.add(e.getKey());
            }
        }

        Object wObj = d.getOrDefault("widgets", List.of());
        if (!(wObj instanceof List<?> wList)) {
            throw new ApiException("INVALID_WIDGET_SELECTION");
        }
        List<String> widgets = new ArrayList<>();
        for (Object x : wList) {
            if (x == null || !allowedWidgets.contains(x.toString())) {
                throw new ApiException("INVALID_WIDGET_SELECTION");
            }
            widgets.add(x.toString());
        }
        if (new LinkedHashSet<>(widgets).size() != widgets.size()) {
            throw new ApiException("INVALID_WIDGET_SELECTION");
        }

        List<String> visibleModules = new ArrayList<>();
        for (List<String> m : catalog.getModules()) {
            if (catalog.moduleVisible(m.get(0), u.getPerms())) {
                visibleModules.add(m.get(0));
            }
        }
        Object sObj = d.getOrDefault("shortcuts", List.of());
        if (!(sObj instanceof List<?> sList) || sList.size() > 7) {
            throw new ApiException("INVALID_SHORTCUT");
        }
        List<String> shortcuts = new ArrayList<>();
        for (Object x : sList) {
            if (x == null || !visibleModules.contains(x.toString())) {
                throw new ApiException("INVALID_SHORTCUT");
            }
            shortcuts.add(x.toString());
        }
        if (new LinkedHashSet<>(shortcuts).size() != shortcuts.size()) {
            throw new ApiException("INVALID_SHORTCUT");
        }

        String welcome = d.get("welcome") != null ? d.get("welcome").toString().trim() : "";
        if (welcome.length() > 75) welcome = welcome.substring(0, 75);
        String lang = d.get("lang") != null ? d.get("lang").toString() : "en";

        Map<String, String> sizes = new LinkedHashMap<>();
        if (d.get("sizes") instanceof Map<?, ?> szMap) {
            for (Map.Entry<?, ?> e : szMap.entrySet()) {
                String k = e.getKey().toString();
                String v = e.getValue() != null ? e.getValue().toString() : "";
                if (!widgets.contains(k) || !List.of("s", "m", "l").contains(v)) {
                    throw new ApiException("INVALID_WIDGET_SELECTION");
                }
                sizes.put(k, v);
            }
        }

        double rate = 0.95;
        if (d.containsKey("voice_rate") && d.get("voice_rate") != null) {
            try {
                rate = Math.round(Double.parseDouble(d.get("voice_rate").toString()) * 100.0) / 100.0;
            } catch (Exception e) {
                throw new ApiException("INVALID_VOICE_SPEED");
            }
            if (rate < 0.6 || rate > 1.4) {
                throw new ApiException("INVALID_VOICE_SPEED");
            }
        }

        final double finalRate = rate;
        final String finalWelcome = welcome;
        final String finalLang = lang;
        final int largeText = truthy(d.get("large_text")) ? 1 : 0;
        db.txVoid(() -> {
            List<String> enabledLangs = (List<String>) db.getSetting("languages_enabled");
            if (enabledLangs == null || !enabledLangs.contains(finalLang)) {
                throw new ApiException("INVALID_LANGUAGE");
            }
            try {
                String wJson = mapper.writeValueAsString(widgets);
                String sJson = mapper.writeValueAsString(shortcuts);
                String szJson = mapper.writeValueAsString(sizes);
                db.exec(
                        "INSERT INTO dashboard_prefs(user_id, widgets, shortcuts, welcome, lang, large_text, sizes, voice_rate) " +
                        "VALUES(?,?,?,?,?,?,?,?) " +
                        "ON DUPLICATE KEY UPDATE widgets=VALUES(widgets), shortcuts=VALUES(shortcuts), " +
                        "welcome=VALUES(welcome), lang=VALUES(lang), large_text=VALUES(large_text), sizes=VALUES(sizes), voice_rate=VALUES(voice_rate)",
                        u.getId(), wJson, sJson, finalWelcome, finalLang, largeText, szJson, finalRate
                );
                db.audit(u.getId(), "DASHBOARD_EDIT", "user:" + u.getId(), "", "operations");
            } catch (ApiException ae) {
                throw ae;
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        return Map.of("ok", true);
    }

    @GetMapping("/i18n")
    public Map<String, Map<String, String>> getI18n() {
        Map<String, Map<String, String>> out = new LinkedHashMap<>();
        out.put("en", new LinkedHashMap<>());
        out.put("te", new LinkedHashMap<>());
        out.put("hi", new LinkedHashMap<>());
        for (Map<String, Object> r : db.rows("SELECT lang, `key`, text FROM i18n_overrides")) {
            String lang = (String) r.get("lang");
            String key = (String) r.get("key");
            String text = (String) r.get("text");
            if (out.containsKey(lang)) {
                out.get(lang).put(key, text);
            }
        }
        return out;
    }

    private static final Pattern PHONE_RE = Pattern.compile("^\\+?[0-9 ]{10,15}$");
    private static final Pattern EMAIL_RE = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final List<String> SELF_FIELDS = List.of("phone", "alt_phone", "email", "emergency_name", "emergency_phone");
    private static final Map<String, Integer> PLAIN_LIMITS = Map.of(
            "phone", 15, "alt_phone", 15, "emergency_phone", 15,
            "email", 120, "emergency_name", 60
    );

    private static final List<String[]> BROWSERS = List.of(
            new String[]{"MiuiBrowser", "Mi Browser"},
            new String[]{"VivoBrowser", "Vivo Browser"},
            new String[]{"HeyTapBrowser", "Oppo Browser"},
            new String[]{"OppoBrowser", "Oppo Browser"},
            new String[]{"SamsungBrowser", "Samsung Internet"},
            new String[]{"EdgA/", "Edge"},
            new String[]{"Edg/", "Edge"},
            new String[]{"OPR/", "Opera"},
            new String[]{"FxiOS", "Firefox"},
            new String[]{"Firefox/", "Firefox"},
            new String[]{"CriOS", "Chrome"},
            new String[]{"; wv)", "In-app browser"},
            new String[]{"Chrome/", "Chrome"},
            new String[]{"Safari/", "Safari"}
    );

    private static final List<Object[]> WORK_ITEMS = List.of(
            new Object[]{"Stock inputs", "SELECT COUNT(*) FROM receipts WHERE created_by=? AND created_at>=?"},
            new Object[]{"Roast batches", "SELECT COUNT(*) FROM roast_batches WHERE created_by=? AND created_at>=?"},
            new Object[]{"Quality checks", "SELECT COUNT(*) FROM qc_events WHERE user_id=? AND created_at>=?"},
            new Object[]{"Grinding jobs", "SELECT COUNT(*) FROM grind_jobs WHERE created_by=? AND created_at>=?"},
            new Object[]{"Blends", "SELECT COUNT(*) FROM blend_jobs WHERE created_by=? AND created_at>=?"},
            new Object[]{"Sent to the counter", "SELECT COUNT(*) FROM transfers WHERE sent_by=? AND created_at>=?"},
            new Object[]{"Received at the counter", "SELECT COUNT(*) FROM transfers WHERE received_by=? AND received_at>=?"},
            new Object[]{"Counter bills", "SELECT COUNT(*) FROM counter_sales WHERE created_by=? AND created_at>=?"},
            new Object[]{"Stock counts", "SELECT COUNT(*) FROM cycle_counts WHERE counted_by=? AND created_at>=?"},
            new Object[]{"Dispatches", "SELECT COUNT(*) FROM dispatches WHERE handed_by=? AND created_at>=?"},
            new Object[]{"Payments recorded", "SELECT COUNT(*) FROM collections WHERE recorded_by=? AND created_at>=?"},
            new Object[]{"Tasks finished", "SELECT COUNT(*) FROM tasks WHERE assigned_to=? AND status='DONE' AND reviewed_at>=?"},
            new Object[]{"Repairs reported", "SELECT COUNT(*) FROM maintenance WHERE raised_by=? AND created_at>=?"}
    );

    private String deviceName(String ua) {
        if (ua == null || ua.isBlank()) return "Unknown device";
        String browser = "Browser";
        for (String[] b : BROWSERS) {
            if (ua.contains(b[0])) {
                browser = b[1];
                break;
            }
        }
        String system = ua.contains("iPhone") ? "iPhone"
                : ua.contains("iPad") ? "iPad"
                : ua.contains("Android") ? "Android"
                : ua.contains("Windows") ? "Windows"
                : ua.contains("Macintosh") ? "Mac"
                : ua.contains("Linux") ? "Linux"
                : "";
        return system.isEmpty() ? browser : (browser + " on " + system);
    }

    private Map<String, Object> cleanContact(Map<String, Object> d, List<String> keys) {
        Map<String, Object> vals = new LinkedHashMap<>();
        for (String k : keys) {
            if (d.containsKey(k)) {
                String val = d.get(k) != null ? d.get(k).toString().trim() : "";
                int lim = PLAIN_LIMITS.getOrDefault(k, 100);
                if (val.length() > lim) val = val.substring(0, lim);
                vals.put(k, val);
            }
        }
        for (String k : List.of("phone", "alt_phone", "emergency_phone")) {
            String val = (String) vals.get(k);
            if (val != null && !val.isEmpty() && !PHONE_RE.matcher(val).matches()) {
                throw new ApiException("INVALID_PHONE", 400);
            }
        }
        String em = (String) vals.get("email");
        if (em != null && !em.isEmpty() && !EMAIL_RE.matcher(em).matches()) {
            throw new ApiException("INVALID_EMAIL", 400);
        }
        return vals;
    }

    @GetMapping("/me/profile")
    public Map<String, Object> myProfile(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        long uid = u.getId();
        Map<String, Object> p = db.one("SELECT designation, phone, alt_phone, email, emergency_name, emergency_phone, joined_on FROM staff_profiles WHERE user_id=?", uid);
        if (p == null) p = Map.of();

        Map<String, Object> boss = db.one("SELECT b.id, b.full_name, r.name role_name FROM users me JOIN users b ON b.id=me.reports_to " +
                "JOIN roles r ON r.id=b.role_id WHERE me.id=? AND b.active=1", uid);

        List<Map<String, Object>> reports = db.rows("SELECT u.id, u.full_name, r.name role_name FROM users u JOIN roles r ON r.id=u.role_id " +
                "WHERE u.reports_to=? AND u.active=1 ORDER BY u.full_name", uid);

        List<String> teams = new ArrayList<>();
        for (Map<String, Object> r : db.rows("SELECT t.name FROM user_teams x JOIN teams t ON t.id=x.team_id WHERE x.user_id=? ORDER BY t.name", uid)) {
            teams.add((String) r.get("name"));
        }

        LocalDate today = Times.todayIst();
        LocalDate mStart = LocalDate.of(today.getYear(), today.getMonth(), 1);
        String since = Times.stamp(mStart.atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant());

        List<Map<String, Object>> work = new ArrayList<>();
        for (Object[] item : WORK_ITEMS) {
            String label = (String) item[0];
            String sql = (String) item[1];
            long n = db.queryForLong(sql, uid, since);
            if (n > 0) {
                work.add(Map.of("label", label, "count", n));
            }
        }

        String curTokenHash = u.getSessionTokenHash();
        List<Map<String, Object>> sessionRows = db.rows(
                "SELECT sid id, device_mode, created_at, last_seen, user_agent, token_hash " +
                "FROM sessions WHERE user_id=? AND expires_at>? ORDER BY last_seen DESC",
                uid, Times.stamp()
        );
        List<Map<String, Object>> sessions = new ArrayList<>();
        for (Map<String, Object> s : sessionRows) {
            Map<String, Object> sm = new LinkedHashMap<>();
            sm.put("id", s.get("id"));
            sm.put("device_mode", s.get("device_mode"));
            sm.put("created_at", s.get("created_at"));
            sm.put("last_seen", s.get("last_seen"));
            String ua = s.get("user_agent") != null ? s.get("user_agent").toString() : "";
            sm.put("device", deviceName(ua));
            String th = (String) s.get("token_hash");
            sm.put("this", curTokenHash != null && curTokenHash.equals(th));
            sessions.add(sm);
        }

        Map<String, String> names = new LinkedHashMap<>();
        for (List<String> m : catalog.getModules()) {
            names.put(m.get(0), m.get(1));
        }

        Map<String, List<String>> accessMap = new LinkedHashMap<>();
        for (Map<String, Object> pmeta : catalog.getPermissions()) {
            String key = (String) pmeta.get("key");
            boolean live = Boolean.TRUE.equals(pmeta.get("live"));
            if (u.can(key) && live) {
                String mod = (String) pmeta.get("module");
                String area = names.getOrDefault(mod, mod);
                accessMap.computeIfAbsent(area, k -> new ArrayList<>()).add((String) pmeta.get("label"));
            }
        }
        List<Map<String, Object>> accessList = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : accessMap.entrySet()) {
            accessList.add(Map.of("area", e.getKey(), "can", e.getValue()));
        }

        Map<String, Object> contact = new LinkedHashMap<>();
        for (String k : SELF_FIELDS) {
            contact.put(k, p.getOrDefault(k, ""));
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("contact", contact);
        res.put("designation", p.getOrDefault("designation", ""));
        res.put("joined_on", p.get("joined_on"));
        res.put("boss", boss);
        res.put("reports", reports);
        res.put("teams", teams);
        res.put("work", work);
        res.put("work_since", since);
        res.put("sessions", sessions);
        res.put("access", accessList);
        return res;
    }

    @PutMapping("/me/profile")
    public Map<String, Object> saveMyProfile(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        Map<String, Object> vals = cleanContact(body, SELF_FIELDS);
        if (vals.isEmpty()) {
            throw new ApiException("NOTHING_TO_CHANGE", 400);
        }
        return db.tx(() -> {
            db.exec("INSERT INTO staff_profiles(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)", u.getId());
            StringBuilder sb = new StringBuilder("UPDATE staff_profiles SET ");
            List<Object> args = new ArrayList<>();
            for (Map.Entry<String, Object> e : vals.entrySet()) {
                sb.append(e.getKey()).append("=?, ");
                args.add(e.getValue());
            }
            sb.append("updated_by=?, updated_at=? WHERE user_id=?");
            args.add(u.getId());
            args.add(Times.stamp());
            args.add(u.getId());
            db.exec(sb.toString(), args.toArray());

            List<String> sortedKeys = new ArrayList<>(vals.keySet());
            Collections.sort(sortedKeys);
            db.audit(u.getId(), "OWN_PROFILE_CHANGED", "user:" + u.getId(), String.join(", ", sortedKeys), "access");
            return Map.of("ok", true);
        });
    }

    @PostMapping("/me/sessions/revoke")
    public Map<String, Object> revokeSessions(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        boolean all = Boolean.TRUE.equals(body.get("all"));
        String curTokenHash = u.getSessionTokenHash();
        return db.tx(() -> {
            int n;
            if (all) {
                n = db.exec("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", u.getId(), curTokenHash);
            } else {
                Object sidObj = body.get("id");
                if (!(sidObj instanceof Number)) {
                    throw new ApiException("NOT_FOUND", 404);
                }
                long sid = ((Number) sidObj).longValue();
                n = db.exec("DELETE FROM sessions WHERE sid=? AND user_id=? AND token_hash!=?", sid, u.getId(), curTokenHash);
                if (n == 0) {
                    throw new ApiException("NOT_FOUND", 404);
                }
            }
            db.audit(u.getId(), "OWN_DEVICES_SIGNED_OUT", "user:" + u.getId(), n + " device(s)", "access");
            return Map.of("signed_out", n);
        });
    }
}
