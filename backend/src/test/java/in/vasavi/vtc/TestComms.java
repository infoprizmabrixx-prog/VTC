package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import in.vasavi.vtc.common.Times;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Messages (DPR Addendum A): who can talk to whom, who sees what, alerts.
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_comms.py (9 tests).
 */
class TestComms extends VtcTestBase {

    int convId(TestClient client, String kind, String title) {
        JsonNode convs = ok(client.get("/api/v1/comms/inbox")).path("conversations");
        return findFirst(convs, c -> kind.equals(c.path("kind").asText())
                && (title == null || title.equals(c.path("title").asText()))).path("id").asInt();
    }

    int convId(TestClient client, String kind) {
        return convId(client, kind, null);
    }

    @Test
    void test_announcement_with_read_receipts_and_audience() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        TestClient r = p.get("roaster");
        int ann = convId(o, "announcement");
        ok(r.post("/api/v1/comms/conversations/" + ann + "/messages", Map.of("body", "staff cannot announce")), 403);
        ok(o.post("/api/v1/comms/conversations/" + ann + "/messages", mapOf("body", "Stock count on Saturday 8 am", "audience", "all")));
        JsonNode teams = ok(o.get("/api/v1/teams"));
        int packing = findFirst(teams, t -> "packing".equals(t.path("key").asText())).path("id").asInt();
        ok(m.post("/api/v1/comms/conversations/" + ann + "/messages", mapOf(
                "body", "Packers: new pouches arrived",
                "audience", "team:" + packing
        )));
        assertEquals(1, ok(r.get("/api/v1/comms/badge")).path("messages").asInt()); // roaster is not in Packing
        JsonNode msgs = ok(r.get("/api/v1/comms/conversations/" + ann)).path("messages");
        List<String> bodies = new ArrayList<>();
        msgs.forEach(x -> bodies.add(x.path("body").asText()));
        assertEquals(List.of("Stock count on Saturday 8 am"), bodies);
        assertEquals(0, ok(r.get("/api/v1/comms/badge")).path("messages").asInt());
        int ownerId = uidOf(o, "Owner");
        JsonNode first = findFirst(ok(o.get("/api/v1/comms/conversations/" + ann)).path("messages"),
                x -> x.path("author_id").asInt() == ownerId);
        assertTrue(anyMatch(first.path("receipts").path("seen"), s -> "Demo Roaster".equals(s.path("name").asText())));
        assertTrue(anyMatch(first.path("receipts").path("not_seen"), s -> "Demo Packer".equals(s.asText())));
    }

    @Test
    void test_team_group_is_members_only() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int roastery = convId(r, "group", "Roastery");
        assertFalse(anyMatch(ok(r.get("/api/v1/comms/inbox")).path("conversations"), c -> "Packing".equals(c.path("title").asText())));
        int packing = convId(m, "group", "Packing");
        ok(r.get("/api/v1/comms/conversations/" + packing), 403);
        ok(r.post("/api/v1/comms/conversations/" + roastery + "/messages", Map.of("body", "Drum is warm, starting batch 1")));
        assertTrue(ok(m.get("/api/v1/comms/badge")).path("messages").asInt() >= 1);
    }

    @Test
    void test_staff_reach_manager_not_owner_unless_allowed() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        List<String> names = new ArrayList<>();
        ok(r.get("/api/v1/comms/contacts")).forEach(x -> names.add(x.path("full_name").asText()));
        assertEquals(List.of("Demo Manager"), names);
        int ownerId = uidOf(o, "Owner");
        JsonNode e = ok(r.post("/api/v1/comms/direct", Map.of("user_id", ownerId)), 403);
        assertEquals("CANNOT_MESSAGE_THIS_PERSON", e.path("error").asText());
        ok(o.put("/api/v1/admin/settings", Map.of("staff_can_message_admins", true)));
        assertTrue(anyMatch(ok(r.get("/api/v1/comms/contacts")), x -> "Owner (Demo)".equals(x.path("full_name").asText())));
        int cid = ok(r.post("/api/v1/comms/direct", Map.of("user_id", ownerId))).path("id").asInt();
        assertEquals(cid, ok(r.post("/api/v1/comms/direct", Map.of("user_id", ownerId))).path("id").asInt()); // same thread reused
    }

    @Test
    void test_direct_chat_private_but_oversight_is_audited() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        TestClient a = p.get("admin");
        TestClient o = p.get("owner");
        int cid = ok(r.post("/api/v1/comms/direct", Map.of("user_id", uidOf(o, "Demo Manager")))).path("id").asInt();
        ok(r.post("/api/v1/comms/conversations/" + cid + "/messages", Map.of("body", "Can I leave early today?")));
        ok(r.get("/api/v1/comms/conversations/" + cid));
        // admin with oversight can read, and it is logged
        JsonNode over = ok(o.get("/api/v1/comms/oversight"));
        assertTrue(anyMatch(over, x -> x.path("id").asInt() == cid));
        JsonNode data = ok(a.get("/api/v1/comms/conversations/" + cid));
        assertTrue(data.path("oversight").asBoolean());
        assertFalse(data.path("may_post").asBoolean());
        assertTrue(anyMatch(ok(o.get("/api/v1/admin/audit?category=access")), x -> "OVERSIGHT_READ".equals(x.path("action").asText())));
        // a manager without oversight cannot read someone else's direct chat
        int other = ok(o.post("/api/v1/comms/direct", Map.of("user_id", uidOf(o, "Office Admin")))).path("id").asInt();
        ok(m.get("/api/v1/comms/conversations/" + other), 403);
    }

    @Test
    void test_record_thread_follows_record_access() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        TestClient o = p.get("owner");
        int pid = ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", "Thread Robusta", "nominal_kg", 50))).path("id").asInt();
        ok(r.post("/api/v1/inward", mapOf("source", "OTHER", "source_name", "Test", "product_id", pid, "bags", 2, "damaged", 0), key()));
        JsonNode lot = findFirst(ok(r.get("/api/v1/inventory")), x -> "RELEASED".equals(x.path("status").asText()));
        int lotId = lot.path("id").asInt();
        JsonNode roast = ok(r.post("/api/v1/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", lotId, "kg", 20)),
                "output_kg", 17,
                "duration_min", 15
        ), key()));
        int roastId = roast.path("id").asInt();
        int tid = ok(m.get("/api/v1/comms/record/roast/" + roastId)).path("id").asInt();
        ok(m.post("/api/v1/comms/conversations/" + tid + "/messages", Map.of("body", "Why 15% loss? Check the probe.")));
        // the roaster created the batch, so follows the thread automatically
        JsonNode inbox = ok(r.get("/api/v1/comms/inbox"));
        JsonNode thread = findFirst(inbox.path("conversations"), c -> c.path("id").asInt() == tid);
        assertEquals(1, thread.path("unread").asInt());
        assertEquals("Roast batch #" + roastId, thread.path("title").asText());
        // remove the roaster's stock access: lot threads close to them too
        ok(r.get("/api/v1/comms/record/lot/" + lotId));
        ok(o.post("/api/v1/admin/users/" + uidOf(o, "Roaster") + "/grants", mapOf(
                "perm_key", "inventory.view",
                "effect", "deny",
                "reason", "testing thread access"
        )));
        ok(r.get("/api/v1/comms/record/lot/" + lotId), 403);
    }

    @Test
    void test_alerts_go_to_people_who_can_act() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        int pid = ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", "Alert Robusta", "nominal_kg", 50))).path("id").asInt();
        ok(r.post("/api/v1/inward", mapOf("source", "OTHER", "source_name", "Test", "product_id", pid, "bags", 3, "damaged", 1), key()));
        assertTrue(anyMatch(ok(o.get("/api/v1/alerts")), a -> a.path("title").asText().contains("damaged bag")));
        assertFalse(anyMatch(ok(m.get("/api/v1/alerts")), a -> a.path("title").asText().contains("damaged bag"))); // manager can't verify
        int rid = uidOf(o, "Roaster");
        ok(m.post("/api/v1/tasks", mapOf("title", "Roast 2 batches", "assigned_to", rid)));
        // v1.2: everyday work shows in its own section (and the menu count), not in the bell
        assertFalse(anyMatch(ok(r.get("/api/v1/alerts")), a -> a.path("title").asText().startsWith("New work")));
        assertTrue(anyMatch(ok(r.get("/api/v1/pending")).path("tasks").path("tasks"), t -> "Roast 2 batches".equals(t.path("title").asText())));
        ok(r.post("/api/v1/alerts/read", Map.of("ids", "all")));
        assertEquals(0, ok(r.get("/api/v1/comms/badge")).path("alerts").asInt());
    }

    @Test
    void test_quiet_hours_hold_normal_alerts() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        // make every hour quiet: 0 -> 23 (start > end wraps; start==end disables)
        ok(o.put("/api/v1/admin/settings", mapOf("quiet_start_hour", 0, "quiet_end_hour", 23)));
        int hour = Times.now().atZone(Times.IST_OFFSET).getHour();
        ok(m.post("/api/v1/tasks", mapOf("title", "Night job", "assigned_to", uidOf(o, "Roaster"))));
        JsonNode alerts = ok(p.get("roaster").get("/api/v1/alerts"));
        if (hour < 23) {
            assertFalse(anyMatch(alerts, a -> "New work: Night job".equals(a.path("title").asText())));
        }
    }

    @Test
    void test_voice_note_upload_and_access() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        byte[] prefix = "OggS".getBytes(StandardCharsets.US_ASCII);
        byte[] payload = new byte[prefix.length + 400];
        System.arraycopy(prefix, 0, payload, 0, prefix.length);
        String data = Base64.getEncoder().encodeToString(payload);

        ok(r.post("/api/v1/comms/voice", mapOf("mime", "image/png", "data", data)), 400);
        int fid = ok(r.post("/api/v1/comms/voice", mapOf("mime", "audio/ogg", "data", data))).path("id").asInt();
        int roastery = convId(r, "group", "Roastery");
        ok(r.post("/api/v1/comms/conversations/" + roastery + "/messages", Map.of("voice_file_id", fid)));
        assertEquals(200, m.get("/api/v1/comms/files/" + fid).statusCode()); // manager is in Roastery
        TestClient adminCli = p.get("admin"); // office admin, not in Roastery, but oversight
        assertEquals(200, adminCli.get("/api/v1/comms/files/" + fid).statusCode());
        // someone else's voice id can't be attached
        ok(m.post("/api/v1/comms/conversations/" + roastery + "/messages", Map.of("voice_file_id", fid)), 400);
    }

    @Test
    void test_admin_manages_team_membership() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        int rid = uidOf(o, "Roaster");
        int packing = findFirst(ok(o.get("/api/v1/teams")), t -> "packing".equals(t.path("key").asText())).path("id").asInt();
        ok(o.put("/api/v1/admin/users/" + rid + "/teams", Map.of("team_ids", List.of(packing))));
        JsonNode convs = ok(p.get("roaster").get("/api/v1/comms/inbox")).path("conversations");
        assertTrue(anyMatch(convs, c -> "Packing".equals(c.path("title").asText())));
        assertFalse(anyMatch(convs, c -> "Roastery".equals(c.path("title").asText())));
        ok(p.get("manager").put("/api/v1/admin/users/" + rid + "/teams", Map.of("team_ids", List.of())), 403);
    }
}
