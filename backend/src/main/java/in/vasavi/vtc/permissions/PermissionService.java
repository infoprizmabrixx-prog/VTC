package in.vasavi.vtc.permissions;

import in.vasavi.vtc.catalog.PermissionCatalog;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.db.Db;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class PermissionService {

    private final Db db;
    private final PermissionCatalog catalog;

    public PermissionService(Db db, PermissionCatalog catalog) {
        this.db = db;
        this.catalog = catalog;
    }

    public record EffectiveResult(Set<String> perms, Map<String, String> why) {}

    public EffectiveResult effective(long userId) {
        Map<String, Object> u = db.one(
                "SELECT u.*, r.`key` role_key, r.tier, r.active role_active " +
                "FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?",
                userId
        );
        if (u == null) {
            return new EffectiveResult(Set.of(), Map.of());
        }
        return effectiveForRow(u);
    }

    public EffectiveResult effectiveForRow(Map<String, Object> u) {
        long userId = ((Number) u.get("id")).longValue();
        long roleId = ((Number) u.get("role_id")).longValue();
        boolean isOwner = truthy(u.get("is_owner"));
        String roleKey = (String) u.get("role_key");
        String tier = (String) u.get("tier");
        boolean roleActive = truthy(u.get("role_active"));

        Map<String, String> why = new LinkedHashMap<>();
        if (isOwner) {
            for (String k : catalog.getAllKeys()) {
                why.put(k, "owner");
            }
            return new EffectiveResult(new LinkedHashSet<>(catalog.getAllKeys()), why);
        }
        if ("admin".equals(roleKey)) {
            for (String k : catalog.getAllKeys()) {
                why.put(k, "admin_role");
            }
            return new EffectiveResult(new LinkedHashSet<>(catalog.getAllKeys()), why);
        }
        if (!roleActive) {
            return new EffectiveResult(Set.of(), Map.of());
        }

        Set<String> perms = new LinkedHashSet<>();
        List<Map<String, Object>> rps = db.rows("SELECT perm_key FROM role_permissions WHERE role_id=?", roleId);
        for (Map<String, Object> rp : rps) {
            String k = (String) rp.get("perm_key");
            if (catalog.getAllKeys().contains(k)) {
                perms.add(k);
                why.put(k, "role");
            }
        }

        String now = Times.stamp();
        List<Map<String, Object>> grants = db.rows(
                "SELECT * FROM user_grants WHERE user_id=? AND revoked_at IS NULL " +
                "AND (expires_at IS NULL OR expires_at > ?) ORDER BY id",
                userId, now
        );
        for (Map<String, Object> g : grants) {
            String k = (String) g.get("perm_key");
            if (!catalog.getAllKeys().contains(k)) {
                continue;
            }
            String effect = (String) g.get("effect");
            if ("allow".equals(effect)) {
                perms.add(k);
                why.put(k, "grant");
            } else {
                perms.remove(k);
                why.put(k, "deny");
            }
        }

        if (!"admin".equals(tier)) {
            for (String k : new ArrayList<>(perms)) {
                if (catalog.getAdminOnly().contains(k)) {
                    perms.remove(k);
                    why.put(k, "ceiling");
                }
            }
        }

        return new EffectiveResult(perms, why);
    }

    public CurrentUser loadUser(long userId) {
        return loadUser(userId, null);
    }

    public CurrentUser loadUser(long userId, Map<String, Object> session) {
        Map<String, Object> u = db.one(
                "SELECT u.id, u.username, u.full_name, u.role_id, u.login_type, u.is_owner, u.active, " +
                "u.must_change_secret, r.`key` role_key, r.name role_name, r.tier, r.active role_active " +
                "FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?",
                userId
        );
        if (u == null || !truthy(u.get("active"))) {
            return null;
        }
        if (session != null) {
            u.put("device_mode", session.get("device_mode"));
            u.put("session", session.get("token_hash"));
            u.put("insights_until", session.get("insights_until"));
        }
        EffectiveResult eff = effectiveForRow(u);
        return new CurrentUser(u, eff.perms());
    }

    public void require(CurrentUser user, String... keys) {
        for (String k : keys) {
            if (!user.can(k)) {
                throw new ApiException("ACCESS_DENIED", 403);
            }
        }
    }

    public void requireAny(CurrentUser user, String... keys) {
        for (String k : keys) {
            if (user.can(k)) {
                return;
            }
        }
        throw new ApiException("ACCESS_DENIED", 403);
    }

    public Map<String, Object> mask(Map<String, Object> row, CurrentUser user, Map<String, String> fieldMap) {
        if (row == null) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            String field = entry.getKey();
            String perm = fieldMap.get(field);
            if (perm == null || user.can(perm)) {
                out.put(field, entry.getValue());
            }
        }
        return out;
    }

    public List<Map<String, Object>> maskRows(List<Map<String, Object>> rows, CurrentUser user, Map<String, String> fieldMap) {
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            out.add(mask(r, user, fieldMap));
        }
        return out;
    }

    public Map<String, Object> assertCanManage(CurrentUser actor, long targetUserId) {
        if (actor.getId() == targetUserId) {
            throw new ApiException("CANNOT_CHANGE_OWN_ACCESS", 403);
        }
        Map<String, Object> t = db.one(
                "SELECT u.is_owner, r.tier FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?",
                targetUserId
        );
        if (t == null) {
            throw new ApiException("NOT_FOUND", 404);
        }
        if (truthy(t.get("is_owner"))) {
            throw new ApiException("OWNER_IS_PROTECTED", 403);
        }
        return t;
    }

    public void assertCanManage(CurrentUser actor, Map<String, Object> targetRow) {
        long targetId = ((Number) targetRow.get("id")).longValue();
        assertCanManage(actor, targetId);
    }

    public void assertCanHandOut(CurrentUser actor, Collection<String> keys) {
        for (String k : keys) {
            if (!catalog.getAllKeys().contains(k)) {
                throw new ApiException("UNKNOWN_PERMISSION", 400);
            }
            if (!actor.can(k)) {
                throw new ApiException("CANNOT_GIVE_ACCESS_YOU_DO_NOT_HAVE", 403);
            }
        }
    }

    public void assertCanHandOut(CurrentUser actor, Collection<String> keys, String targetTier) {
        assertCanHandOut(actor, keys);
        assertTierAllows(targetTier, keys);
    }

    public void assertTierAllows(String tier, Collection<String> keys) {
        for (String k : keys) {
            if (!catalog.getAllKeys().contains(k)) {
                throw new ApiException("UNKNOWN_PERMISSION", 400);
            }
            if (catalog.getAdminOnly().contains(k) && !"admin".equals(tier)) {
                throw new ApiException("ADMIN_ONLY_PERMISSION", 400);
            }
        }
    }

    private static boolean truthy(Object val) {
        if (val == null) return false;
        if (val instanceof Boolean b) return b;
        if (val instanceof Number n) return n.intValue() != 0;
        return "true".equalsIgnoreCase(val.toString()) || "1".equals(val.toString());
    }
}
