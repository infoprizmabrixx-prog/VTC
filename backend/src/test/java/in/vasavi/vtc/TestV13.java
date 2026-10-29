package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * v1.3 owner changes (26 Oct 2026): stock cards by bean, hierarchy routing,
 * staff profiles and documents (last 4 only, owner/admin only), delivery-app address.
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_v13.py (4 tests).
 */
class TestV13 extends VtcTestBase {

    @Test
    void test_stock_cards_follow_the_bean_and_only_admins_edit() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int pid = (int) TestV11.rawStock(this, o, r, 4, 0, 0, null)[0];
        JsonNode lot = findFirst(ok(r.get(A + "/inventory")), x -> x.path("product_id").asInt(-1) == pid);
        JsonNode roast = ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", lot.path("id").asInt(), "kg", 50)),
                "output_kg", 42,
                "duration_min", 14
        ), key()));
        int roastId = roast.path("id").asInt();
        JsonNode roasted = findFirst(ok(o.get(A + "/inventory")), x -> x.path("roast_id").asInt(-1) == roastId);
        assertEquals(pid, roasted.path("bean_id").asInt());
        assertTrue(roasted.path("product_id").isNull()); // counter sales still find it as plain coffee
        assertTrue(anyMatch(ok(r.get(A + "/stock-cards")), c -> c.path("product_id").asInt() == pid));
        ok(m.put(A + "/stock-cards/" + pid, Map.of("label", "nope")), 403);
        ok(o.put(A + "/stock-cards/" + pid, mapOf("label", "Robusta AB", "color", "#aa5500", "low_kg", 500)));
        assertEquals("INVALID_COLOUR", ok(o.put(A + "/stock-cards/" + pid, Map.of("color", "red")), 400).path("error").asText());
        JsonNode card = findFirst(ok(r.get(A + "/stock-cards")), c -> c.path("product_id").asInt() == pid);
        assertEquals("Robusta AB", card.path("label").asText());
        assertEquals(500.0, card.path("low_kg").asDouble(), 1e-6);
        JsonNode s = ok(o.get(A + "/summary"));
        assertFalse(s.has("available_kg"));
        assertTrue(s.path("beans_in_stock").asInt() >= 1);
        assertTrue(s.path("beans_low").asInt() >= 1);
        JsonNode rep = ok(o.get(A + "/reports"));
        if (rep.has("stock")) {
            assertTrue(allMatch(rep.path("stock"), x -> x.has("bean")));
        }
    }

    @Test
    void test_admin_sets_hierarchy_and_work_routes_to_the_boss() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient a = p.get("admin");
        TestClient m = p.get("manager");
        TestClient r = p.get("roaster");
        int rid = uidOf(o, "Roaster");
        int mid = uidOf(o, "Demo Manager");
        ok(m.put(A + "/team/" + rid + "/reports-to", Map.of("reports_to", mid)), 403);
        ok(a.put(A + "/team/" + rid + "/reports-to", Map.of("reports_to", mid)));
        assertEquals("HIERARCHY_LOOP", ok(a.put(A + "/team/" + mid + "/reports-to", Map.of("reports_to", rid)), 400).path("error").asText());
        assertEquals(mid, findFirst(ok(r.get(A + "/team")), x -> x.path("id").asInt() == rid).path("reports_to").asInt());
        // a maintenance ticket goes to the boss and is assigned to them
        int tid = ok(r.post(A + "/maintenance", mapOf("title", "Grinder burr worn", "area", "GRINDER"))).path("id").asInt();
        JsonNode t = findFirst(ok(m.get(A + "/maintenance")), x -> x.path("id").asInt() == tid);
        assertEquals(mid, t.path("assigned_to").asInt());
        assertTrue(anyMatch(ok(m.get(A + "/alerts")), x -> x.path("title").asText().contains("Grinder burr worn")));
        assertFalse(anyMatch(ok(o.get(A + "/alerts")), x -> x.path("title").asText().contains("Grinder burr worn")));
    }

    @Test
    void test_staff_profile_keeps_last_four_and_is_admin_only() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        int rid = uidOf(o, "Roaster");
        ok(m.get(A + "/team/" + rid + "/profile"), 403);
        ok(o.put(A + "/team/" + rid + "/profile", mapOf(
                "designation", "Head roaster",
                "phone", "9000000002",
                "aadhaar", "1234 5678 9012",
                "pan", "ABCDE1234F",
                "bank_account", "001122334455",
                "ifsc", "sbin0001234"
        )));
        assertEquals("INVALID_IFSC", ok(o.put(A + "/team/" + rid + "/profile", Map.of("ifsc", "bad")), 400).path("error").asText());
        JsonNode prof = ok(o.get(A + "/team/" + rid + "/profile")).path("profile");
        assertEquals("9012", prof.path("aadhaar_last4").asText());
        assertEquals("234F", prof.path("pan_last4").asText());
        assertEquals("4455", prof.path("bank_last4").asText());
        assertEquals("SBIN0001234", prof.path("ifsc").asText());
        assertFalse(prof.toString().contains("123456789012"));

        byte[] prefix = "%PDF-1.4 ".getBytes(StandardCharsets.US_ASCII);
        byte[] pdfBytes = new byte[prefix.length + 300];
        System.arraycopy(prefix, 0, pdfBytes, 0, prefix.length);
        String data = Base64.getEncoder().encodeToString(pdfBytes);

        int did = ok(o.post(A + "/team/" + rid + "/documents", mapOf(
                "kind", "AADHAAR",
                "mime", "application/pdf",
                "data", data
        ))).path("id").asInt();
        assertEquals(200, p.get("admin").get(A + "/team/documents/" + did).statusCode());
        assertEquals(403, m.get(A + "/team/documents/" + did).statusCode());
        int fid = ok(o.get(A + "/team/" + rid + "/profile")).path("documents").get(0).path("id").asInt();
        assertEquals(did, fid);
        // a staff document is never reachable through the voice-note file link
        int voiceStatus = o.get(A + "/comms/files/" + did).statusCode();
        assertTrue(voiceStatus == 403 || voiceStatus == 404);
        ok(o.delete(A + "/team/documents/" + did));
        assertEquals(0, ok(o.get(A + "/team/" + rid + "/profile")).path("documents").size());
        Set<String> acts = new HashSet<>();
        ok(o.get(A + "/admin/audit?category=access")).forEach(x -> acts.add(x.path("action").asText()));
        assertTrue(acts.containsAll(Set.of("STAFF_PROFILE_VIEWED", "STAFF_DOCUMENT_VIEWED", "STAFF_DOCUMENT_REMOVED")));
    }

    @Test
    void test_dispatcher_gets_drop_address_others_do_not() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 4);
        ok(o.post(A + "/masters", mapOf("kind", "customer", "name", "Cafe " + suffix, "address", "Road 1, Hyderabad")));
        int cid = findFirst(ok(o.get(A + "/masters?kind=customer")), x -> "Road 1, Hyderabad".equals(x.path("address").asText()))
                .path("id").asInt();
        ok(r.post(A + "/orders", mapOf("customer_id", cid, "item", "Roasted beans", "quantity_kg", 2, "form", "ROASTED")));
        JsonNode order = findFirst(ok(r.get(A + "/orders")), x -> x.path("customer_id").asInt() == cid);
        assertEquals("Road 1, Hyderabad", order.path("customer_address").asText()); // roaster holds dispatch.handover
    }
}
