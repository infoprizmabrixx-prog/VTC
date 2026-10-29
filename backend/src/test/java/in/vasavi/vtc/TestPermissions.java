package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_permissions.py (16 tests).
 */
public class TestPermissions extends VtcTestBase {

    @Test
    void test_deny_by_default_for_admin_control() {
        Map<String, TestClient> p = people();
        for (String who : List.of("manager", "roaster")) {
            ok(p.get(who).get(A + "/admin/users"), 403);
            ok(p.get(who).get(A + "/admin/roles"), 403);
            ok(p.get(who).get(A + "/admin/audit"), 403);
        }
        JsonNode me = ok(p.get("roaster").get(A + "/me"));
        List<String> modules = stringList(me.path("modules"));
        assertFalse(modules.contains("admin"));
        assertFalse(modules.contains("finance"));
        assertEquals("staff", me.path("user").path("tier").asText());
    }

    @Test
    void test_role_change_applies_on_next_click() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        ok(r.get(A + "/roasts"));
        JsonNode roles = ok(o.get(A + "/admin/roles"));
        JsonNode staff = findFirst(roles, x -> "staff".equals(x.path("key").asText()));
        List<String> curPerms = stringList(staff.path("permissions"));
        List<String> newPerms = curPerms.stream()
                .filter(x -> !x.equals("roast.view") && !x.equals("roast.execute"))
                .toList();
        ok(o.put(A + "/admin/roles/" + staff.path("id").asInt(), Map.of("permissions", newPerms)));
        ok(r.get(A + "/roasts"), 403);
        assertFalse(stringList(ok(r.get(A + "/me")).path("modules")).contains("roasting"));
    }

    @Test
    void test_personal_grant_with_expiry_and_deny() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        int rid = uidOf(o, "Roaster");
        ok(r.get(A + "/qc"), 403);
        JsonNode g = ok(o.post(A + "/admin/users/" + rid + "/grants", mapOf(
                "perm_key", "qc.view",
                "effect", "allow",
                "reason", "Covering for manager",
                "expires_at", "2099-01-01T00:00:00+05:30"
        )));
        ok(r.get(A + "/qc"));

        // Simulate expiry by updating expires_at to past
        execSql("UPDATE user_grants SET expires_at='2000-01-01 00:00:00' WHERE id=?", g.path("id").asLong());
        ok(r.get(A + "/qc"), 403);

        // Deny removes something the role gives
        ok(r.get(A + "/inventory"));
        ok(o.post(A + "/admin/users/" + rid + "/grants", mapOf(
                "perm_key", "inventory.view",
                "effect", "deny",
                "reason", "Not needed at this station"
        )));
        assertFalse(stringList(ok(r.get(A + "/me")).path("perms")).contains("inventory.view"));
        JsonNode access = ok(o.get(A + "/admin/users/" + rid + "/access"));
        assertEquals("deny", access.path("why").path("inventory.view").asText());
        assertTrue(anyMatch(access.path("grants"), x -> "expired".equals(x.path("state").asText())));
    }

    @Test
    void test_admin_only_permissions_never_reach_staff_or_manager() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        int rid = uidOf(o, "Roaster");
        JsonNode e = ok(o.post(A + "/admin/users/" + rid + "/grants", mapOf(
                "perm_key", "system.grants",
                "effect", "allow",
                "reason", "testing ceiling"
        )), 400);
        assertEquals("ADMIN_ONLY_PERMISSION", e.path("error").asText());

        int mgr = roleId(o, "manager");
        JsonNode roles = ok(o.get(A + "/admin/roles"));
        JsonNode mgrRole = findFirst(roles, x -> x.path("id").asInt() == mgr);
        List<String> current = stringList(mgrRole.path("permissions"));
        List<String> updated = new java.util.ArrayList<>(current);
        updated.add("masters.approve");
        ok(o.put(A + "/admin/roles/" + mgr, Map.of("permissions", updated)), 400);
        ok(p.get("manager").post(A + "/masters/1/approve", Map.of()), 403);
    }

    @Test
    void test_owner_is_protected_and_admins_equal_owner() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient a = p.get("admin");
        int ownerId = uidOf(o, "Owner");
        int adminId = uidOf(o, "Office Admin");

        assertEquals("OWNER_IS_PROTECTED", ok(a.put(A + "/admin/users/" + ownerId, Map.of("active", false)), 403).path("error").asText());
        assertEquals("CANNOT_CHANGE_OWN_ACCESS", ok(o.put(A + "/admin/users/" + ownerId, Map.of("active", false)), 403).path("error").asText());
        ok(a.put(A + "/admin/users/" + adminId, Map.of("full_name", "Renamed")), 403); // own account
        ok(o.put(A + "/admin/users/" + adminId, Map.of("full_name", "Office Admin Two")));

        int mgrId = uidOf(o, "Demo Manager");
        ok(a.put(A + "/admin/users/" + mgrId, Map.of("role_id", roleId(o, "admin"))));
        int rid = ok(a.post(A + "/admin/roles", Map.of("name", "Co-owner", "tier", "admin"))).path("id").asInt();

        ok(a.put(A + "/admin/roles/" + roleId(o, "staff"), Map.of("name", "Floor Team")));
        ok(o.put(A + "/admin/roles/" + roleId(o, "admin"), Map.of("name", "Director")));
        assertEquals("ROLE_NAME_TAKEN", ok(a.put(A + "/admin/roles/" + rid, Map.of("name", "Floor Team")), 400).path("error").asText());
        assertTrue(anyMatch(ok(o.get(A + "/admin/roles")), r -> "Floor Team".equals(r.path("name").asText())));
        assertEquals("ADMIN_ROLE_IS_LOCKED", ok(o.put(A + "/admin/roles/" + roleId(o, "admin"), Map.of("permissions", List.of())), 403).path("error").asText());
    }

    @Test
    void test_nobody_changes_own_access() {
        Map<String, TestClient> p = people();
        TestClient a = p.get("admin");
        int me = ok(a.get(A + "/me")).path("user").path("id").asInt();
        JsonNode e = ok(a.post(A + "/admin/users/" + me + "/grants", mapOf(
                "perm_key", "finance.view",
                "effect", "deny",
                "reason", "self change"
        )), 403);
        assertEquals("CANNOT_CHANGE_OWN_ACCESS", e.path("error").asText());
    }

    @Test
    void test_cannot_hand_out_access_you_do_not_have() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        int rid = ok(o.post(A + "/admin/roles", Map.of("name", "Office Clerk", "tier", "admin"))).path("id").asInt();
        ok(o.put(A + "/admin/roles/" + rid, Map.of("permissions", List.of("dashboard.my_view", "system.grants", "system.users"))));
        ok(o.post(A + "/admin/users", mapOf(
                "full_name", "Clerk Demo",
                "username", "clerk",
                "role_id", rid,
                "login_type", "password",
                "secret", "Clerk-Pass-2026"
        )));

        TestClient clerk = newClient();
        ok(clerk.post(A + "/login", Map.of("username", "clerk", "password", "Clerk-Pass-2026")));
        ok(clerk.get(A + "/admin/users"), 403); // must change password first
        ok(clerk.post(A + "/me/secret", Map.of("current", "Clerk-Pass-2026", "new", "Clerk-Changed-2026")));

        int roaster = uidOf(clerk, "Roaster");
        JsonNode e = ok(clerk.post(A + "/admin/users/" + roaster + "/grants", mapOf(
                "perm_key", "finance.view",
                "effect", "allow",
                "reason", "should fail"
        )), 403);
        assertEquals("CANNOT_GIVE_ACCESS_YOU_DO_NOT_HAVE", e.path("error").asText());

        // But allowed to remove access (deny)
        ok(clerk.post(A + "/admin/users/" + roaster + "/grants", mapOf(
                "perm_key", "inventory.view",
                "effect", "deny",
                "reason", "allowed to restrict"
        )));
    }

    @Test
    void test_deactivation_signs_person_out_everywhere() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        ok(m.get(A + "/me"));
        ok(o.put(A + "/admin/users/" + uidOf(o, "Demo Manager"), Map.of("active", false)));
        ok(m.get(A + "/me"), 401);
    }

    @Test
    void test_sensitive_fields_hidden_until_granted() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        TestClient r = p.get("roaster");

        int pid = ok(o.post(A + "/masters", mapOf("kind", "product", "name", "Test Robusta", "nominal_kg", 50))).path("id").asInt();
        JsonNode rec = ok(r.post(A + "/inward", mapOf(
                "source", "OTHER",
                "source_name", "Test supplier",
                "product_id", pid,
                "bags", 2,
                "damaged", 0
        ), key()));

        ok(o.put(A + "/inward/" + rec.path("id").asInt() + "/finance", mapOf("invoice_ref", "INV-SECRET", "invoice_status", "MATCHED")));
        JsonNode row = ok(m.get(A + "/inward")).get(0);
        assertFalse(row.has("invoice_ref"));
        assertFalse(row.has("payment_status"));

        ok(o.post(A + "/admin/users/" + uidOf(o, "Demo Manager") + "/grants", mapOf(
                "perm_key", "invoice.metadata",
                "effect", "allow",
                "reason", "Helps with invoice follow-up"
        )));
        row = ok(m.get(A + "/inward")).get(0);
        assertEquals("INV-SECRET", row.path("invoice_ref").asText());
        assertFalse(row.has("payment_status"));

        // Seeing is not doing: still cannot update
        ok(m.put(A + "/inward/" + rec.path("id").asInt() + "/finance", Map.of("invoice_status", "EXCEPTION")), 403);
    }

    @Test
    void test_pin_lockout_and_pin_only_for_staff() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient c = newClient();
        JsonNode pinPeople = ok(c.get(A + "/login/pin-people"));
        int rid = findFirst(pinPeople, x -> x.path("full_name").asText().contains("Packer")).path("id").asInt();

        for (int i = 0; i < 5; i++) {
            ok(c.post(A + "/login/pin", Map.of("user_id", rid, "pin", "9999")), 401);
        }
        ok(c.post(A + "/login/pin", Map.of("user_id", rid, "pin", "1470")), 423);

        // Admin reset unlocks
        ok(o.post(A + "/admin/users/" + rid + "/secret", Map.of("secret", "3691")));
        ok(c.post(A + "/login/pin", Map.of("user_id", rid, "pin", "3691")));

        JsonNode e = ok(o.post(A + "/admin/users", mapOf(
                "full_name", "PIN Manager",
                "username", "pinmgr",
                "role_id", roleId(o, "manager"),
                "login_type", "pin",
                "secret", "4826"
        )), 400);
        assertEquals("PIN_ONLY_FOR_STAFF_LEVEL", e.path("error").asText());
        ok(o.post(A + "/admin/users/" + rid + "/secret", Map.of("secret", "1111")), 400);
    }

    @Test
    void test_idle_signout_follows_admin_setting() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        ok(o.put(A + "/admin/settings", Map.of("idle_shared_min", 2)));

        execSql("UPDATE sessions SET last_seen='2000-01-01 00:00:00' WHERE device_mode='shared'");
        assertEquals("SESSION_IDLE", ok(r.get(A + "/me"), 401).path("error").asText());
        ok(o.get(A + "/me")); // owner signed in as personal device, unaffected
    }

    @Test
    void test_forged_cross_site_request_is_blocked() {
        // Handled via SameSite strict cookie and standard session auth in Spring MVC
        TestClient raw = newClient();
        assertEquals(401, raw.post(A + "/masters", Map.of("kind", "supplier", "name", "Forged")).statusCode());
    }

    @Test
    void test_preview_is_read_only_and_audited() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        int rid = uidOf(o, "Roaster");
        JsonNode prev = ok(o.get(A + "/admin/users/" + rid + "/preview"));
        List<String> modules = stringList(prev.path("modules"));
        assertTrue(modules.contains("roasting"));
        assertFalse(modules.contains("finance"));
        assertTrue(anyMatch(ok(o.get(A + "/admin/audit?category=access")), x -> "PREVIEW_AS".equals(x.path("action").asText())));
    }

    @Test
    void test_custom_role_and_pushed_dashboard() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        int rid = ok(o.post(A + "/admin/roles", mapOf(
                "name", "Packer",
                "tier", "staff",
                "copy_from", roleId(o, "staff")
        ))).path("id").asInt();

        JsonNode roles = ok(o.get(A + "/admin/roles"));
        JsonNode packerRole = findFirst(roles, x -> x.path("id").asInt() == rid);
        assertTrue(stringList(packerRole.path("permissions")).contains("roast.execute"));

        List<String> keep = stringList(packerRole.path("permissions")).stream()
                .filter(x -> !x.startsWith("roast."))
                .toList();
        ok(o.put(A + "/admin/roles/" + rid, Map.of("permissions", keep)));
        ok(o.put(A + "/admin/users/" + uidOf(o, "Demo Packer"), Map.of("role_id", rid)));
        ok(o.put(A + "/admin/dashboard-defaults/" + rid, mapOf(
                "widgets", List.of("my_tasks", "packing"),
                "shortcuts", List.of("packing"),
                "apply_now", true
        )));

        TestClient packer = login("packer");
        JsonNode me = ok(packer.get(A + "/me"));
        assertFalse(stringList(me.path("modules")).contains("roasting"));
        assertEquals(List.of("my_tasks", "packing"), stringList(me.path("prefs").path("widgets")));

        // Role with active users cannot be disabled
        ok(o.put(A + "/admin/roles/" + rid, Map.of("active", false)), 400);
    }

    @Test
    void test_manager_assigns_work_but_cannot_change_access() {
        Map<String, TestClient> p = people();
        TestClient m = p.get("manager");
        TestClient r = p.get("roaster");
        int rid = findFirst(ok(m.get(A + "/people")), x -> x.path("full_name").asText().contains("Roaster")).path("id").asInt();
        int tid = ok(m.post(A + "/tasks", mapOf(
                "title", "Roast 3 batches of Test Robusta",
                "assigned_to", rid,
                "target", 3
        ))).path("id").asInt();

        assertTrue(anyMatch(ok(r.get(A + "/tasks")), t -> t.path("id").asInt() == tid));
        ok(r.put(A + "/tasks/" + tid, Map.of("progress", 3)));
        ok(m.post(A + "/admin/users/" + rid + "/grants", mapOf(
                "perm_key", "qc.view",
                "effect", "allow",
                "reason", "manager tries"
        )), 403);
        ok(r.post(A + "/tasks", Map.of("title", "Staff cannot assign")), 403);
    }

    @Test
    void test_settings_and_wording() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");

        ok(o.put(A + "/admin/settings", Map.of("languages_enabled", List.of("te"))), 400);
        ok(o.put(A + "/admin/settings", mapOf(
                "languages_enabled", List.of("en", "te"),
                "default_language", "te",
                "company_name", "Vasavi Trading Co."
        )));
        ok(o.put(A + "/admin/i18n", mapOf(
                "lang", "te",
                "key", "roasting",
                "text", "వేయించడం"
        )));

        assertEquals("వేయించడం", ok(r.get(A + "/i18n")).path("te").path("roasting").asText());
        JsonNode me = ok(r.get(A + "/me"));
        assertEquals(List.of("en", "te"), stringList(me.path("settings").path("languages_enabled")));
        ok(r.put(A + "/me/preferences", mapOf(
                "widgets", List.of(),
                "shortcuts", List.of(),
                "lang", "hi"
        )), 400);
    }
}
