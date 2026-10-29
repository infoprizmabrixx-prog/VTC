package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import in.vasavi.vtc.common.Times;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * v1.4 owner changes (27 Oct 2026): unique codes (Stage-Bean-Date-No.), roasted coffee
 * rest (ready-from), find-by-code for QR scanning, low-stock alerts and 30-day use,
 * contacts for WhatsApp messages only to people allowed to see them.
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_v14.py (4 tests).
 */
class TestV14 extends VtcTestBase {

    String istDay() {
        return Times.compactDayIst();
    }

    int bean(TestClient o, String name, String code) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("kind", "product");
        body.put("name", name);
        body.put("nominal_kg", 50);
        body.put("category", "GREEN_COFFEE");
        if (code != null) {
            body.put("code", code);
        }
        return ok(o.post(A + "/masters", body)).path("id").asInt();
    }

    int bean(TestClient o, String name) {
        return bean(o, name, null);
    }

    JsonNode inward(TestClient r, int pid, int bags, int damaged, int partial, Double partialKg) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("source", "OTHER");
        body.put("source_name", "Supplier");
        body.put("product_id", pid);
        body.put("bags", bags);
        body.put("damaged", damaged);
        body.put("partial", partial);
        body.put("partial_kg", partialKg);
        return ok(r.post(A + "/inward", body, key()));
    }

    JsonNode inward(TestClient r, int pid, int bags) {
        return inward(r, pid, bags, 0, 0, null);
    }

    JsonNode inward(TestClient r, int pid) {
        return inward(r, pid, 4, 0, 0, null);
    }

    @Test
    void test_codes_follow_stage_bean_date_number() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        String d = istDay();
        int rob = bean(o, "Robusta Kaapi AB", "RKAB");
        int ara = bean(o, "Arabica Estate PB");
        assertEquals("ARAEPB", findFirst(ok(o.get(A + "/masters?kind=product")), x -> x.path("id").asInt() == ara).path("code").asText());
        assertEquals("BEAN_CODE_TAKEN",
                ok(o.post(A + "/masters", mapOf("kind", "product", "name", "Mixed thing", "code", "MIX")), 400).path("error").asText());
        assertEquals("BEAN_CODE_TAKEN",
                ok(o.put(A + "/masters/" + ara, Map.of("code", "RKAB")), 400).path("error").asText());
        assertEquals("INVALID_BEAN_CODE",
                ok(o.put(A + "/masters/" + ara, Map.of("code", "a-b")), 400).path("error").asText());

        JsonNode first = inward(r, rob, 10, 1, 2, 61.5);
        String firstCode = first.path("code").asText();
        int n = Integer.parseInt(firstCode.substring(firstCode.lastIndexOf('-') + 1));
        assertEquals(String.format("IN-%s-%02d", d, n), firstCode);
        Map<String, String> lots = new LinkedHashMap<>();
        for (JsonNode x : first.path("lots")) {
            lots.put(x.path("bag_kind").asText(), x.path("code").asText());
        }
        assertEquals(Map.of(
                "SOUND", String.format("RAW-RKAB-%s-%02d", d, n),
                "DAMAGED", String.format("RAW-RKAB-%s-%02dD", d, n),
                "PARTIAL", String.format("RAW-RKAB-%s-%02dP", d, n)
        ), lots);
        assertEquals(String.format("IN-%s-%02d", d, n + 1), inward(r, ara).path("code").asText());

        String soundCode = lots.get("SOUND");
        JsonNode rawR = findFirst(ok(r.get(A + "/inventory")), x -> soundCode.equals(x.path("code").asText()));
        JsonNode rawA = findFirst(ok(r.get(A + "/inventory")),
                x -> x.path("product_id").asInt(-1) == ara && "SOUND".equals(x.path("bag_kind").asText()));

        JsonNode one = ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", rawR.path("id").asInt(), "kg", 50)),
                "output_kg", 42,
                "duration_min", 15
        ), key()));
        JsonNode two = ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(
                        mapOf("lot_id", rawR.path("id").asInt(), "kg", 20),
                        mapOf("lot_id", rawA.path("id").asInt(), "kg", 20)
                ),
                "output_kg", 34,
                "duration_min", 15
        ), key()));
        String oneCode = one.path("code").asText();
        int k = Integer.parseInt(oneCode.substring(oneCode.lastIndexOf('-') + 1));
        assertEquals(String.format("RST-RKAB-%s-%02d", d, k), oneCode);
        assertEquals(String.format("RST-MIX-%s-%02d", d, k + 1), two.path("code").asText());
        ok(o.post(A + "/qc/" + one.path("id").asInt() + "/decision", mapOf("decision", "RELEASED", "note", "Checked colour")));

        // scanning: lower case, VTC: prefix and a bag number all find the lot
        JsonNode found = ok(r.get(A + "/lots/find", Map.of("code", "vtc:" + soundCode.toLowerCase() + "/3")));
        assertEquals(soundCode, found.path("lot").path("code").asText());
        assertEquals(3, found.path("bag").asInt());
        assertEquals(firstCode, found.path("lot").path("receipt_code").asText());
        assertEquals("LOT_NOT_FOUND",
                ok(r.get(A + "/lots/find", Map.of("code", "RAW-NOPE-000000-01")), 404).path("error").asText());

        // grind keeps the bean; transfer and counter lots share their number
        JsonNode roasted = ok(r.get(A + "/lots/find", Map.of("code", oneCode))).path("lot");
        JsonNode g = ok(r.post(A + "/grinds", mapOf(
                "lot_id", roasted.path("id").asInt(),
                "input_kg", 10,
                "output_kg", 9.8,
                "grind", "Fine"
        ), key()));
        int groundLotId = g.path("output_lot_id").asInt();
        JsonNode ground = findFirst(ok(r.get(A + "/inventory")), x -> x.path("id").asInt() == groundLotId);
        assertTrue(ground.path("code").asText().startsWith("GRD-RKAB-"));
        assertEquals(rob, ground.path("bean_id").asInt());
        assertEquals(roasted.path("roasted_on").asText(), ground.path("roasted_on").asText());

        JsonNode t = ok(r.post(A + "/transfers", mapOf("lot_id", groundLotId, "kg", 5), key()));
        JsonNode sent = ok(r.get(A + "/lots/find", Map.of("id", String.valueOf(groundLotId))));
        String trf = sent.path("transfers").get(0).path("transit_code").asText();
        assertTrue(trf.startsWith("TRF-RKAB-"));
        ok(m.post(A + "/transfers/" + t.path("id").asInt() + "/receive", Map.of("kg_received", 5)));
        String ctr = trf.replace("TRF-", "CTR-");
        assertEquals("CTR-01", ok(m.get(A + "/lots/find", Map.of("code", ctr))).path("lot").path("location").asText());
    }

    @Test
    void test_roasted_coffee_rests_before_dispatch() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        ok(o.put(A + "/admin/settings", Map.of("roast_rest_days", 13)));
        int pid = bean(o, "Rest test bean", "RTB");
        inward(r, pid, 2);
        JsonNode raw = findFirst(ok(r.get(A + "/inventory")), x -> x.path("product_id").asInt(-1) == pid);
        JsonNode ro = ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", raw.path("id").asInt(), "kg", 30)),
                "output_kg", 25,
                "duration_min", 15
        ), key()));
        ok(o.post(A + "/qc/" + ro.path("id").asInt() + "/decision", mapOf("decision", "RELEASED", "note", "Checked colour")));
        String roCode = ro.path("code").asText();
        JsonNode lot = ok(r.get(A + "/lots/find", Map.of("code", roCode))).path("lot");
        LocalDate roastedOn = LocalDate.parse(lot.path("roasted_on").asText());
        assertEquals(roastedOn.plusDays(13).toString(), lot.path("ready_from").asText());
        assertTrue(lot.path("resting").asBoolean());

        int cid = ok(o.post(A + "/masters", mapOf("kind", "customer", "name", "Rest Café", "phone", "9000000011"))).path("id").asInt();
        int oid = ok(o.post(A + "/orders", mapOf(
                "customer_id", cid,
                "item", "Beans",
                "quantity_kg", 5,
                "form", "ROASTED",
                "price_per_kg_paise", 40000
        ))).path("id").asInt();
        assertEquals("RESERVED", ok(o.post(A + "/orders/" + oid + "/confirm", Map.of())).path("state").asText());
        ok(o.post(A + "/orders/" + oid + "/advance", mapOf("amount_paise", 210000, "reference", "UPI-1")));
        JsonNode order = findFirst(ok(r.get(A + "/orders")), x -> x.path("id").asInt() == oid);
        assertEquals(lot.path("ready_from").asText(), order.path("resting_until").asText());

        Map<String, Object> body = mapOf("kg", 5, "mode", "VTC_DELIVERY", "handover_to", "Driver");
        assertEquals("COFFEE_STILL_RESTING",
                ok(r.post(A + "/orders/" + oid + "/dispatch", body, key()), 400).path("error").asText());
        Map<String, Object> bodyOk = new LinkedHashMap<>(body);
        bodyOk.put("rest_ok", true);
        ok(r.post(A + "/orders/" + oid + "/dispatch", bodyOk, key()));
        assertTrue(anyMatch(ok(o.get(A + "/admin/audit")), x -> "DISPATCHED_BEFORE_REST".equals(x.path("action").asText())));
        ok(o.put(A + "/admin/settings", Map.of("roast_rest_days", 0)));
        assertFalse(ok(r.get(A + "/lots/find", Map.of("code", roCode))).path("lot").path("resting").asBoolean());
    }

    @Test
    void test_low_stock_alert_once_and_days_left() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int pid = bean(o, "Low stock bean", "LSB");
        inward(r, pid, 2); // 100 kg
        JsonNode raw = findFirst(ok(r.get(A + "/inventory")), x -> x.path("product_id").asInt(-1) == pid);
        int rawId = raw.path("id").asInt();
        ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", rawId, "kg", 40)),
                "output_kg", 33,
                "duration_min", 15
        ), key()));
        ok(o.put(A + "/stock-cards/" + pid, Map.of("low_kg", 70))); // 60 kg raw usable (roasted is on QC hold)
        List<JsonNode> low = stream(ok(m.get(A + "/alerts")))
                .filter(x -> x.path("title").asText().startsWith("Low stock: Low stock bean"))
                .toList();
        assertEquals(1, low.size());
        assertTrue(low.get(0).path("title").asText().contains("60 kg left"));
        assertTrue(anyMatch(ok(m.get(A + "/pending")).path("inventory").path("waiting"),
                w -> w.path("label").asText().contains("low-stock")));

        ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", rawId, "kg", 10)),
                "output_kg", 8,
                "duration_min", 15
        ), key()));
        long lowCount = stream(ok(m.get(A + "/alerts")))
                .filter(x -> x.path("title").asText().startsWith("Low stock: Low stock bean"))
                .count();
        assertEquals(1, lowCount); // no repeat
        assertFalse(anyMatch(ok(r.get(A + "/alerts")), x -> x.path("title").asText().startsWith("Low stock"))); // staff aren't told
        JsonNode card = findFirst(ok(o.get(A + "/stock-cards")), x -> x.path("product_id").asInt() == pid);
        assertEquals(9.0, card.path("used_30_kg").asDouble(), 1e-6); // roast loss 7 + 2 kg
        assertEquals("LSB", card.path("code").asText());
    }

    @Test
    void test_contacts_for_whatsapp_only_where_allowed() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        int cid = ok(o.post(A + "/masters", mapOf("kind", "customer", "name", "WA Café", "phone", "9000000012"))).path("id").asInt();
        ok(r.post(A + "/orders", mapOf("customer_id", cid, "item", "Beans", "quantity_kg", 2, "form", "ROASTED")));
        assertEquals("9000000012", findFirst(ok(o.get(A + "/orders")), x -> x.path("customer_id").asInt() == cid).path("customer_phone").asText());
        assertFalse(findFirst(ok(r.get(A + "/orders")), x -> x.path("customer_id").asInt() == cid).has("customer_phone"));
    }
}
