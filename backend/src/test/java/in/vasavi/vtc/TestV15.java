package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * v1.5 owner changes (27 Oct 2026): home screen card sizes, My profile (own contact details,
 * read-aloud speed, devices signed in, team and work), sign out other devices, staff details.
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_v15.py (6 tests).
 */
class TestV15 extends VtcTestBase {

    @SuppressWarnings("unchecked")
    @Test
    void test_dashboard_sizes_and_voice_speed() {
        Map<String, TestClient> p = people();
        TestClient m = p.get("manager");
        JsonNode prefsNode = ok(m.get(A + "/me")).path("prefs");
        assertEquals(0, prefsNode.path("sizes").size());
        assertEquals(0.95, prefsNode.path("voice_rate").asDouble(), 1e-6);

        Map<String, Object> basePrefs = mapper.convertValue(prefsNode, Map.class);
        List<String> origWidgets = new ArrayList<>();
        prefsNode.path("widgets").forEach(w -> origWidgets.add(w.asText()));
        List<String> revWidgets = new ArrayList<>(origWidgets);
        Collections.reverse(revWidgets);
        String firstWidget = origWidgets.get(0);

        Map<String, Object> body = new LinkedHashMap<>(basePrefs);
        body.put("widgets", revWidgets);
        body.put("sizes", Map.of(firstWidget, "l"));
        body.put("voice_rate", 0.7);
        ok(m.put(A + "/me/preferences", body));

        JsonNode p2 = ok(m.get(A + "/me")).path("prefs");
        List<String> p2Widgets = new ArrayList<>();
        p2.path("widgets").forEach(w -> p2Widgets.add(w.asText()));
        assertEquals(revWidgets, p2Widgets);
        assertEquals("l", p2.path("sizes").path(firstWidget).asText());
        assertEquals(1, p2.path("sizes").size());
        assertEquals(0.7, p2.path("voice_rate").asDouble(), 1e-6);

        // sizes only for cards on the screen, only s/m/l; speed only 0.6–1.4
        Map<String, Object> bad1 = new LinkedHashMap<>(body);
        bad1.put("sizes", Map.of("nope", "l"));
        assertEquals("INVALID_WIDGET_SELECTION", ok(m.put(A + "/me/preferences", bad1), 400).path("error").asText());

        Map<String, Object> bad2 = new LinkedHashMap<>(body);
        bad2.put("sizes", Map.of(firstWidget, "xl"));
        assertEquals("INVALID_WIDGET_SELECTION", ok(m.put(A + "/me/preferences", bad2), 400).path("error").asText());

        Map<String, Object> bad3 = new LinkedHashMap<>(body);
        bad3.put("voice_rate", 3);
        assertEquals("INVALID_VOICE_SPEED", ok(m.put(A + "/me/preferences", bad3), 400).path("error").asText());

        Map<String, Object> bad4 = new LinkedHashMap<>(body);
        bad4.put("voice_rate", "fast");
        assertEquals("INVALID_VOICE_SPEED", ok(m.put(A + "/me/preferences", bad4), 400).path("error").asText());

        // a card that is hidden later drops its size
        Map<String, Object> dropBody = new LinkedHashMap<>(body);
        dropBody.put("widgets", origWidgets.subList(1, origWidgets.size()));
        dropBody.put("sizes", Map.of());
        ok(m.put(A + "/me/preferences", dropBody));
        assertEquals(0, ok(m.get(A + "/me")).path("prefs").path("sizes").size());
    }

    @Test
    void test_my_profile_contact_and_work() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        JsonNode me = ok(r.get(A + "/me/profile"));
        for (String k : List.of("contact", "boss", "reports", "teams", "work", "sessions", "access")) {
            assertTrue(me.has(k), "Missing key: " + k);
        }
        assertFalse(me.toString().contains("aadhaar_last4"));
        assertFalse(me.path("contact").toString().contains("bank")); // ID/bank never on this page
        assertTrue(anyMatch(me.path("access"), a -> "Daily Roasting".equals(a.path("area").asText())));

        ok(r.put(A + "/me/profile", mapOf(
                "phone", "98765 43210",
                "emergency_name", "Demo Relative",
                "emergency_phone", "+91 91234 56780"
        )));
        assertEquals("Demo Relative", ok(r.get(A + "/me/profile")).path("contact").path("emergency_name").asText());
        assertEquals("INVALID_PHONE", ok(r.put(A + "/me/profile", Map.of("phone", "12ab")), 400).path("error").asText());
        assertEquals("INVALID_EMAIL", ok(r.put(A + "/me/profile", Map.of("email", "not-an-email")), 400).path("error").asText());
        assertEquals("NOTHING_TO_CHANGE",
                ok(r.put(A + "/me/profile", mapOf("aadhaar_last4", "1234", "designation", "Boss")), 400).path("error").asText());

        // the owner sees what the roaster saved in the staff record; the roaster can't open staff records
        int rid = findFirst(ok(o.get(A + "/team")), x -> x.path("full_name").asText().endsWith("Roaster")).path("id").asInt();
        assertEquals("+91 91234 56780", ok(o.get(A + "/team/" + rid + "/profile")).path("profile").path("emergency_phone").asText());
        assertEquals(403, r.get(A + "/team/" + rid + "/profile").statusCode());

