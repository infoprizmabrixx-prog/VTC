package in.vasavi.vtc.area.admin;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.vasavi.vtc.catalog.PermissionCatalog;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.PasswordHasher;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private static final String ACCESS = "access";
    private static final List<String> ACCENTS = List.of("roast", "espresso", "copper", "forest", "plum");
    private static final List<String> LANGS = List.of("en", "te", "hi");
    private static final List<String> TIERS = List.of("admin", "manager", "staff");

    private record BusinessRule(String kind, Double lo, Double hi) {}

    private static final Map<String, BusinessRule> BUSINESS_SETTINGS = new LinkedHashMap<>();
    static {
        BUSINESS_SETTINGS.put("company_address", new BusinessRule("text", 0.0, 200.0));
        BUSINESS_SETTINGS.put("company_gstin", new BusinessRule("text", 0.0, 20.0));
        BUSINESS_SETTINGS.put("tax_setup_approved", new BusinessRule("bool", null, null));
        BUSINESS_SETTINGS.put("bill_prefix", new BusinessRule("text", 1.0, 8.0));
        BUSINESS_SETTINGS.put("invoice_prefix", new BusinessRule("text", 1.0, 8.0));
        BUSINESS_SETTINGS.put("counter_opening_float_paise", new BusinessRule("money", 0.0, 10_000_000.0));
        BUSINESS_SETTINGS.put("discount_cap_pct", new BusinessRule("number", 0.0, 50.0));
        BUSINESS_SETTINGS.put("refund_manager_cap_paise", new BusinessRule("money", 0.0, 100_000_000.0));
        BUSINESS_SETTINGS.put("correction_manager_cap_kg", new BusinessRule("number", 0.0, 10_000.0));
        BUSINESS_SETTINGS.put("low_stock_alert_kg", new BusinessRule("number", 0.0, 100_000.0));
        BUSINESS_SETTINGS.put("roast_rest_days", new BusinessRule("int", 0.0, 60.0));
        BUSINESS_SETTINGS.put("quiet_start_hour", new BusinessRule("int", 0.0, 23.0));
        BUSINESS_SETTINGS.put("quiet_end_hour", new BusinessRule("int", 0.0, 23.0));
        BUSINESS_SETTINGS.put("staff_can_message_admins", new BusinessRule("bool", null, null));
        BUSINESS_SETTINGS.put("voice_retention_days", new BusinessRule("int", 7.0, 3650.0));
        BUSINESS_SETTINGS.put("custom_coffee_rate_paise", new BusinessRule("money", 1.0, 100_000_000.0));
        BUSINESS_SETTINGS.put("custom_chicory_rate_paise", new BusinessRule("money", 1.0, 100_000_000.0));
        BUSINESS_SETTINGS.put("custom_chicory_product_id", new BusinessRule("int", 1.0, 1_000_000_000.0));
    }

    private final Db db;
    private final PermissionCatalog catalog;
    private final PermissionService permissionService;
    private final SessionService sessionService;
    private final PasswordHasher hasher;
    private final ObjectMapper mapper;

    public AdminController(Db db,
                           PermissionCatalog catalog,
                           PermissionService permissionService,
                           SessionService sessionService,
                           PasswordHasher hasher,
                           ObjectMapper mapper) {
        this.db = db;
        this.catalog = catalog;
        this.permissionService = permissionService;
        this.sessionService = sessionService;
        this.hasher = hasher;
        this.mapper = mapper;
    }

    private Map<String, Object> getRole(Object roleIdObj) {
        if (roleIdObj == null) {
            throw new ApiException("ROLE_NOT_FOUND", 404);
        }
        long roleId;
        try {
            roleId = roleIdObj instanceof Number n ? n.longValue() : Long.parseLong(roleIdObj.toString());
        } catch (Exception e) {
            throw new ApiException("ROLE_NOT_FOUND", 404);
        }
        Map<String, Object> r = db.one("SELECT * FROM roles WHERE id=?", roleId);
        if (r == null) {
            throw new ApiException("ROLE_NOT_FOUND", 404);
        }
        return r;
    }

    private void checkLoginType(Map<String, Object> role, String loginType) {
        if (!List.of("password", "pin").contains(loginType)) {
            throw new ApiException("INVALID_LOGIN_TYPE");
        }
        if ("pin".equals(loginType) && !"staff".equals(role.get("tier"))) {
            throw new ApiException("PIN_ONLY_FOR_STAFF_LEVEL");
        }
    }

    private void checkSecret(String loginType, String secret) {
        if ("pin".equals(loginType)) {
            hasher.validPin(secret);
        } else {
            hasher.validPassword(secret);
        }
    }

    @GetMapping("/catalog")
    public Map<String, Object> getCatalog(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "system.users", "system.roles", "system.grants", "system.preview_as", "system.settings");
        List<Map<String, String>> mods = new ArrayList<>();
        for (List<String> m : catalog.getModules()) {
            mods.add(Map.of("key", m.get(0), "label", m.get(1), "group", m.get(2), "icon", m.get(3)));
        }
        List<Map<String, String>> widgets = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : catalog.getWidgets().entrySet()) {
            widgets.add(Map.of("id", e.getKey(), "title", e.getValue().get(0), "perm", e.getValue().get(1)));
        }
        return Map.of(
                "modules", mods,
                "permissions", catalog.getPermissions(),
                "widgets", widgets,
                "tiers", TIERS
        );
    }

    @GetMapping("/users")
    public List<Map<String, Object>> listUsers(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "system.users", "system.grants", "system.preview_as");
        String now = Times.stamp();
        List<Map<String, Object>> people = db.rows(
                "SELECT u.id, u.username, u.full_name, u.login_type, u.is_owner, u.active, u.locked_until, " +
                "u.created_at, r.id role_id, r.name role_name, r.tier, " +
                "(SELECT MAX(created_at) FROM audit a WHERE a.action='LOGIN' AND a.user_id=u.id) last_login, " +
                "(SELECT COUNT(*) FROM user_grants g WHERE g.user_id=u.id AND g.revoked_at IS NULL " +
                "  AND (g.expires_at IS NULL OR g.expires_at > ?)) active_grants " +
                "FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.active DESC, r.tier, u.full_name",
                now
        );
        for (Map<String, Object> p : people) {
            Object lu = p.remove("locked_until");
            p.put("locked", lu != null && lu.toString().compareTo(now) > 0);
        }
        return people;
    }

    @PostMapping("/users")
    public Map<String, Object> createUser(@RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.users");
        Map<String, Object> body = d != null ? d : Map.of();
        String fullName = ValidationUtils.text(body, "full_name", 2, 80);
        String username = ValidationUtils.text(body, "username", 3, 30).toLowerCase();
        if (!username.matches("[a-z0-9._-]+")) {
            throw new ApiException("USERNAME_LETTERS_NUMBERS_ONLY");
        }
        String loginType = body.get("login_type") != null ? body.get("login_type").toString() : "password";
        String secret = body.get("secret") != null ? body.get("secret").toString() : "";

        return db.tx(() -> {
            Map<String, Object> role = getRole(body.get("role_id"));
            if (!truthy(role.get("active"))) {
                throw new ApiException("ROLE_INACTIVE");
            }
            checkLoginType(role, loginType);
            checkSecret(loginType, secret);
            if (db.one("SELECT 1 FROM users WHERE username=?", username) != null) {
                throw new ApiException("USERNAME_TAKEN");
            }
            int mustChange = "password".equals(loginType) ? 1 : 0;
            String now = Times.stamp();
            long newId = db.insert(
                    "INSERT INTO users(username, full_name, role_id, login_type, secret_hash, must_change_secret, " +
                    "created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                    username, fullName, role.get("id"), loginType, hasher.hashSecret(secret), mustChange, u.getId(), now
            );
            db.audit(u.getId(), "USER_CREATED", "user:" + newId,
                    fullName + " as " + role.get("name") + " (" + loginType + ")", ACCESS);
            return Map.of("id", newId);
        });
    }

    @PutMapping("/users/{uid}")
    public Map<String, Object> updateUser(@PathVariable long uid,
                                          @RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.users");
        Map<String, Object> body = d != null ? d : Map.of();
        db.txVoid(() -> {
            permissionService.assertCanManage(u, uid);
            Map<String, Object> cur = db.one("SELECT * FROM users WHERE id=?", uid);
            List<String> changes = new ArrayList<>();
            if (body.containsKey("full_name")) {
                String name = ValidationUtils.text(body, "full_name", 2, 80);
                db.exec("UPDATE users SET full_name=? WHERE id=?", name, uid);
                changes.add("name→" + name);
            }
            Map<String, Object> role = getRole(body.getOrDefault("role_id", cur.get("role_id")));
            long roleId = ((Number) role.get("id")).longValue();
            long curRoleId = ((Number) cur.get("role_id")).longValue();
            if (roleId != curRoleId) {
                if (!truthy(role.get("active"))) {
                    throw new ApiException("ROLE_INACTIVE");
                }
                checkLoginType(role, (String) cur.get("login_type"));
                db.exec("UPDATE users SET role_id=? WHERE id=?", roleId, uid);
                changes.add("role→" + role.get("name"));
            }
            if (body.containsKey("active")) {
                boolean active = truthy(body.get("active"));
                db.exec("UPDATE users SET active=? WHERE id=?", active ? 1 : 0, uid);
                if (!active) {
                    db.exec("DELETE FROM sessions WHERE user_id=?", uid);
                }
                changes.add(active ? "reactivated" : "deactivated (signed out everywhere)");
            }
            if (changes.isEmpty()) {
                throw new ApiException("NOTHING_TO_CHANGE");
            }
            db.audit(u.getId(), "USER_UPDATED", "user:" + uid, String.join("; ", changes), ACCESS);
        });
        return Map.of("ok", true);
    }

    @PostMapping("/users/{uid}/secret")
    public Map<String, Object> resetUserSecret(@PathVariable long uid,
                                               @RequestBody(required = false) Map<String, Object> d,
                                               HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.users");
        Map<String, Object> body = d != null ? d : Map.of();
        db.txVoid(() -> {
            permissionService.assertCanManage(u, uid);
            Map<String, Object> cur = db.one("SELECT * FROM users WHERE id=?", uid);
            String loginType = body.get("login_type") != null ? body.get("login_type").toString() : (String) cur.get("login_type");
            checkLoginType(getRole(cur.get("role_id")), loginType);
            String secret = body.get("secret") != null ? body.get("secret").toString() : "";
            checkSecret(loginType, secret);
            int mustChange = "password".equals(loginType) ? 1 : 0;
            db.exec("UPDATE users SET login_type=?, secret_hash=?, must_change_secret=?, failed_attempts=0, locked_until=NULL WHERE id=?",
                    loginType, hasher.hashSecret(secret), mustChange, uid);
            db.exec("DELETE FROM sessions WHERE user_id=?", uid);
            db.audit(u.getId(), "USER_SECRET_RESET", "user:" + uid, loginType, ACCESS);
        });
        return Map.of("ok", true);
    }

    private Map<String, Object> explainUser(long uid) {
        Map<String, Object> t = db.one(
                "SELECT u.*, r.`key` role_key, r.name role_name, r.tier, r.active role_active FROM users u " +
                "JOIN roles r ON r.id=u.role_id WHERE u.id=?",
                uid
        );
        if (t == null) {
            throw new ApiException("NOT_FOUND", 404);
        }
        PermissionService.EffectiveResult eff = permissionService.effectiveForRow(t);
        List<Map<String, Object>> grants = db.rows(
                "SELECT g.*, a.full_name granted_by_name FROM user_grants g JOIN users a ON a.id=g.granted_by " +
                "WHERE g.user_id=? ORDER BY g.id DESC LIMIT 100",
                uid
        );
        String now = Times.stamp();
        for (Map<String, Object> g : grants) {
            String state;
            if (g.get("revoked_at") != null) {
                state = "revoked";
            } else if (g.get("expires_at") != null && g.get("expires_at").toString().compareTo(now) <= 0) {
                state = "expired";
            } else {
                state = "active";
            }
            g.put("state", state);
        }
        List<String> sortedPerms = new ArrayList<>(eff.perms());
        Collections.sort(sortedPerms);
        List<String> visibleModules = new ArrayList<>();
        for (List<String> m : catalog.getModules()) {
            if (catalog.moduleVisible(m.get(0), eff.perms())) {
                visibleModules.add(m.get(0));
            }
        }
        List<String> widgets = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : catalog.getWidgets().entrySet()) {
            if (eff.perms().contains(e.getValue().get(1))) {
                widgets.add(e.getKey());
            }
        }
        Map<String, Object> userSummary = new LinkedHashMap<>();
        userSummary.put("id", t.get("id"));
        userSummary.put("full_name", t.get("full_name"));
        userSummary.put("role_name", t.get("role_name"));
        userSummary.put("tier", t.get("tier"));
        userSummary.put("is_owner", truthy(t.get("is_owner")));
        userSummary.put("active", truthy(t.get("active")));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", userSummary);
        out.put("perms", sortedPerms);
        out.put("why", eff.why());
        out.put("grants", grants);
        out.put("modules", visibleModules);
        out.put("widgets", widgets);
        return out;
    }

    @GetMapping("/users/{uid}/access")
    public Map<String, Object> userAccess(@PathVariable long uid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "system.grants", "system.users");
        return explainUser(uid);
    }

    @PostMapping("/users/{uid}/grants")
    public Map<String, Object> addGrant(@PathVariable long uid,
                                        @RequestBody(required = false) Map<String, Object> d,
                                        HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.grants");
        Map<String, Object> body = d != null ? d : Map.of();
        String key = body.get("perm_key") != null ? body.get("perm_key").toString() : null;
        String effect = body.get("effect") != null ? body.get("effect").toString() : "allow";
        if (!List.of("allow", "deny").contains(effect)) {
            throw new ApiException("INVALID_EFFECT");
        }
        String reason = ValidationUtils.text(body, "reason", 5, 200, "REASON_REQUIRED");
        String expires = body.get("expires_at") != null && !body.get("expires_at").toString().isBlank()
                ? body.get("expires_at").toString().trim()
                : null;
        if (expires != null) {
            Instant exp;
            try {
                if (!expires.contains("Z") && !expires.contains("+") && expires.indexOf('-', 10) < 0) {
                    throw new ApiException("INVALID_EXPIRY");
                }
                exp = Times.parse(expires);
            } catch (ApiException e) {
                throw e;
            } catch (Exception e) {
                throw new ApiException("INVALID_EXPIRY");
            }
            if (!exp.isAfter(Times.now())) {
                throw new ApiException("EXPIRY_MUST_BE_IN_FUTURE");
            }
            expires = Times.stamp(exp);
        }
        String finalExpires = expires;
        return db.tx(() -> {
            Map<String, Object> target = permissionService.assertCanManage(u, uid);
            if (key == null || !catalog.getAllKeys().contains(key)) {
                throw new ApiException("UNKNOWN_PERMISSION");
            }
            if ("allow".equals(effect)) {
                permissionService.assertCanHandOut(u, List.of(key));
                permissionService.assertTierAllows((String) target.get("tier"), List.of(key));
            }
            String now = Times.stamp();
            db.exec("UPDATE user_grants SET revoked_at=?, revoked_by=? WHERE user_id=? AND perm_key=? AND revoked_at IS NULL",
                    now, u.getId(), uid, key);
            long gid = db.insert(
                    "INSERT INTO user_grants(user_id, perm_key, effect, reason, expires_at, granted_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?)",
                    uid, key, effect, reason, finalExpires, u.getId(), now
            );
            db.audit(u.getId(), "allow".equals(effect) ? "ACCESS_GRANTED" : "ACCESS_REMOVED", "user:" + uid,
                    key + "; until " + (finalExpires != null ? finalExpires : "no end date") + "; reason: " + reason, ACCESS);
            return Map.of("id", gid);
        });
    }

    @DeleteMapping("/grants/{gid}")
    public Map<String, Object> revokeGrant(@PathVariable long gid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.grants");
        db.txVoid(() -> {
            Map<String, Object> g = db.one("SELECT * FROM user_grants WHERE id=?", gid);
            if (g == null || g.get("revoked_at") != null) {
                throw new ApiException("NOT_FOUND", 404);
            }
            long targetUid = ((Number) g.get("user_id")).longValue();
            permissionService.assertCanManage(u, targetUid);
            db.exec("UPDATE user_grants SET revoked_at=?, revoked_by=? WHERE id=?", Times.stamp(), u.getId(), gid);
            db.audit(u.getId(), "ACCESS_OVERRIDE_ENDED", "user:" + targetUid, g.get("effect") + " " + g.get("perm_key"), ACCESS);
        });
        return Map.of("ok", true);
    }

    @GetMapping("/users/{uid}/preview")
    public Map<String, Object> previewUser(@PathVariable long uid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.preview_as");
        return db.tx(() -> {
            Map<String, Object> data = explainUser(uid);
            db.audit(u.getId(), "PREVIEW_AS", "user:" + uid, "read-only access preview", ACCESS);
            return data;
        });
    }

    @GetMapping("/roles")
    public List<Map<String, Object>> listRoles(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "system.roles", "system.users", "system.grants");
        List<Map<String, Object>> roles = db.rows(
                "SELECT r.*, (SELECT COUNT(*) FROM users x WHERE x.role_id=r.id AND x.active=1) people " +
                "FROM roles r ORDER BY CASE r.tier WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, r.is_system DESC, r.name"
        );
        for (Map<String, Object> r : roles) {
            long rid = ((Number) r.get("id")).longValue();
            if ("admin".equals(r.get("key"))) {
                List<String> all = new ArrayList<>(catalog.getAllKeys());
                Collections.sort(all);
                r.put("permissions", all);
            } else {
                List<String> pList = new ArrayList<>();
                for (Map<String, Object> rp : db.rows("SELECT perm_key FROM role_permissions WHERE role_id=? ORDER BY perm_key", rid)) {
                    pList.add((String) rp.get("perm_key"));
                }
                r.put("permissions", pList);
            }
            r.put("locked", "admin".equals(r.get("key")));
        }
        return roles;
    }

    private void roleGuard(CurrentUser u, Map<String, Object> role) {
        if ("admin".equals(role.get("key"))) {
            throw new ApiException("ADMIN_ROLE_IS_LOCKED", 403);
        }
        long rid = ((Number) role.get("id")).longValue();
        if (rid == u.getRoleId() && !u.isOwner()) {
            throw new ApiException("CANNOT_CHANGE_OWN_ACCESS", 403);
        }
    }

    @PostMapping("/roles")
    public Map<String, Object> createRole(@RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.roles");
        Map<String, Object> body = d != null ? d : Map.of();
        String name = ValidationUtils.text(body, "name", 2, 40);
        String tier = body.get("tier") != null ? body.get("tier").toString() : null;
        if (tier == null || !TIERS.contains(tier)) {
            throw new ApiException("INVALID_TIER");
        }
        String desc = body.get("description") != null ? body.get("description").toString().trim() : "";
        if (desc.length() > 160) desc = desc.substring(0, 160);
        String key = "custom_" + name.toLowerCase().replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
        String finalDesc = desc;

        return db.tx(() -> {
            if (db.one("SELECT 1 FROM roles WHERE `key`=? OR lower(name)=lower(?)", key, name) != null) {
                throw new ApiException("ROLE_NAME_TAKEN");
            }
            Set<String> perms = new TreeSet<>();
            if (body.get("copy_from") != null && !"".equals(body.get("copy_from"))) {
                Map<String, Object> src = getRole(body.get("copy_from"));
                Set<String> srcPerms = new LinkedHashSet<>();
                if ("admin".equals(src.get("key"))) {
                    srcPerms.addAll(catalog.getAllKeys());
                } else {
                    for (Map<String, Object> rp : db.rows("SELECT perm_key FROM role_permissions WHERE role_id=?", src.get("id"))) {
                        srcPerms.add((String) rp.get("perm_key"));
                    }
                }
                for (String p : srcPerms) {
                    if (u.can(p) && ("admin".equals(tier) || !catalog.getAdminOnly().contains(p))) {
                        perms.add(p);
                    }
                }
            }
            long rid = db.insert(
                    "INSERT INTO roles(`key`, name, tier, description, created_at) VALUES(?,?,?,?,?)",
                    key, name, tier, finalDesc, Times.stamp()
            );
            for (String p : perms) {
                db.exec("INSERT INTO role_permissions(role_id, perm_key) VALUES(?,?)", rid, p);
            }
            Map<String, Object> base = db.one(
                    "SELECT d.* FROM role_dashboard_defaults d JOIN roles r ON r.id=d.role_id WHERE r.`key`=?",
                    tier
            );
            db.exec("INSERT INTO role_dashboard_defaults(role_id, widgets, shortcuts) VALUES(?,?,?)",
                    rid,
                    base != null && base.get("widgets") != null ? base.get("widgets") : "[]",
                    base != null && base.get("shortcuts") != null ? base.get("shortcuts") : "[]");
            db.audit(u.getId(), "ROLE_CREATED", "role:" + rid, name + " (" + tier + "), " + perms.size() + " permissions", ACCESS);
            return Map.of("id", rid);
        });
    }

    @PutMapping("/roles/{rid}")
    @SuppressWarnings("unchecked")
    public Map<String, Object> updateRole(@PathVariable long rid,
                                          @RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.roles");
        Map<String, Object> body = d != null ? d : Map.of();
        db.txVoid(() -> {
            Map<String, Object> role = getRole(rid);
            if (body.containsKey("active") || body.containsKey("permissions")) {
                roleGuard(u, role);
            }
            List<String> changes = new ArrayList<>();
            if (body.containsKey("name")) {
                String name = ValidationUtils.text(body, "name", 2, 40);
                if (db.one("SELECT 1 FROM roles WHERE lower(name)=lower(?) AND id!=?", name, rid) != null) {
                    throw new ApiException("ROLE_NAME_TAKEN");
                }
                db.exec("UPDATE roles SET name=? WHERE id=?", name, rid);
                changes.add("name→" + name);
            }
            if (body.containsKey("description")) {
                String desc = body.get("description") != null ? body.get("description").toString().trim() : "";
                if (desc.length() > 160) desc = desc.substring(0, 160);
                db.exec("UPDATE roles SET description=? WHERE id=?", desc, rid);
                changes.add("description");
            }
            if (body.containsKey("active")) {
                if (truthy(role.get("is_system"))) {
                    throw new ApiException("SYSTEM_ROLE_CANNOT_BE_DISABLED");
                }
                boolean active = truthy(body.get("active"));
                if (!active && db.count("SELECT COUNT(*) FROM users WHERE role_id=? AND active=1", rid) > 0) {
                    throw new ApiException("ROLE_STILL_HAS_PEOPLE");
                }
                db.exec("UPDATE roles SET active=? WHERE id=?", active ? 1 : 0, rid);
                changes.add(active ? "enabled" : "disabled");
            }
            if (body.containsKey("permissions")) {
                Set<String> newPerms = new TreeSet<>();
                if (body.get("permissions") instanceof Collection<?> c) {
                    for (Object x : c) if (x != null) newPerms.add(x.toString());
                }
                Set<String> oldPerms = new TreeSet<>();
                for (Map<String, Object> rp : db.rows("SELECT perm_key FROM role_permissions WHERE role_id=?", rid)) {
                    oldPerms.add((String) rp.get("perm_key"));
                }
                Set<String> added = new TreeSet<>(newPerms);
                added.removeAll(oldPerms);
                Set<String> removed = new TreeSet<>(oldPerms);
                removed.removeAll(newPerms);
                permissionService.assertCanHandOut(u, added);
                permissionService.assertTierAllows((String) role.get("tier"), added);
                db.exec("DELETE FROM role_permissions WHERE role_id=?", rid);
                for (String p : newPerms) {
                    db.exec("INSERT INTO role_permissions(role_id, perm_key) VALUES(?,?)", rid, p);
                }
                if (!added.isEmpty()) {
                    changes.add("+" + String.join(", +", added));
                }
                if (!removed.isEmpty()) {
                    changes.add("-" + String.join(", -", removed));
                }
            }
            if (changes.isEmpty()) {
                throw new ApiException("NOTHING_TO_CHANGE");
            }
            db.audit(u.getId(), "ROLE_UPDATED", "role:" + rid, role.get("name") + ": " + String.join("; ", changes), ACCESS);
        });
        return Map.of("ok", true);
    }

    @GetMapping("/settings")
    public Map<String, Object> getSettings(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        Map<String, Object> s = db.allSettings();
        List<Map<String, Object>> overrides = db.rows("SELECT lang, `key`, text FROM i18n_overrides ORDER BY `key`, lang");
        List<Map<String, Object>> defaults = db.rows(
                "SELECT d.role_id, d.widgets, d.shortcuts, r.name role_name, r.tier FROM role_dashboard_defaults d " +
                "JOIN roles r ON r.id=d.role_id WHERE r.active=1 ORDER BY r.tier, r.name"
        );
        for (Map<String, Object> x : defaults) {
            try {
                x.put("widgets", mapper.readValue(x.get("widgets").toString(), new TypeReference<>() {}));
                x.put("shortcuts", mapper.readValue(x.get("shortcuts").toString(), new TypeReference<>() {}));
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        return Map.of(
                "settings", s,
                "i18n_overrides", overrides,
                "dashboard_defaults", defaults,
                "accents", ACCENTS
        );
    }

    private Object businessValue(String key, Object v) {
        BusinessRule rule = BUSINESS_SETTINGS.get(key);
        String kind = rule.kind();
        if ("bool".equals(kind)) {
            return truthy(v);
        }
        if ("text".equals(kind)) {
            String s = v != null ? v.toString().trim() : "";
            if (s.length() < rule.lo() || s.length() > rule.hi()) {
                throw new ApiException("INVALID_" + key.toUpperCase());
            }
            return s;
        }
        if (v == null || "".equals(v)) {
            return null;
        }
        double n;
        try {
            n = v instanceof Number num ? num.doubleValue() : Double.parseDouble(v.toString());
        } catch (Exception e) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        if ("int".equals(kind) || "money".equals(kind)) {
            if (n != (long) n) {
                throw new ApiException("INVALID_" + key.toUpperCase());
            }
            if (n < rule.lo() || n > rule.hi()) {
                throw new ApiException("INVALID_" + key.toUpperCase());
            }
            return (long) n;
        }
        if (n < rule.lo() || n > rule.hi()) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        return n;
    }

    @PutMapping("/settings")
    @SuppressWarnings("unchecked")
    public Map<String, Object> putSettings(@RequestBody(required = false) Map<String, Object> d,
                                           HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        Map<String, Object> body = d != null ? d : Map.of();
        Map<String, Object> clean = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : body.entrySet()) {
            String k = entry.getKey();
            Object v = entry.getValue();
            if ("company_name".equals(k)) {
                clean.put(k, ValidationUtils.text(body, k, 2, 60));
            } else if (List.of("short_name", "tagline", "location_label").contains(k)) {
                clean.put(k, ValidationUtils.text(body, k, 1, 24));
            } else if ("accent".equals(k)) {
                if (v == null || !ACCENTS.contains(v.toString())) {
                    throw new ApiException("INVALID_ACCENT");
                }
                clean.put(k, v.toString());
            } else if ("languages_enabled".equals(k)) {
                if (!(v instanceof List<?> list) || list.isEmpty()) {
                    throw new ApiException("ENGLISH_MUST_STAY_ENABLED");
                }
                List<String> strList = new ArrayList<>();
                for (Object item : list) {
                    if (item == null || !LANGS.contains(item.toString())) {
                        throw new ApiException("ENGLISH_MUST_STAY_ENABLED");
                    }
                    strList.add(item.toString());
                }
                if (!strList.contains("en")) {
                    throw new ApiException("ENGLISH_MUST_STAY_ENABLED");
                }
                List<String> ordered = new ArrayList<>();
                for (String l : LANGS) {
                    if (strList.contains(l)) ordered.add(l);
                }
                clean.put(k, ordered);
            } else if ("default_language".equals(k)) {
                if (v == null || !LANGS.contains(v.toString())) {
                    throw new ApiException("INVALID_LANGUAGE");
                }
                clean.put(k, v.toString());
            } else if ("idle_shared_min".equals(k) || "idle_personal_min".equals(k)) {
                int n;
                try {
                    if (v instanceof Boolean) throw new IllegalArgumentException();
                    n = v instanceof Number num ? num.intValue() : Integer.parseInt(v.toString());
                } catch (Exception e) {
                    throw new ApiException("INVALID_" + k.toUpperCase());
                }
                boolean valid = "idle_shared_min".equals(k) ? (n >= 2 && n <= 60) : (n >= 15 && n <= 720);
                if (!valid) {
                    throw new ApiException("INVALID_" + k.toUpperCase());
                }
                clean.put(k, n);
            } else if (BUSINESS_SETTINGS.containsKey(k)) {
                clean.put(k, businessValue(k, v));
            } else {
                throw new ApiException("UNKNOWN_SETTING");
            }
        }
        db.txVoid(() -> {
            List<String> langs = clean.containsKey("languages_enabled")
                    ? (List<String>) clean.get("languages_enabled")
                    : (List<String>) db.getSetting("languages_enabled");
            String defLang = clean.containsKey("default_language")
                    ? (String) clean.get("default_language")
                    : (String) db.getSetting("default_language");
            if (langs == null || !langs.contains(defLang)) {
                throw new ApiException("DEFAULT_LANGUAGE_MUST_BE_ENABLED");
            }
            String now = Times.stamp();
            List<String> summary = new ArrayList<>();
            for (Map.Entry<String, Object> entry : clean.entrySet()) {
                try {
                    String jsonVal = mapper.writeValueAsString(entry.getValue());
                    db.exec("INSERT INTO settings(`key`, `value`, changed_by, changed_at) VALUES(?,?,?,?) " +
                            "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), changed_by=VALUES(changed_by), changed_at=VALUES(changed_at)",
                            entry.getKey(), jsonVal, u.getId(), now);
                    summary.add(entry.getKey() + "=" + entry.getValue());
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }
            db.audit(u.getId(), "SETTINGS_CHANGED", "settings", String.join(", ", summary), ACCESS);
        });
        return Map.of("ok", true);
    }

    @PutMapping("/i18n")
    public Map<String, Object> putWording(@RequestBody(required = false) Map<String, Object> d,
                                          HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        Map<String, Object> body = d != null ? d : Map.of();
        String lang = body.get("lang") != null ? body.get("lang").toString() : null;
        String key = ValidationUtils.text(body, "key", 1, 60);
        if (lang == null || !LANGS.contains(lang)) {
            throw new ApiException("INVALID_LANGUAGE");
        }
        String words = body.get("text") != null ? body.get("text").toString().trim() : "";
        if (words.length() > 120) words = words.substring(0, 120);
        String finalWords = words;
        db.txVoid(() -> {
            if (!finalWords.isEmpty()) {
                db.exec("INSERT INTO i18n_overrides(lang, `key`, text, changed_by, changed_at) VALUES(?,?,?,?,?) " +
                        "ON DUPLICATE KEY UPDATE text=VALUES(text), changed_by=VALUES(changed_by), changed_at=VALUES(changed_at)",
                        lang, key, finalWords, u.getId(), Times.stamp());
            } else {
                db.exec("DELETE FROM i18n_overrides WHERE lang=? AND `key`=?", lang, key);
            }
            db.audit(u.getId(), "WORDING_CHANGED", "i18n:" + lang + ":" + key,
                    !finalWords.isEmpty() ? finalWords : "(restored default)", ACCESS);
        });
        return Map.of("ok", true);
    }

    @PutMapping("/dashboard-defaults/{rid}")
    public Map<String, Object> putDashboardDefault(@PathVariable long rid,
                                                   @RequestBody(required = false) Map<String, Object> d,
                                                   HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        Map<String, Object> body = d != null ? d : Map.of();
        Object wObj = body.getOrDefault("widgets", List.of());
        Object sObj = body.getOrDefault("shortcuts", List.of());
        if (!(wObj instanceof List<?> wList)) {
            throw new ApiException("INVALID_WIDGET_SELECTION");
        }
        List<String> widgets = new ArrayList<>();
        for (Object x : wList) {
            if (x == null || !catalog.getWidgets().containsKey(x.toString())) {
                throw new ApiException("INVALID_WIDGET_SELECTION");
            }
            widgets.add(x.toString());
        }
        if (new LinkedHashSet<>(widgets).size() != widgets.size()) {
            throw new ApiException("INVALID_WIDGET_SELECTION");
        }
        if (!(sObj instanceof List<?> sList) || sList.size() > 7) {
            throw new ApiException("INVALID_SHORTCUT");
        }
        List<String> shortcuts = new ArrayList<>();
        for (Object x : sList) {
            if (x == null || !catalog.getModuleMap().containsKey(x.toString())) {
                throw new ApiException("INVALID_SHORTCUT");
            }
            shortcuts.add(x.toString());
        }
        return db.tx(() -> {
            Map<String, Object> role = getRole(rid);
            try {
                String wJson = mapper.writeValueAsString(widgets);
                String sJson = mapper.writeValueAsString(shortcuts);
                db.exec("INSERT INTO role_dashboard_defaults(role_id, widgets, shortcuts) VALUES(?,?,?) " +
                        "ON DUPLICATE KEY UPDATE widgets=VALUES(widgets), shortcuts=VALUES(shortcuts)",
                        rid, wJson, sJson);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
            int pushed = 0;
            if (truthy(body.get("apply_now"))) {
                pushed = db.exec("DELETE FROM dashboard_prefs WHERE user_id IN (SELECT id FROM users WHERE role_id=?)", rid);
            }
            db.audit(u.getId(), "DASHBOARD_DEFAULT_SET", "role:" + rid,
                    role.get("name") + ": " + widgets.size() + " cards" + (truthy(body.get("apply_now")) ? "; pushed to " + pushed + " people" : ""),
                    ACCESS);
            return Map.of("ok", true, "pushed", pushed);
        });
    }

    @GetMapping("/audit")
    public List<Map<String, Object>> getAudit(@RequestParam(required = false, defaultValue = "") String category,
                                              @RequestParam(required = false, defaultValue = "") String q,
                                              HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.audit");
        StringBuilder sql = new StringBuilder(
                "SELECT a.id, a.category, a.action, a.subject, a.info, a.created_at, COALESCE(x.full_name,'—') person " +
                "FROM audit a LEFT JOIN users x ON x.id=a.user_id WHERE 1=1"
        );
        List<Object> args = new ArrayList<>();
        if (List.of("access", "operations").contains(category)) {
            sql.append(" AND a.category=?");
            args.add(category);
        }
        String query = q != null ? q.trim() : "";
        if (!query.isEmpty()) {
            sql.append(" AND (a.action LIKE ? OR a.info LIKE ? OR a.subject LIKE ? OR x.full_name LIKE ?)");
            String like = "%" + query + "%";
            args.add(like);
            args.add(like);
            args.add(like);
            args.add(like);
        }
        sql.append(" ORDER BY a.id DESC LIMIT 300");
        return db.rows(sql.toString(), args.toArray());
    }

    private static boolean truthy(Object val) {
        if (val == null) return false;
        if (val instanceof Boolean b) return b;
        if (val instanceof Number n) return n.intValue() != 0;
        return "true".equalsIgnoreCase(val.toString()) || "1".equals(val.toString());
    }
}
