package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Business rules ported from pilot v0.1 (O-02, O-05, O-13, idempotency).
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_operations.py (7 tests).
 */
class TestOperations extends VtcTestBase {

    int product(TestClient o, String name, double kg) {
        return ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", name, "nominal_kg", kg))).path("id").asInt();
    }

    @Test
    void test_dashboard_is_personal_and_permission_filtered() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        JsonNode me = ok(r.get("/api/v1/me"));
        assertFalse(anyMatch(me.path("available_widgets"), w -> "pending_invoices".equals(w.path("id").asText())));
        ok(r.put("/api/v1/me/preferences", mapOf(
                "widgets", List.of("my_tasks", "quick_actions"),
                "shortcuts", List.of("roasting"),
                "welcome", "My station",
                "lang", "te",
                "large_text", true
        )));
        assertEquals("My station", ok(r.get("/api/v1/me")).path("prefs").path("welcome").asText());
        assertNotEquals("My station", ok(o.get("/api/v1/me")).path("prefs").path("welcome").asText());
        ok(r.put("/api/v1/me/preferences", mapOf(
                "widgets", List.of("pending_invoices"),
                "shortcuts", List.of()
        )), 400);
        ok(r.get("/api/v1/payables"), 403);
        assertFalse(ok(r.get("/api/v1/summary")).has("pending_invoices"));
    }

    @Test
    void test_receipt_quarantine_roasting_qc_and_idempotency() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        int pid = product(o, "Real Test Robusta", 50);
        Map<String, String> k = key();
        Map<String, Object> body = mapOf(
                "source", "AUCTION",
                "source_name", "Test auction",
                "product_id", pid,
                "bags", 3,
                "damaged", 1
        );
        JsonNode res = ok(r.post("/api/v1/inward", body, k));
        assertEquals(150.0, res.path("nominal_kg").asDouble(), 1e-6);
        assertEquals(100.0, res.path("allocatable_kg").asDouble(), 1e-6);
        assertEquals(50.0, res.path("quarantine_kg").asDouble(), 1e-6);
        assertEquals(res.path("id").asInt(), ok(r.post("/api/v1/inward", body, k)).path("id").asInt());
        assertEquals(1, ok(r.get("/api/v1/inward")).size());

        JsonNode inv = ok(r.get("/api/v1/inventory"));
        JsonNode sound = findFirst(inv, x -> "RELEASED".equals(x.path("status").asText()));
        JsonNode damaged = findFirst(inv, x -> "QUARANTINE".equals(x.path("status").asText()));
        assertEquals(100.0, sound.path("kg").asDouble(), 1e-6);
        assertEquals(50.0, damaged.path("kg").asDouble(), 1e-6);

        Map<String, Object> b = mapOf(
                "inputs", List.of(mapOf("lot_id", damaged.path("id").asInt(), "kg", 10)),
                "output_kg", 9,
                "duration_min", 13
        );
        ok(r.post("/api/v1/roasts", b, key()), 400);

        b.put("inputs", List.of(mapOf("lot_id", sound.path("id").asInt(), "kg", 10)));
        JsonNode rr = ok(r.post("/api/v1/roasts", b, key()));
        assertEquals("QC_HOLD", rr.path("qc_status").asText());
        assertEquals(10.0, rr.path("loss_pct").asDouble(), 1e-6);

        int roastId = rr.path("id").asInt();
        ok(r.post("/api/v1/qc/" + roastId + "/decision", mapOf("decision", "RELEASED", "note", "Approved batch")), 403);
        ok(p.get("manager").post("/api/v1/qc/" + roastId + "/decision", mapOf("decision", "RELEASED", "note", "Approved batch")), 403);
        ok(o.post("/api/v1/qc/" + roastId + "/decision", mapOf("decision", "RELEASED", "note", "Approved batch")));
        ok(o.post("/api/v1/qc/" + roastId + "/decision", mapOf("decision", "RELEASED", "note", "Approved batch")), 400);
        assertTrue(anyMatch(ok(o.get("/api/v1/inventory")),
                x -> "RELEASED".equals(x.path("status").asText()) && "ROASTED".equals(x.path("stage").asText())));
    }

    @Test
    void test_manager_master_draft_needs_admin_approval() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        TestClient o = p.get("owner");
        JsonNode d = ok(m.post("/api/v1/masters", mapOf("kind", "product", "name", "Test Arabica", "nominal_kg", 25)));
        assertEquals("DRAFT", d.path("state").asText());
        int did = d.path("id").asInt();
        assertFalse(anyMatch(ok(r.get("/api/v1/masters?kind=product")), x -> x.path("id").asInt() == did));
        ok(m.post("/api/v1/masters/" + did + "/approve", Map.of()), 403);
        ok(o.post("/api/v1/masters/" + did + "/approve", Map.of()));
        assertTrue(anyMatch(ok(r.get("/api/v1/masters?kind=product")), x -> x.path("id").asInt() == did));
    }

    @Test
    void test_finance_split_permissions() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        TestClient a = p.get("admin");
        int pid = product(o, "Test chicory", 20);
        JsonNode rec = ok(r.post("/api/v1/inward", mapOf(
                "source", "OTHER",
                "source_name", "Supplier test",
                "product_id", pid,
                "bags", 2,
                "damaged", 0
        ), key()));
        int recId = rec.path("id").asInt();
        ok(o.put("/api/v1/inward/" + recId + "/finance", Map.of("payment_status", "PAID")), 400); // payments go through approval
        ok(o.put("/api/v1/inward/" + recId + "/finance", mapOf(
                "invoice_ref", "INV-9",
                "invoice_status", "MATCHED",
                "invoice_amount_paise", 500000
        )));
        int pay = ok(o.post("/api/v1/receipts/" + recId + "/payments", mapOf(
                "amount_paise", 500000,
                "paid_on", "2026-10-20",
                "reference", "NEFT-1"
        ))).path("id").asInt();
        ok(o.post("/api/v1/supplier-payments/" + pay + "/decide", Map.of("approve", true)), 403); // not your own
        ok(a.post("/api/v1/supplier-payments/" + pay + "/decide", Map.of("approve", true)));
        JsonNode row = findFirst(ok(o.get("/api/v1/payables")).path("receipts"), x -> x.path("id").asInt() == recId);
        assertEquals("PAID", row.path("payment_status").asText());
        assertEquals(500000, row.path("paid_paise").asInt());
        JsonNode raw = ok(r.get("/api/v1/inward")).get(0);
        assertFalse(raw.has("invoice_ref"));
        assertFalse(raw.has("payment_date"));
        assertFalse(raw.has("invoice_amount_paise"));
    }

    @Test
    void test_qc_range_is_not_assumed() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        int pid = product(o, "Test peaberry", 30);
        ok(r.post("/api/v1/inward", mapOf(
                "source", "OTHER",
                "source_name", "Test supplier",
                "product_id", pid,
                "bags", 3,
                "damaged", 0
        ), key()));
        JsonNode lot = findFirst(ok(r.get("/api/v1/inventory")), x -> "RELEASED".equals(x.path("status").asText()));
        Map<String, Object> b = mapOf(
                "inputs", List.of(mapOf("lot_id", lot.path("id").asInt(), "kg", 10)),
                "output_kg", 8.5,
                "duration_min", 20
        );
        assertEquals("QC_HOLD", ok(r.post("/api/v1/roasts", b, key())).path("qc_status").asText());
        ok(o.put("/api/v1/qc/config", mapOf("min_pct", 10, "max_pct", 20, "checks_approved", false)));
        assertEquals("QC_HOLD", ok(r.post("/api/v1/roasts", b, key())).path("qc_status").asText());
        ok(o.put("/api/v1/qc/config", mapOf("min_pct", 10, "max_pct", 20, "checks_approved", true)));
        assertEquals("RELEASED", ok(r.post("/api/v1/roasts", b, key())).path("qc_status").asText());
        b.put("abnormal", true);
        assertEquals("QC_HOLD", ok(r.post("/api/v1/roasts", b, key())).path("qc_status").asText());
    }

    @Test
    void test_quarantined_bags_need_authorised_verification() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        int pid = product(o, "Test chicory 2", 20);
        ok(r.post("/api/v1/inward", mapOf(
                "source", "OTHER",
                "source_name", "Test supplier",
                "product_id", pid,
                "bags", 2,
                "damaged", 1
        ), key()));
        JsonNode lot = findFirst(ok(o.get("/api/v1/inventory")), x -> "QUARANTINE".equals(x.path("status").asText()));
        int lotId = lot.path("id").asInt();
        ok(r.post("/api/v1/lots/" + lotId + "/verify", mapOf("verified_kg", 14, "reason", "Physically verified")), 403);
        ok(o.post("/api/v1/lots/" + lotId + "/verify", mapOf("verified_kg", 14, "reason", "Physically verified usable")));
        JsonNode row = findFirst(ok(o.get("/api/v1/inventory")), x -> x.path("id").asInt() == lotId);
        assertEquals("RELEASED", row.path("status").asText());
        assertEquals(14.0, row.path("kg").asDouble(), 1e-6);
        ok(o.post("/api/v1/lots/" + lotId + "/verify", mapOf("verified_kg", 14, "reason", "Repeat attempted")), 400);
    }

    @Test
    void test_orders_follow_permissions() {
        Map<String, TestClient> p = people();
        TestClient r = p.get("roaster");
        TestClient o = p.get("owner");
        int cid = ok(o.post("/api/v1/masters", mapOf("kind", "customer", "name", "Test Cafe"))).path("id").asInt();
        int oid = ok(r.post("/api/v1/orders", mapOf(
                "customer_id", cid,
                "item", "Roasted beans",
                "quantity_kg", 5,
                "credit_requested", true
        ))).path("id").asInt();
        ok(r.post("/api/v1/orders", mapOf(
                "customer_id", cid,
                "item", "Beans",
                "quantity_kg", 5,
                "price_per_kg_paise", 50000
        )), 403); // staff can't price
        assertEquals("PRICE_NOT_SET", ok(r.post("/api/v1/orders/" + oid + "/confirm", Map.of()), 400).path("error").asText());
        JsonNode order = findFirst(ok(r.get("/api/v1/orders")), x -> x.path("id").asInt() == oid);
        assertEquals("DRAFT", order.path("state").asText());
        assertFalse(order.has("price_per_kg_paise"));
    }
}
