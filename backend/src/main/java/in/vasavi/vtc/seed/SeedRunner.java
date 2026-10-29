package in.vasavi.vtc.seed;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.vasavi.vtc.catalog.PermissionCatalog;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.config.AppProperties;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.security.PasswordHasher;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class SeedRunner implements ApplicationRunner {

    private record DemoPerson(String username, String fullName, String roleKey, String loginType, String secret, int isOwner) {}

    private static final List<DemoPerson> DEMO_PEOPLE = List.of(
            new DemoPerson("owner", "Owner (Demo)", "admin", "password", "VTC-Owner-Demo26", 1),
            new DemoPerson("admin", "Office Admin (Demo)", "admin", "password", "VTC-Admin-Demo26", 0),
            new DemoPerson("manager", "Demo Manager", "manager", "password", "VTC-Manager-Demo26", 0),
            new DemoPerson("roaster", "Demo Roaster", "staff", "pin", "2580", 0),
            new DemoPerson("packer", "Demo Packer", "staff", "pin", "1470", 0)
    );

    private static final String[][] TEAMS = {
            {"roastery", "Roastery"},
            {"packing", "Packing"},
            {"counter", "Counter"},
            {"office", "Office / Accounts"}
    };

    private static final Map<String, List<String>> DEMO_TEAMS = Map.of(
            "owner", List.of("office"),
            "admin", List.of("office"),
            "manager", List.of("roastery", "packing", "counter"),
            "roaster", List.of("roastery"),
            "packer", List.of("packing")
    );

    private final Db db;
    private final PermissionCatalog catalog;
    private final PasswordHasher hasher;
    private final AppProperties props;
    private final ObjectMapper mapper;

    public SeedRunner(Db db, PermissionCatalog catalog, PasswordHasher hasher, AppProperties props, ObjectMapper mapper) {
        this.db = db;
        this.catalog = catalog;
        this.hasher = hasher;
        this.props = props;
        this.mapper = mapper;
    }

    @Override
    public void run(ApplicationArguments args) {
        ensureAll();
    }

    public void ensureAll() {
        db.txVoid(() -> {
            db.exec("INSERT IGNORE INTO golive(id) VALUES(1)");
            db.exec("INSERT IGNORE INTO stock_dirty(id, dirty) VALUES(1, 0)");
            boolean fresh = ensureRoles();
            ensurePeople();
            ensureComms();
            syncRoleDefaults(fresh);
        });
    }

    @SuppressWarnings("unchecked")
    private boolean ensureRoles() {
        boolean created = false;
        String now = Times.stamp();
        for (Map.Entry<String, Map<String, Object>> entry : catalog.getSystemRoles().entrySet()) {
            String key = entry.getKey();
            Map<String, Object> spec = entry.getValue();
            Map<String, Object> row = db.one("SELECT id FROM roles WHERE `key`=?", key);
            if (row == null) {
                created = true;
                String tier = (String) spec.get("tier");
                long rid = db.insert(
                        "INSERT INTO roles(`key`, name, tier, description, is_system, active, created_at) VALUES(?,?,?,?,1,1,?)",
                        key, spec.get("name"), tier, spec.get("description"), now
                );
                Collection<String> perms = (Collection<String>) spec.get("permissions");
                List<String> sortedPerms = new ArrayList<>(perms);
                Collections.sort(sortedPerms);
                for (String p : sortedPerms) {
                    db.exec("INSERT IGNORE INTO role_permissions(role_id, perm_key) VALUES(?,?)", rid, p);
                }
                try {
                    String widgetsJson = mapper.writeValueAsString(catalog.getDefaultWidgets().get(tier));
                    String shortcutsJson = mapper.writeValueAsString(catalog.getDefaultShortcuts());
                    db.exec("INSERT IGNORE INTO role_dashboard_defaults(role_id, widgets, shortcuts) VALUES(?,?,?)",
                            rid, widgetsJson, shortcutsJson);
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }
        }
        return created;
    }

    private void ensurePeople() {
        if (db.count("SELECT COUNT(*) FROM users") > 0) {
            return;
        }
        String now = Times.stamp();
        List<DemoPerson> people = props.isDemo() ? DEMO_PEOPLE : DEMO_PEOPLE.subList(0, 1);
        int mustChange = props.isDemo() ? 0 : 1;
        for (DemoPerson dp : people) {
            Map<String, Object> role = db.one("SELECT id FROM roles WHERE `key`=?", dp.roleKey());
            long roleId = ((Number) role.get("id")).longValue();
            db.insert(
                    "INSERT INTO users(username, full_name, role_id, login_type, secret_hash, is_owner, must_change_secret, active, created_at) " +
                    "VALUES(?,?,?,?,?,?,?,1,?)",
                    dp.username(), dp.fullName(), roleId, dp.loginType(), hasher.hashSecret(dp.secret()), dp.isOwner(), mustChange, now
            );
        }
    }

    private void ensureComms() {
        boolean fresh = db.count("SELECT COUNT(*) FROM teams") == 0;
        String now = Times.stamp();
        for (String[] ts : TEAMS) {
            String key = ts[0];
            String name = ts[1];
            if (db.one("SELECT 1 FROM teams WHERE `key`=?", key) == null) {
                long tid = db.insert("INSERT INTO teams(`key`, name) VALUES(?,?)", key, name);
                db.insert("INSERT INTO conversations(kind, title, team_id, created_at) VALUES('group',?,?,?)",
                        name, tid, now);
            }
        }
        if (db.one("SELECT 1 FROM conversations WHERE kind='announcement'") == null) {
            db.insert("INSERT INTO conversations(kind, title, created_at) VALUES('announcement','Announcements',?)", now);
        }
        if (fresh && props.isDemo()) {
            for (Map.Entry<String, List<String>> entry : DEMO_TEAMS.entrySet()) {
                Map<String, Object> u = db.one("SELECT id FROM users WHERE username=?", entry.getKey());
                if (u == null) {
                    continue;
                }
                long uid = ((Number) u.get("id")).longValue();
                for (String k : entry.getValue()) {
                    Map<String, Object> t = db.one("SELECT id FROM teams WHERE `key`=?", k);
                    if (t != null) {
                        db.exec("INSERT IGNORE INTO user_teams(user_id, team_id) VALUES(?,?)", uid, t.get("id"));
                    }
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void syncRoleDefaults(boolean fresh) {
        Map<String, Object> done = db.one("SELECT `value` FROM meta WHERE `key`='perm_defaults_seen'");
        Set<String> seen = null;
        if (done != null && done.get("value") != null) {
            try {
                List<String> list = mapper.readValue((String) done.get("value"), new TypeReference<>() {});
                seen = new HashSet<>(list);
            } catch (Exception ignored) {
            }
        }
        List<String> allSeen = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : catalog.getSystemRoles().entrySet()) {
            String key = entry.getKey();
            Collection<String> perms = (Collection<String>) entry.getValue().get("permissions");
            for (String p : perms) {
                allSeen.add(key + ":" + p);
            }
            if ("admin".equals(key)) {
                continue;
            }
            Map<String, Object> r = db.one("SELECT id FROM roles WHERE `key`=?", key);
            if (r == null) {
                continue;
            }
            long rid = ((Number) r.get("id")).longValue();
            Set<String> newPerms = new HashSet<>();
            if (seen == null) {
                if (!fresh) {
                    newPerms.addAll(perms);
                }
            } else {
                for (String p : perms) {
                    if (!seen.contains(key + ":" + p)) {
                        newPerms.add(p);
                    }
                }
            }
            for (String p : newPerms) {
                db.exec("INSERT IGNORE INTO role_permissions(role_id, perm_key) VALUES(?,?)", rid, p);
            }
        }
        Collections.sort(allSeen);
        try {
            String seenJson = mapper.writeValueAsString(allSeen);
            db.exec("INSERT INTO meta(`key`, `value`) VALUES('perm_defaults_seen', ?) ON DUPLICATE KEY UPDATE `value`=?", seenJson, seenJson);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
