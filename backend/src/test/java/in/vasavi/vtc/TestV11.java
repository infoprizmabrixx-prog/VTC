package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * v1.1 owner changes (26 Oct 2026): work-linked tasks with review, partial bags,
 * roast profiles and 2-lot roasts, Admin Control masters/prices, counter Others,
 * close today's bills.
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_v11.py (12 tests).
 */
class TestV11 extends VtcTestBase {

    public static Object[] rawStock(VtcTestBase base, TestClient o, TestClient r, int bags, int damaged, int partial, Double partialKg) {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 4);
        int pid = base.ok(o.post(A + "/masters", mapOf(
                "kind", "product",
                "name", "Robusta " + suffix,
                "nominal_kg", 50,
                "category", "GREEN_COFFEE"
        ))).path("id").asInt();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("source", "OTHER");
        body.put("source_name", "Supplier");
        body.put("product_id", pid);
        body.put("bags", bags);
        body.put("damaged", damaged);
        body.put("partial", partial);
        body.put("partial_kg", partialKg);
        JsonNode res = base.ok(r.post(A + "/inward", body, key()));
        return new Object[]{pid, res};
    }

    Object[] rawStock(TestClient o, TestClient r, int bags, int damaged, int partial, Double partialKg) {
        return rawStock(this, o, r, bags, damaged, partial, partialKg);
    }

    Object[] rawStock(TestClient o, TestClient r, int bags) {
        return rawStock(this, o, r, bags, 0, 0, null);
    }

    int setupCounterGround(TestClient o, TestClient r, TestClient m) {
        int chic = ok(o.post(A + "/masters", mapOf("kind", "product", "name", "Chicory", "nominal_kg", 25, "category", "CHICORY"))).path("id").asInt();
        int rob = ok(o.post(A + "/masters", mapOf("kind", "product", "name", "Robusta", "nominal_kg", 50))).path("id").asInt();
        for (int p : new int[]{chic, rob}) {
            ok(r.post(A + "/inward", mapOf("source", "OTHER", "source_name", "Supplier", "product_id", p, "bags", 1, "damaged", 0), key()));
        }
        JsonNode inv = ok(r.get(A + "/inventory"));
        JsonNode raw = findFirst(inv, x -> x.path("product_id").asInt(-1) == rob);
        JsonNode roast = ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", raw.path("id").asInt(), "kg", 20)),
                "output_kg", 17,
                "duration_min", 15
        ), key()));
        ok(o.post(A + "/qc/" + roast.path("id").asInt() + "/decision", mapOf("decision", "RELEASED", "note", "Checked colour")));
        JsonNode roasted = findFirst(ok(r.get(A + "/inventory")), x -> "ROASTED".equals(x.path("stage").asText()));
        ok(r.post(A + "/grinds", mapOf("lot_id", roasted.path("id").asInt(), "input_kg", 10, "output_kg", 10, "grind", "Filter"), key()));
        inv = ok(r.get(A + "/inventory"));
        JsonNode groundLot = findFirst(inv, x -> "GROUND".equals(x.path("stage").asText()));
        JsonNode chicLot = findFirst(inv, x -> x.path("product_id").asInt(-1) == chic);
        int t1 = ok(r.post(A + "/transfers", mapOf("lot_id", groundLot.path("id").asInt(), "kg", 8), key())).path("id").asInt();
        ok(m.post(A + "/transfers/" + t1 + "/receive", Map.of("kg_received", 8)));
        int t2 = ok(r.post(A + "/transfers", mapOf("lot_id", chicLot.path("id").asInt(), "kg", 5), key())).path("id").asInt();
        ok(m.post(A + "/transfers/" + t2 + "/receive", Map.of("kg_received", 5)));
        return chic;
    }

    @Test
    void test_partial_bags_use_weighed_kg_and_get_their_own_lot() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        Object[] rs = rawStock(o, r, 10, 1, 2, 61.5);
        int pid = (int) rs[0];
        JsonNode res = (JsonNode) rs[1];
        assertEquals(8 * 50 + 61.5, res.path("nominal_kg").asDouble(), 1e-6);
        assertEquals(7 * 50 + 61.5, res.path("allocatable_kg").asDouble(), 1e-6);
        assertEquals(50.0, res.path("quarantine_kg").asDouble(), 1e-6);
        Map<String, JsonNode> lots = new LinkedHashMap<>();
        for (JsonNode x : ok(r.get(A + "/inventory"))) {
            if (x.path("product_id").asInt(-1) == pid) {
                lots.put(x.path("bag_kind").asText(), x);
            }
        }
        assertEquals(350.0, lots.get("SOUND").path("kg").asDouble(), 1e-6);
        assertEquals("QUARANTINE", lots.get("DAMAGED").path("status").asText());
        assertEquals(61.5, lots.get("PARTIAL").path("kg").asDouble(), 1e-6);
        TestResponse bad = r.post(A + "/inward", mapOf(
                "source", "OTHER",
                "source_name", "Supplier",
                "product_id", pid,
                "bags", 3,
                "damaged", 0,
                "partial", 1,
                "partial_kg", 50
        ), key());
        assertEquals("PARTIAL_KG_MUST_BE_LESS_THAN_FULL_BAGS", bad.json().path("error").asText());
    }

    @Test
    void test_roast_two_lots_max_and_profile_from_owner_list() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int pid = (int) rawStock(o, r, 4, 0, 1, 20.0)[0];
        List<Integer> lots = new ArrayList<>();
        for (JsonNode x : ok(r.get(A + "/inventory"))) {
            if (x.path("product_id").asInt(-1) == pid) {
                lots.add(x.path("id").asInt());
            }
        }
        TestResponse three = r.post(A + "/roasts", mapOf(
                "inputs", List.of(
                        mapOf("lot_id", lots.get(0), "kg", 1),
                        mapOf("lot_id", lots.get(1), "kg", 1),
                        mapOf("lot_id", 999, "kg", 1)
                ),
                "output_kg", 2,
                "duration_min", 10
        ), key());
        assertEquals("ROAST_NEEDS_1_OR_2_INPUTS", three.json().path("error").asText());
        assertEquals(403, m.post(A + "/roast-profiles", Map.of("name", "City+")).statusCode()); // owner/admin list
        int prof = ok(o.post(A + "/roast-profiles", mapOf("name", "City+", "notes", "205C"))).path("id").asInt();
        Map<String, Object> body = mapOf(
                "inputs", List.of(mapOf("lot_id", lots.get(0), "kg", 10), mapOf("lot_id", lots.get(1), "kg", 5)),
                "output_kg", 12.6,
                "duration_min", 16
        );
        assertEquals("CHOOSE_A_ROAST_PROFILE", r.post(A + "/roasts", body, key()).json().path("error").asText());
        Map<String, Object> withProf = new LinkedHashMap<>(body);
        withProf.put("profile_id", prof);
        ok(r.post(A + "/roasts", withProf, key()));
        JsonNode day = ok(r.get(A + "/roasts"));
        assertEquals("City+", day.get(0).path("profile").asText());
        assertEquals("Demo Roaster", day.get(0).path("roaster").asText());
        assertTrue(day.get(0).path("inputs").asText().contains("+"));
        String month = day.get(0).path("created_at").asText().substring(0, 7);
        JsonNode cal = ok(r.get(A + "/roasts?month=" + month));
        int totalBatches = 0;
        for (JsonNode d : cal.path("days")) {
            totalBatches += d.path("batches").asInt();
        }
        assertEquals(1, totalBatches);
    }

    @Test
    void test_linked_task_counts_itself_and_needs_assigner_approval() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int roaster = uidOf(o, "Roaster");
        int pid = (int) rawStock(o, r, 4)[0];
        int lot = findFirst(ok(r.get(A + "/inventory")), x -> x.path("product_id").asInt(-1) == pid).path("id").asInt();
        int tid = ok(m.post(A + "/tasks", mapOf("kind", "ROAST", "assigned_to", roaster, "target", 2))).path("id").asInt();
        for (int i = 0; i < 2; i++) {
            ok(r.post(A + "/roasts", mapOf(
                    "inputs", List.of(mapOf("lot_id", lot, "kg", 10)),
                    "output_kg", 8.5,
                    "duration_min", 15
            ), key()));
        }
        JsonNode t = findFirst(ok(r.get(A + "/tasks")), x -> x.path("id").asInt() == tid);
        assertEquals(2.0, t.path("progress").asDouble(), 1e-6);
        assertEquals("Roast 2 batches", t.path("title").asText());
        assertEquals(403, m.post(A + "/tasks/" + tid + "/submit", Map.of()).statusCode()); // only the doer completes
        ok(r.post(A + "/tasks/" + tid + "/submit", Map.of()));
        assertEquals(403, o.post(A + "/tasks/" + tid + "/review", Map.of("approve", true)).statusCode()); // not the assigner
        assertEquals(403, r.post(A + "/tasks/" + tid + "/review", Map.of("approve", true)).statusCode()); // never your own
        assertEquals("REASON_REQUIRED", m.post(A + "/tasks/" + tid + "/review", Map.of("approve", false)).json().path("error").asText());
        ok(m.post(A + "/tasks/" + tid + "/review", mapOf("approve", false, "note", "Weigh output again")));
        assertEquals("IN_PROGRESS", findFirst(ok(r.get(A + "/tasks")), x -> x.path("id").asInt() == tid).path("status").asText());
        ok(r.post(A + "/tasks/" + tid + "/submit", Map.of()));
        ok(m.post(A + "/tasks/" + tid + "/review", Map.of("approve", true)));
        assertEquals("DONE", findFirst(ok(m.get(A + "/tasks")), x -> x.path("id").asInt() == tid).path("status").asText());
    }

    @Test
    void test_task_rules_short_target_and_wrong_assignee() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int roaster = uidOf(o, "Roaster");
        assertEquals("ASSIGNEE_CANNOT_DO_THIS_WORK",
                m.post(A + "/tasks", mapOf("kind", "QC", "assigned_to", roaster, "target", 3)).json().path("error").asText());
        int tid = ok(m.post(A + "/tasks", mapOf("kind", "COUNTER", "assigned_to", roaster, "target", 5))).path("id").asInt();
        assertEquals("EXPLAIN_WHY_TARGET_NOT_REACHED",
                r.post(A + "/tasks/" + tid + "/submit", Map.of()).json().path("error").asText());
        // self-assigned work is reviewed by another manager/admin holding tasks.approve
        int me = uidOf(o, "Manager");
        int own = ok(m.post(A + "/tasks", mapOf("kind", "GENERAL", "title", "Order packing film", "assigned_to", me))).path("id").asInt();
        ok(m.post(A + "/tasks/" + own + "/submit", Map.of("note", "Ordered")));
        ok(p.get("admin").post(A + "/tasks/" + own + "/review", Map.of("approve", true)));
    }

    @Test
    void test_masters_live_in_admin_control_and_only_admin_edits() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        JsonNode me = ok(m.get(A + "/me"));
        assertTrue(anyMatch(me.path("modules"), mod -> "admin".equals(mod.asText())));
        assertFalse(anyMatch(me.path("modules"), mod -> "masters".equals(mod.asText())));
        JsonNode draft = ok(m.post(A + "/masters", mapOf("kind", "customer", "name", "New café")));
        assertEquals("DRAFT", draft.path("state").asText());
        assertEquals(403, m.put(A + "/masters/" + draft.path("id").asInt(), Map.of("name", "X")).statusCode());
        int pid = ok(o.post(A + "/masters", mapOf(
                "kind", "product",
                "name", "Arabica A",
                "nominal_kg", 50,
                "category", "GREEN_COFFEE"
        ))).path("id").asInt();
        ok(o.put(A + "/masters/" + pid, mapOf("nominal_kg", 60, "name", "Arabica Plantation A")));
        ok(o.put(A + "/masters/" + pid, Map.of("active", false)));
        assertFalse(anyMatch(ok(p.get("roaster").get(A + "/masters?kind=product")), x -> x.path("id").asInt() == pid));
        assertEquals(200, o.post(A + "/masters", mapOf("kind", "product", "name", "Arabica Plantation A")).statusCode()); // old one is off
    }

    @Test
    void test_counter_others_custom_ratio_price_and_override() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int chic = setupCounterGround(o, r, m);
        Map<String, Object> sale = mapOf(
                "lines", List.of(mapOf("custom", Map.of("coffee_pct", 80), "weight_kg", 1)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 78000))
        );
        assertEquals("CUSTOM_BLEND_NOT_SET_UP", r.post(A + "/counter/sales", sale, key()).json().path("error").asText());
        ok(o.put(A + "/admin/settings", mapOf(
                "custom_coffee_rate_paise", 90000,
                "custom_chicory_rate_paise", 30000,
                "custom_chicory_product_id", chic
        )));
        JsonNode b = ok(r.post(A + "/counter/sales", sale, key()));
        assertEquals(78000, b.path("lines").get(0).path("rate_paise").asInt());
        assertEquals("Custom 80/20 coffee powder", b.path("lines").get(0).path("item_name").asText());
        Map<String, Object> over = mapOf(
                "lines", List.of(mapOf(
                        "custom", mapOf("coffee_pct", 80, "override_rate_paise", 70000, "override_reason", "Regular customer"),
                        "weight_kg", 1
                )),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 70000))
        );
        assertEquals(403, r.post(A + "/counter/sales", over, key()).statusCode()); // staff can't change price
        b = ok(m.post(A + "/counter/sales", over, key()));
        assertEquals("Regular customer", b.path("lines").get(0).path("override_reason").asText());
        // stock: 0.8+0.8 kg coffee and 0.2+0.2 kg chicory gone
        JsonNode stock = ok(r.get(A + "/counter/setup")).path("stock");
        assertTrue(Math.abs(stock.path("coffee_ground").asDouble() - 6.4) < 1e-6);
        assertTrue(Math.abs(stock.path("custom_chicory").asDouble() - 4.6) < 1e-6);
    }

    @Test
    void test_close_today_locks_counter_saves_register_and_admin_reopens() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        setupCounterGround(o, r, m);
        int item = ok(o.post(A + "/counter/items", mapOf(
                "name", "Pure",
                "kind", "coffee_ground",
                "coffee_pct", 100,
                "price_per_kg_paise", 90000
        ))).path("id").asInt();
        ok(o.put(A + "/admin/settings", Map.of("counter_opening_float_paise", 100000)));
        ok(r.post(A + "/counter/sales", mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 1)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 90000))
        ), key()));
        JsonNode k = ok(r.post(A + "/counter/cash-close", Map.of("counted_paise", 190000)));
        assertEquals("BALANCED", k.path("state").asText());
        Map<String, Object> sale = mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 0.5)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 45000))
        );
        assertEquals("COUNTER_CLOSED_FOR_TODAY", r.post(A + "/counter/sales", sale, key()).json().path("error").asText());
        int closeId = k.path("id").asInt();
        JsonNode reg = ok(r.get(A + "/counter/cash-close/" + closeId + "/register"));
        assertEquals(1, reg.path("register").path("bill_count").asInt());
        assertEquals(90000, reg.path("register").path("by_method").path("CASH").asInt());
        assertEquals(403, m.post(A + "/counter/cash-close/" + closeId + "/reopen", Map.of("reason", "Closed too early")).statusCode());
        ok(o.post(A + "/counter/cash-close/" + closeId + "/reopen", Map.of("reason", "Closed too early")));
        ok(r.post(A + "/counter/sales", sale, key()));
        JsonNode k2 = ok(r.post(A + "/counter/cash-close", Map.of("counted_paise", 235000)));
        assertEquals(2, ok(r.get(A + "/counter/cash-close/" + k2.path("id").asInt() + "/register"))
                .path("register").path("bill_count").asInt());
    }

    @Test
    void test_pending_is_per_section_and_staff_see_only_their_jobs() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int roaster = uidOf(o, "Roaster");
        int pid = (int) rawStock(o, r, 4)[0];
        ok(m.post(A + "/tasks", mapOf("kind", "ROAST", "assigned_to", roaster, "target", 2)));
        ok(m.post(A + "/tasks", mapOf("kind", "INWARD", "assigned_to", roaster, "target", 5)));
        JsonNode mine = ok(r.get(A + "/pending"));
        List<String> titles = new ArrayList<>();
        mine.path("roasting").path("tasks").forEach(t -> titles.add(t.path("title").asText()));
        assertEquals(List.of("Roast 2 batches"), titles);
        assertEquals(1, mine.path("inward").path("count").asInt());
        assertFalse(mine.has("orders")); // staff: no manager decisions
        ok(r.post(A + "/inward", mapOf("source", "OTHER", "source_name", "Supplier", "product_id", pid, "bags", 5, "damaged", 0), key()));
        assertEquals(5.0, ok(r.get(A + "/pending")).path("inward").path("tasks").get(0).path("progress").asDouble(), 1e-6); // bags counted by themselves
        int lot = findFirst(ok(r.get(A + "/inventory")), x -> x.path("product_id").asInt(-1) == pid).path("id").asInt();
        ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", lot, "kg", 10)),
                "output_kg", 8.4,
                "duration_min", 15
        ), key()));
        JsonNode team = ok(m.get(A + "/pending"));
        assertEquals("Demo Roaster", team.path("roasting").path("tasks").get(0).path("assignee").asText()); // managers see everyone's
        assertTrue(anyMatch(ok(o.get(A + "/pending")).path("qc").path("waiting"),
                w -> w.path("label").asText().startsWith("roast batches")));
    }

    @Test
    void test_counter_customer_is_remembered_and_masked() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        setupCounterGround(o, r, m);
        int item = ok(o.post(A + "/counter/items", mapOf(
                "name", "Pure",
                "kind", "coffee_ground",
                "coffee_pct", 100,
                "price_per_kg_paise", 90000
        ))).path("id").asInt();
        Map<String, Object> sale = mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 0.5)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 45000)),
                "customer_name", "Ravi",
                "customer_phone", "+91 98480 12345"
        );
        JsonNode b = ok(r.post(A + "/counter/sales", sale, key()));
        assertEquals("••••••2345", b.path("customer_phone").asText()); // never the full number on a bill
        ok(o.put(A + "/counter/items/" + item, Map.of("price_per_kg_paise", 95000)));
        JsonNode card = ok(r.get(A + "/counter/customers/lookup?phone=9848012345"));
        assertTrue(card.path("found").asBoolean());
        assertEquals("Ravi", card.path("name").asText());
        assertEquals(1, card.path("visits").asInt());
        assertTrue(card.path("phone_masked").asText().endsWith("2345"));
        JsonNode line = card.path("last_bill").path("lines").get(0);
        assertEquals(90000, line.path("rate_paise").asInt());
        assertEquals(95000, line.path("price_now").asInt()); // cashier sees the price changed
        assertEquals(403, r.get(A + "/counter/customers").statusCode()); // full list is admin-only
        assertEquals("9848012345", ok(o.get(A + "/counter/customers")).get(0).path("phone").asText());
    }

    @Test
    void test_cash_today_needs_admin_and_pin() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        assertEquals(403, m.get(A + "/counter/insights").statusCode());
        assertEquals(423, o.get(A + "/counter/insights").statusCode()); // locked until PIN
        assertEquals("INSIGHTS_PIN_NOT_SET", o.post(A + "/counter/insights/unlock", Map.of("pin", "4826")).json().path("error").asText());
        assertEquals("PIN_TOO_SIMPLE", o.put(A + "/counter/insights/pin", Map.of("pin", "1111")).json().path("error").asText());
        ok(o.put(A + "/counter/insights/pin", Map.of("pin", "4826")));
        assertEquals("WRONG_PIN", o.post(A + "/counter/insights/unlock", Map.of("pin", "0000")).json().path("error").asText());
        ok(o.post(A + "/counter/insights/unlock", Map.of("pin", "4826")));
        JsonNode x = ok(o.get(A + "/counter/insights"));
        assertEquals(30, x.path("trend").size());
        assertEquals(24, x.path("hours").size());
        ok(o.post(A + "/counter/collections", mapOf("method", "UPI", "amount_paise", 12000, "note", "PhonePe statement")));
        assertEquals(12000, ok(o.get(A + "/counter/insights")).path("entered").path("UPI").asInt());
        assertEquals(423, p.get("admin").get(A + "/counter/insights").statusCode()); // unlock is per session
    }

    @Test
    void test_roast_month_record_meter_and_gas() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        String month = ok(r.get(A + "/roasts/month-record")).path("month").asText();
        ok(r.put(A + "/roasts/meter", mapOf("month", month, "start_reading", 6605)));
        assertEquals("END_READING_BELOW_START",
                r.put(A + "/roasts/meter", mapOf("month", month, "end_reading", 6600)).json().path("error").asText());
        ok(r.put(A + "/roasts/meter", mapOf("month", month, "end_reading", 6650)));
        ok(r.post(A + "/roasts/cylinders", mapOf("kg", 19, "fitted_on", month + "-02")));
        JsonNode rec = ok(o.get(A + "/roasts/month-record?month=" + month));
        assertEquals(45.0, rec.path("meter_count").asDouble(), 1e-6);
        assertEquals(19.0, rec.path("gas_kg").asDouble(), 1e-6);
    }

    @Test
    void test_maintenance_ticket_flow() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int tid = ok(r.post(A + "/maintenance", mapOf(
                "title", "Roaster drum noise",
                "area", "ROASTER",
                "urgency", "URGENT",
                "details", "Grinding sound at 180C"
        ))).path("id").asInt();
        assertEquals(403, r.put(A + "/maintenance/" + tid, mapOf("status", "RESOLVED", "note", "x")).statusCode());
        assertTrue(anyMatch(ok(m.get(A + "/pending")).path("maintenance").path("waiting"),
                w -> w.path("label").asText().startsWith("maintenance")));
        assertEquals("SAY_WHAT_WAS_DONE",
                m.put(A + "/maintenance/" + tid, Map.of("status", "RESOLVED")).json().path("error").asText());
        ok(m.put(A + "/maintenance/" + tid, mapOf("status", "RESOLVED", "note", "Bearing greased")));
        assertEquals("RESOLVED", ok(r.get(A + "/maintenance")).get(0).path("status").asText());
    }
}
