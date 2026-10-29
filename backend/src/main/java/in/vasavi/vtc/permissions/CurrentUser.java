package in.vasavi.vtc.permissions;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public class CurrentUser {

    private final Map<String, Object> attrs;
    private final Set<String> perms;

    public CurrentUser(Map<String, Object> attrs, Set<String> perms) {
        this.attrs = new LinkedHashMap<>(attrs);
        this.perms = perms;
    }

    public boolean can(String perm) {
        return perms.contains(perm);
    }

    public boolean canAny(String... keys) {
        for (String k : keys) {
            if (perms.contains(k)) {
                return true;
            }
        }
        return false;
    }

    public Set<String> getPerms() {
        return perms;
    }

    public Map<String, Object> getAttrs() {
        return attrs;
    }

    public Object get(String key) {
        return attrs.get(key);
    }

    public void put(String key, Object val) {
        attrs.put(key, val);
    }

    public long getId() {
        return ((Number) attrs.get("id")).longValue();
    }

    public String getUsername() {
        return (String) attrs.get("username");
    }

    public String getFullName() {
        return (String) attrs.get("full_name");
    }

    public long getRoleId() {
        return ((Number) attrs.get("role_id")).longValue();
    }

    public String getRoleKey() {
        return (String) attrs.get("role_key");
    }

    public String getRoleName() {
        return (String) attrs.get("role_name");
    }

    public String getTier() {
        return (String) attrs.get("tier");
    }

    public String getLoginType() {
        return (String) attrs.get("login_type");
    }

    public boolean isOwner() {
        Object v = attrs.get("is_owner");
        return v instanceof Boolean b ? b : (v instanceof Number n && n.intValue() != 0);
    }

    public boolean isMustChangeSecret() {
        Object v = attrs.get("must_change_secret");
        return v instanceof Boolean b ? b : (v instanceof Number n && n.intValue() != 0);
    }

    public String getDeviceMode() {
        return (String) attrs.getOrDefault("device_mode", "personal");
    }

    public String getSessionTokenHash() {
        return (String) attrs.get("session");
    }
}
