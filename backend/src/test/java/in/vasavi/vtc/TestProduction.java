package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Blending, grinding, outside roasting, packing (DPR §7, §8).
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_production.py (4 tests).
 */
class TestProduction extends VtcTestBase {

    public static JsonNode[] roastedStock(VtcTestBase base, TestClient o, TestClient r, String name, double kg) {
        int pid = base.ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", name, "nominal_kg", 50))).path("id").asInt();
        base.ok(r.post("/api/v1/inward", mapOf(
                "source", "OTHER",
                "source_name", "Supplier",
                "product_id", pid,
                "bags", 2,
                "damaged", 0
        ), key()));
        JsonNode raw = findFirst(base.ok(r.get("/api/v1/inventory")), x -> x.path("product_id").asInt(-1) == pid);
        double outKg = Math.round(kg * 0.84 * 1000.0) / 1000.0;
        JsonNode ro = base.ok(r.post("/api/v1/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", raw.path("id").asInt(), "kg", kg)),
                "output_kg", outKg,
                "duration_min", 16
        ), key()));
        int roastId = ro.path("id").asInt();
        base.ok(o.post("/api/v1/qc/" + roastId + "/decision", mapOf("decision", "RELEASED", "note", "Checked colour")));
        JsonNode roasted = findFirst(base.ok(r.get("/api/v1/inventory")), x -> x.path("roast_id").asInt(-1) == roastId);
        return new JsonNode[]{roasted, raw};
    }

    JsonNode[] roastedStock(TestClient o, TestClient r, String name, double kg) {
        return roastedStock(this, o, r, name, kg);
    }

    JsonNode[] roastedStock(TestClient o, TestClient r, String name) {
        return roastedStock(this, o, r, name, 30);
    }

    JsonNode[] roastedStock(TestClient o, TestClient r) {
        return roastedStock(this, o, r, "Robusta", 30);
    }

    @Test
    void test_confidential_recipe_view_run_edit_are_separate() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        JsonNode a = roastedStock(o, r, "Arabica")[0];
        JsonNode b = roastedStock(o, r, "Robusta")[0];
        ok(m.post("/api/v1/recipes", mapOf(
                "name", "House",
                "stage", "ROASTED",
                "components", List.of(mapOf("name", "A", "pct", 50), mapOf("name", "B", "pct", 50))
        )), 403);
        ok(o.post("/api/v1/recipes", mapOf(
                "name", "Bad",
                "stage", "ROASTED",
                "components", List.of(mapOf("name", "A", "pct", 60), mapOf("name", "B", "pct", 30))
        )), 400);
        int rid = ok(o.post("/api/v1/recipes", mapOf(
                "name", "Signature blend",
                "stage", "ROASTED",
                "confidential", true,
                "components", List.of(
                        mapOf("name", "Arabica roasted", "pct", 70),
                        mapOf("name", "Robusta roasted", "pct", 30)
                )
        ))).path("id").asInt();
        JsonNode seen = findFirst(ok(r.get("/api/v1/recipes")), x -> x.path("id").asInt() == rid);
        assertFalse(seen.path("formula_visible").asBoolean());
        assertTrue(seen.path("components").get(0).path("pct").isNull());
        assertFalse(seen.path("may_run").asBoolean());

        Map<String, Object> body = mapOf(
                "recipe_id", rid,
                "inputs", List.of(
                        mapOf("component", 0, "lot_id", a.path("id").asInt(), "kg", 7),
                        mapOf("component", 1, "lot_id", b.path("id").asInt(), "kg", 3)
                ),
                "output_kg", 10
        );
        ok(r.post("/api/v1/blends", body, key()), 403);
        ok(o.post("/api/v1/admin/users/" + uidOf(o, "Roaster") + "/grants", mapOf(
                "perm_key", "recipe.execute_secret",
                "effect", "allow",
                "reason", "Trusted operator"
        )));
        JsonNode res = ok(r.post("/api/v1/blends", body, key()));
        assertTrue(res.path("actual_pct").isNull()); // may run, still may not read the formula
        int outLotId = res.path("output_lot_id").asInt();
        JsonNode out = findFirst(ok(o.get("/api/v1/inventory")), x -> x.path("id").asInt() == outLotId);
        assertEquals("BLENDED", out.path("stage").asText());
        assertEquals(10.0, out.path("kg").asDouble(), 1e-6);
        ok(o.put("/api/v1/recipes/" + rid, Map.of(
                "components", List.of(
                        mapOf("name", "Arabica roasted", "pct", 60),
                        mapOf("name", "Robusta roasted", "pct", 40)
                )
        )));
        assertEquals(2, findFirst(ok(o.get("/api/v1/recipes")), x -> x.path("id").asInt() == rid).path("version").asInt());
    }

    @Test
    void test_grind_creates_ground_lot_with_loss() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        JsonNode lot = roastedStock(o, r)[0];
        JsonNode res = ok(r.post("/api/v1/grinds", mapOf(
                "lot_id", lot.path("id").asInt(),
                "input_kg", 5,
                "output_kg", 4.9,
                "grind", "Medium (filter)"
        ), key()));
        assertEquals(0.1, res.path("loss_kg").asDouble(), 1e-6);
        ok(r.post("/api/v1/grinds", mapOf(
                "lot_id", lot.path("id").asInt(),
                "input_kg", 1,
                "output_kg", 2,
                "grind", "Fine"
        ), key()), 400);
    }

    @Test
    void test_customer_coffee_never_mixes_with_company_stock() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        int cid = ok(o.post("/api/v1/masters", mapOf("kind", "customer", "name", "Sample Café"))).path("id").asInt();
        int jid = ok(r.post("/api/v1/outside/jobs", mapOf(
                "customer_id", cid,
                "received_kg", 20,
                "charge_basis", "INPUT_KG",
                "rate_paise", 4000,
                "bean_type", "Robusta Cherry"
        ))).path("id").asInt();
        JsonNode lot = findFirst(ok(o.get("/api/v1/inventory")), x -> ("CUST:" + cid).equals(x.path("owner").asText()));
        // company roasting can't touch it
        ok(r.post("/api/v1/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", lot.path("id").asInt(), "kg", 5)),
                "output_kg", 4,
                "duration_min", 10
        ), key()), 400);
        JsonNode res = ok(r.post("/api/v1/outside/jobs/" + jid + "/roast", mapOf("input_kg", 20, "output_kg", 16.8)));
        assertEquals(80000, res.path("charge_paise").asInt());
        ok(r.post("/api/v1/outside/jobs/" + jid + "/return", mapOf("kg", 17, "note", "Owner collected")), 400); // more than exists
        ok(r.post("/api/v1/outside/jobs/" + jid + "/return", mapOf("kg", 16.8, "note", "Café driver Ravi collected, bike")));
        JsonNode job = ok(o.get("/api/v1/outside/jobs")).path("jobs").get(0);
        assertEquals("RETURNED", job.path("state").asText());
        assertEquals(16.8, job.path("returned_kg").asDouble(), 1e-6);
        assertFalse(ok(r.get("/api/v1/outside/jobs")).path("jobs").get(0).has("charge_paise")); // staff don't see money
    }

    @Test
    void test_packing_posts_finished_goods_on_qa_hold() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        JsonNode lot = roastedStock(o, r)[0];
        int lotId = lot.path("id").asInt();
        int pid = ok(m.post("/api/v1/packing", mapOf(
                "product_name", "Filter blend",
                "demand_type", "STOCK",
                "packs_target", 20,
                "pack_g", 500
        ))).path("id").asInt();
        ok(r.post("/api/v1/packing/" + pid + "/run", mapOf(
                "source_lot_id", lotId,
                "input_kg", 5,
                "good_packs", 12,
                "rejected_packs", 0
        ), key()), 400); // 6 kg > 5 kg used
        JsonNode res = ok(r.post("/api/v1/packing/" + pid + "/run", mapOf(
                "source_lot_id", lotId,
                "input_kg", 6.2,
                "good_packs", 12,
                "rejected_packs", 1
        ), key()));
        assertEquals("IN_PROGRESS", res.path("state").asText());
        assertEquals(0.2, res.path("loss_kg").asDouble(), 1e-6);
        JsonNode packed = findFirst(ok(o.get("/api/v1/inventory")), x -> "PACKED".equals(x.path("stage").asText()));
        assertEquals("QC_HOLD", packed.path("status").asText());
        assertEquals(12, packed.path("units").asInt());
        ok(r.post("/api/v1/packing/" + pid + "/run", mapOf(
                "source_lot_id", lotId,
                "input_kg", 4.1,
                "good_packs", 8,
                "rejected_packs", 0
        ), key()));
        ok(r.post("/api/v1/packing/" + pid + "/release", Map.of("note", "Seal and weight checked")), 403);
        ok(o.post("/api/v1/packing/" + pid + "/release", Map.of("note", "Seal and weight checked")));
        packed = findFirst(ok(o.get("/api/v1/inventory")), x -> "PACKED".equals(x.path("stage").asText()));
        assertEquals("RELEASED", packed.path("status").asText());
        assertEquals(20, packed.path("units").asInt());
        ok(r.post("/api/v1/packing/" + pid + "/run", mapOf(
                "source_lot_id", lotId,
                "input_kg", 1,
                "good_packs", 1,
                "rejected_packs", 0
        ), key()), 400); // over target
    }
}