        // boss and team come from the hierarchy
        int mid = findFirst(ok(o.get(A + "/team")), x -> x.path("full_name").asText().endsWith("Manager")).path("id").asInt();
        ok(o.put(A + "/team/" + rid + "/reports-to", Map.of("reports_to", mid)));
        assertEquals(mid, ok(r.get(A + "/me/profile")).path("boss").path("id").asInt());
        assertTrue(anyMatch(ok(p.get("manager").get(A + "/me/profile")).path("reports"), x -> x.path("id").asInt() == rid));
        JsonNode audit = ok(o.get(A + "/admin/audit?category=access"));
        assertTrue(anyMatch(audit, x -> "OWN_PROFILE_CHANGED".equals(x.path("action").asText())));
    }

    @Test
    void test_devices_and_sign_out() {
        Map<String, TestClient> p = people();
        TestClient m = p.get("manager");
        TestClient phone = login("manager");
        TestClient tablet = login("manager");
        JsonNode s = ok(m.get(A + "/me/profile")).path("sessions");
        assertEquals(3, s.size());
        long thisCount = stream(s).filter(x -> x.path("this").asBoolean()).count();
        assertEquals(1, thisCount);
        assertFalse(s.toString().contains("token_hash"));

        // sign out one other device
        JsonNode other = findFirst(s, x -> !x.path("this").asBoolean());
        int otherId = other.path("id").asInt();
        assertEquals(1, ok(m.post(A + "/me/sessions/revoke", Map.of("id", otherId))).path("signed_out").asInt());
        assertEquals("NOT_FOUND", ok(m.post(A + "/me/sessions/revoke", Map.of("id", otherId)), 404).path("error").asText());

        // this device can't be signed out from the list, nor can someone else's session
        JsonNode thisSession = findFirst(ok(m.get(A + "/me/profile")).path("sessions"), x -> x.path("this").asBoolean());
        assertEquals(404, m.post(A + "/me/sessions/revoke", Map.of("id", thisSession.path("id").asInt())).statusCode());
        int ownerSid = findFirst(ok(p.get("owner").get(A + "/me/profile")).path("sessions"), x -> x.path("this").asBoolean())
                .path("id").asInt();
        assertEquals(404, m.post(A + "/me/sessions/revoke", Map.of("id", ownerSid)).statusCode());
        assertEquals(200, p.get("owner").get(A + "/me").statusCode());

        // all others
        List<TestClient> still = new ArrayList<>();
        for (TestClient c : List.of(phone, tablet)) {
            if (c.get(A + "/me").statusCode() == 200) {
                still.add(c);
            }
        }
        assertEquals(1, still.size());
        assertEquals(1, ok(m.post(A + "/me/sessions/revoke", Map.of("all", true))).path("signed_out").asInt());
        assertEquals(200, m.get(A + "/me").statusCode());
        assertEquals(401, still.get(0).get(A + "/me").statusCode());
    }

    @Test
    void test_new_password_signs_out_other_devices() {
        Map<String, TestClient> p = people();
        TestClient m = p.get("manager");
        TestClient other = login("manager");
        ok(m.post(A + "/me/secret", mapOf("current", PASSWORDS.get("manager"), "new", "Another-Pass-2026")));
        assertEquals(200, m.get(A + "/me").statusCode());
        assertEquals(401, other.get(A + "/me").statusCode());
        ok(m.post(A + "/me/secret", mapOf("current", "Another-Pass-2026", "new", PASSWORDS.get("manager"))));
    }

    @Test
    void test_empty_staff_document_is_refused() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        int rid = findFirst(ok(o.get(A + "/team")), x -> x.path("full_name").asText().endsWith("Roaster")).path("id").asInt();
        assertEquals("FILE_EMPTY", ok(o.post(A + "/team/" + rid + "/documents", mapOf(
                "kind", "PHOTO",
                "mime", "image/png",
                "data", "aGVsbG8="
        )), 400).path("error").asText());
    }

    @Test
    void test_owner_staff_record_is_the_owners_own() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient a = p.get("admin");
        JsonNode team = ok(o.get(A + "/team"));
        int oid = findFirst(team, x -> x.path("is_owner").asBoolean()).path("id").asInt();
        int rid = findFirst(team, x -> x.path("full_name").asText().endsWith("Roaster")).path("id").asInt();
        String data = Base64.getEncoder().encodeToString("%PDF-1.4 sample ".repeat(20).getBytes(StandardCharsets.US_ASCII));
        ok(o.put(A + "/team/" + oid + "/profile", Map.of("phone", "9000000009")));
        int did = ok(o.post(A + "/team/" + oid + "/documents", mapOf(
                "kind", "PAN",
                "mime", "application/pdf",
                "data", data
        ))).path("id").asInt();
        assertEquals("OWNER_IS_PROTECTED", ok(a.get(A + "/team/" + oid + "/profile"), 403).path("error").asText());
        assertEquals("OWNER_IS_PROTECTED", ok(a.put(A + "/team/" + oid + "/profile", Map.of("phone", "9000000010")), 403).path("error").asText());
        assertEquals("OWNER_IS_PROTECTED", ok(a.post(A + "/team/" + oid + "/documents", mapOf(
                "kind", "PAN",
                "mime", "application/pdf",
                "data", data
        )), 403).path("error").asText());
        assertEquals(403, a.get(A + "/team/documents/" + did).statusCode());
        assertEquals(403, a.delete(A + "/team/documents/" + did).statusCode());
        assertEquals("9000000009", ok(o.get(A + "/team/" + oid + "/profile")).path("profile").path("phone").asText());
        ok(a.get(A + "/team/" + rid + "/profile")); // everyone else's record is still open to admins
    }
}
