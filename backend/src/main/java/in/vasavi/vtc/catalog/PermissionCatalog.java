package in.vasavi.vtc.catalog;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class PermissionCatalog {

    public static final Map<String, Set<String>> MODULE_GATES = Map.of(
            "comms", Set.of("comms.read", "comms.chat", "comms.announce"),
            "maintenance", Set.of("maintenance.raise", "maintenance.manage")
    );

    private final ObjectMapper mapper;

    private List<List<String>> modules = new ArrayList<>();
    private Map<String, List<String>> moduleMap = new LinkedHashMap<>();
    private List<Map<String, Object>> permissions = new ArrayList<>();
    private Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
    private Set<String> allKeys = new LinkedHashSet<>();
    private Set<String> adminOnly = new LinkedHashSet<>();
    private Set<String> sensitiveKeys = new LinkedHashSet<>();
    private Map<String, List<String>> widgets = new LinkedHashMap<>();
    private Map<String, List<String>> defaultWidgets = new LinkedHashMap<>();
    private List<String> defaultShortcuts = new ArrayList<>();
    private Map<String, Map<String, Object>> systemRoles = new LinkedHashMap<>();

    public PermissionCatalog(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @PostConstruct
    public void init() {
        try (InputStream is = new ClassPathResource("generated/permissions.json").getInputStream()) {
            JsonNode root = mapper.readTree(is);
            modules = mapper.convertValue(root.get("modules"), new TypeReference<>() {});
            for (List<String> m : modules) {
                moduleMap.put(m.get(0), m);
            }
            permissions = mapper.convertValue(root.get("permissions"), new TypeReference<>() {});
            for (Map<String, Object> p : permissions) {
                String k = (String) p.get("key");
                byKey.put(k, p);
                allKeys.add(k);
                if (Boolean.TRUE.equals(p.get("admin_only"))) {
                    adminOnly.add(k);
                }
                String risk = (String) p.get("risk");
                if ("sensitive".equals(risk) || "critical".equals(risk)) {
                    sensitiveKeys.add(k);
                }
            }
            widgets = mapper.convertValue(root.get("widgets"), new TypeReference<>() {});
            defaultWidgets = mapper.convertValue(root.get("default_widgets"), new TypeReference<>() {});
            defaultShortcuts = mapper.convertValue(root.get("default_shortcuts"), new TypeReference<>() {});
            List<Map<String, Object>> sysRoleList = mapper.convertValue(root.get("system_roles"), new TypeReference<>() {});
            for (Map<String, Object> r : sysRoleList) {
                systemRoles.put((String) r.get("key"), r);
            }
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load generated/permissions.json", e);
        }
    }

    public List<List<String>> getModules() {
        return modules;
    }

    public Map<String, List<String>> getModuleMap() {
        return moduleMap;
    }

    public List<Map<String, Object>> getPermissions() {
        return permissions;
    }

    public Map<String, Map<String, Object>> getByKey() {
        return byKey;
    }

    public Set<String> getAllKeys() {
        return Collections.unmodifiableSet(allKeys);
    }

    public Set<String> getAdminOnly() {
        return Collections.unmodifiableSet(adminOnly);
    }

    public Set<String> getSensitiveKeys() {
        return Collections.unmodifiableSet(sensitiveKeys);
    }

    public Map<String, List<String>> getWidgets() {
        return widgets;
    }

    public Map<String, List<String>> getDefaultWidgets() {
        return defaultWidgets;
    }

    public List<String> getDefaultShortcuts() {
        return defaultShortcuts;
    }

    public Map<String, Map<String, Object>> getSystemRoles() {
        return systemRoles;
    }

    public Set<String> getLiveModules() {
        Set<String> set = new java.util.TreeSet<>();
        for (Map<String, Object> p : permissions) {
            if (Boolean.TRUE.equals(p.get("live")) && p.get("module") != null) {
                set.add(p.get("module").toString());
            }
        }
        set.add("dashboard");
        set.add("admin");
        return set;
    }

    public boolean moduleVisible(String modKey, Set<String> perms) {
        if ("dashboard".equals(modKey)) {
            return perms.contains("dashboard.my_view");
        }
        if ("admin".equals(modKey)) {
            for (String p : perms) {
                if (p.startsWith("system.")) {
                    return true;
                }
            }
            return perms.contains("masters.create_draft") || perms.contains("masters.approve");
        }
        if ("masters".equals(modKey)) {
            return false;
        }
        if (MODULE_GATES.containsKey(modKey)) {
            for (String g : MODULE_GATES.get(modKey)) {
                if (perms.contains(g)) {
                    return true;
                }
            }
            return false;
        }
        for (Map<String, Object> p : permissions) {
            if (modKey.equals(p.get("module")) && perms.contains((String) p.get("key")) && !"field".equals(p.get("kind"))) {
                return true;
            }
        }
        return false;
    }
}
