package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import in.vasavi.vtc.common.Times;
import org.junit.jupiter.api.Test;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Outgoing sales -> credit -> reservation -> dispatch -> invoice -> collection, plus
 * stock counts, exceptions, Tally export (DPR §10–§12).
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_sales_finance.py (6 tests).
 */
class TestSalesFinance extends VtcTestBase {

    int customer(TestClient o, String name) {
        return ok(o.post("/api/v1/masters", mapOf(
                "kind", "customer",
                "name", name,
                "phone", "9000000000",
                "address", "Road 1"
        ))).path("id").asInt();
    }

    int customer(TestClient o) {
        return customer(o, "Sample Café");
    }

    @Test
    void test_credit_order_full_life() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        JsonNode lot = TestProduction.roastedStock(this, o, r, "Robusta", 30)[0]; // 25.2 kg roasted
        int lotId = lot.path("id").asInt();
        int cid = customer(o);
        int oid = ok(m.post("/api/v1/orders", mapOf(
                "customer_id", cid,
                "item", "Roasted Robusta",
                "quantity_kg", 10,
                "form", "ROASTED",
                "credit_requested", true
        ))).path("id").asInt();
        ok(o.put("/api/v1/orders/" + oid + "/price", mapOf("price_per_kg_paise", 50000, "gst_rate_bp", 500)));
        JsonNode res = ok(m.post("/api/v1/orders/" + oid + "/confirm", Map.of()));
        assertEquals("CREDIT_REVIEW", res.path("state").asText());
        assertTrue(res.path("note").asText().contains("No approved credit terms"));
        ok(o.put("/api/v1/customers/" + cid + "/credit", mapOf("credit_limit_paise", 1_000_000, "due_days", 15)));
        ok(m.post("/api/v1/orders/" + oid + "/credit", mapOf("approve", true, "note", "manager self-approve")), 403); // needs the right
        ok(o.post("/api/v1/orders/" + oid + "/credit", mapOf("approve", true, "note", "Good payment history")));
        JsonNode order = findFirst(ok(o.get("/api/v1/orders")), x -> x.path("id").asInt() == oid);
        assertEquals("RESERVED", order.path("state").asText());
        assertEquals(10.0, order.path("reserved_kg").asDouble(), 1e-6);

        // reserved stock can't be used by roasting/grinding/packing
        JsonNode inv = findFirst(ok(o.get("/api/v1/inventory")), x -> x.path("id").asInt() == lotId);
        assertEquals(Math.round((inv.path("kg").asDouble() - 10.0) * 1000.0) / 1000.0, inv.path("available_kg").asDouble(), 1e-6);
        ok(r.post("/api/v1/grinds", mapOf(
                "lot_id", lotId,
                "input_kg", inv.path("kg").asDouble(),
                "output_kg", 1,
                "grind", "Fine"
        ), key()), 400);

        // dispatch via an app needs a real booking reference
        Map<String, Object> body = mapOf("kg", 6, "mode", "RAPIDO", "handover_to", "Rapido rider Suresh");
        ok(r.post("/api/v1/orders/" + oid + "/dispatch", body, key()), 400);
        body.put("booking_ref", "RPD-77812");
        JsonNode d1 = ok(r.post("/api/v1/orders/" + oid + "/dispatch", body, key()));
        assertTrue(d1.path("invoice").asText().startsWith("INV-"));
        assertEquals("RESERVED", d1.path("state").asText()); // partial
        JsonNode d2 = ok(r.post("/api/v1/orders/" + oid + "/dispatch", mapOf(
                "kg", 4,
                "mode", "CUSTOMER_PICKUP",
                "handover_to", "Café owner"
        ), key()));
        assertEquals("DISPATCHED", d2.path("state").asText());

        JsonNode disp = findFirst(ok(o.get("/api/v1/orders")), x -> x.path("id").asInt() == oid).path("dispatches");
        ok(r.post("/api/v1/dispatches/" + disp.get(0).path("id").asInt() + "/deliver",
                mapOf("delivered_kg", 6, "pod_note", "Signed by café")));
        ok(r.post("/api/v1/dispatches/" + disp.get(1).path("id").asInt() + "/deliver",
                mapOf("delivered_kg", 3.5, "pod_note", "One bag torn")));
        assertEquals("DELIVERED", findFirst(ok(o.get("/api/v1/orders")), x -> x.path("id").asInt() == oid).path("state").asText());
        assertTrue(anyMatch(ok(o.get("/api/v1/exceptions")), e -> "UNDELIVERED".equals(e.path("category").asText())));

        // receivables + maker/checker collection
        JsonNode rec = ok(o.get("/api/v1/receivables"));
        JsonNode inv1 = stream(rec.path("invoices"))
                .filter(i -> i.path("order_id").asInt() == oid)
                .min(Comparator.comparingInt(i -> i.path("id").asInt()))
                .orElseThrow();
        int inv1Id = inv1.path("id").asInt();
        assertEquals(315000, inv1.path("total_paise").asInt()); // 6 kg × ₹500 + 5% GST
        ok(m.post("/api/v1/invoices/" + inv1Id + "/collections", mapOf(
                "amount_paise", 315000,
                "method", "UPI",
                "reference", "UPI-55"
        )));
        int kid = ok(o.get("/api/v1/receivables")).path("pending").get(0).path("id").asInt();
        ok(m.post("/api/v1/collections/" + kid + "/verify", Map.of("approve", true)), 403);
        ok(o.post("/api/v1/collections/" + kid + "/verify", Map.of("approve", true)));
        assertEquals("PAID", findFirst(ok(o.get("/api/v1/receivables")).path("invoices"), i -> i.path("id").asInt() == inv1Id)
                .path("status").asText());

        // slip has no prices; staff can't open the tax invoice
        JsonNode slip = ok(r.get("/api/v1/orders/" + oid + "/slip"));
        assertFalse(slip.path("order").has("price_per_kg_paise"));
        ok(r.get("/api/v1/invoices/" + inv1Id), 403);
    }

    @Test
    void test_cash_order_needs_payment_before_dispatch_and_no_double_reservation() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestProduction.roastedStock(this, o, r, "Robusta", 12); // 10.08 kg
        int cid = customer(o, "Dealer");
        int o1 = ok(o.post("/api/v1/orders", mapOf(
                "customer_id", cid,
                "item", "Beans",
                "quantity_kg", 8,
                "form", "ROASTED",
                "price_per_kg_paise", 40000
        ))).path("id").asInt();
        int o2 = ok(o.post("/api/v1/orders", mapOf(
                "customer_id", cid,
                "item", "Beans",
                "quantity_kg", 8,
                "form", "ROASTED",
                "price_per_kg_paise", 40000
        ))).path("id").asInt();
        assertEquals("RESERVED", ok(o.post("/api/v1/orders/" + o1 + "/confirm", Map.of())).path("state").asText());
        assertEquals("CONFIRMED", ok(o.post("/api/v1/orders/" + o2 + "/confirm", Map.of())).path("state").asText()); // only 2.08 kg left: not reserved
        assertTrue(anyMatch(ok(o.get("/api/v1/exceptions")), e -> "STOCK_SHORTAGE".equals(e.path("category").asText())));
        JsonNode e = ok(r.post("/api/v1/orders/" + o1 + "/dispatch", mapOf(
                "kg", 8,
                "mode", "VTC_DELIVERY",
                "handover_to", "Driver"
        ), key()), 400);
        assertEquals("DISPATCH_BLOCKED_PAYMENT", e.path("error").asText());
        ok(o.post("/api/v1/orders/" + o1 + "/advance", mapOf("amount_paise", 320000, "reference", "NEFT-991")));
        ok(r.post("/api/v1/orders/" + o1 + "/dispatch", mapOf(
                "kg", 8,
                "mode", "VTC_DELIVERY",
                "handover_to", "Driver"
        ), key()));
        JsonNode inv = findFirst(ok(o.get("/api/v1/receivables")).path("invoices"), i -> i.path("order_id").asInt() == o1);
        assertEquals("PAID", inv.path("status").asText()); // advance applied
        ok(o.post("/api/v1/orders/" + o2 + "/cancel", Map.of("reason", "Customer changed mind")));
    }

    @Test
    void test_count_difference_needs_second_person_and_limit() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        JsonNode[] stocks = TestProduction.roastedStock(this, o, r, "Robusta", 30);
        JsonNode raw = stocks[1];
        int rawId = raw.path("id").asInt();
        JsonNode k = ok(r.post("/api/v1/lots/" + rawId + "/count", mapOf("counted_kg", 69.5, "note", "Weighed all bags")));
        assertEquals("PENDING", k.path("state").asText());
        assertEquals(-0.5, k.path("variance_kg").asDouble(), 1e-6);
        ok(o.post("/api/v1/admin/users/" + uidOf(o, "Demo Manager") + "/grants", mapOf(
                "perm_key", "stock.cycle_approve",
                "effect", "allow",
                "reason", "Shift supervisor"
        )));
        int countId = k.path("id").asInt();
        assertEquals("ABOVE_YOUR_APPROVAL_LIMIT",
                ok(m.post("/api/v1/counts/" + countId + "/decide", mapOf("approve", true, "note", "Checked again")), 403).path("error").asText());
        ok(o.put("/api/v1/admin/settings", Map.of("correction_manager_cap_kg", 1)));
        ok(m.post("/api/v1/counts/" + countId + "/decide", mapOf("approve", true, "note", "Checked again")));
        assertEquals(69.5, findFirst(ok(o.get("/api/v1/inventory")), x -> x.path("id").asInt() == rawId).path("kg").asDouble(), 1e-6);
    }

    @Test
    void test_receipt_reversal_only_when_unused() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        int pid = ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", "Mistake", "nominal_kg", 10))).path("id").asInt();
        JsonNode rec = ok(r.post("/api/v1/inward", mapOf(
                "source", "OTHER",
                "source_name", "Supplier",
                "product_id", pid,
                "bags", 3,
                "damaged", 0
        ), key()));
        int recId = rec.path("id").asInt();
        ok(r.post("/api/v1/inward/" + recId + "/reverse", Map.of("reason", "Wrong product chosen")), 403);
        ok(o.post("/api/v1/inward/" + recId + "/reverse", Map.of("reason", "Wrong product chosen")));
        assertFalse(anyMatch(ok(o.get("/api/v1/inventory")), x -> x.path("product_id").asInt(-1) == pid));
        JsonNode raw = TestProduction.roastedStock(this, o, r, "Used", 30)[1];
        ok(o.post("/api/v1/inward/" + raw.path("receipt_id").asInt() + "/reverse", Map.of("reason", "Too late")), 400);
    }

    @Test
    void test_tally_export_never_repeats_accepted_vouchers() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int item = TestCounter.setupCounter(this, o, r, m)[0];
        ok(r.post("/api/v1/counter/sales", mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 1)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 80000))
        ), key()));
        ok(m.get("/api/v1/tally/exports"), 403);
        String today = Times.isoDayIst();
        JsonNode e = ok(o.post("/api/v1/tally/exports", mapOf("from", today, "to", today)));
        assertEquals(1, e.path("vouchers").asInt());
        assertTrue(e.path("content").asText().contains("CONTROL_TOTAL"));
        assertEquals(64, e.path("checksum").asText().length());
        assertEquals("NOTHING_NEW_TO_EXPORT",
                ok(o.post("/api/v1/tally/exports", mapOf("from", today, "to", today)), 400).path("error").asText());
        ok(o.post("/api/v1/tally/exports/" + e.path("id").asInt() + "/result",
                mapOf("accepted", false, "note", "Ledger name mismatch")));
        JsonNode e2 = ok(o.post("/api/v1/tally/exports", mapOf("from", today, "to", today))); // rejected -> can export again
        ok(o.post("/api/v1/tally/exports/" + e2.path("id").asInt() + "/result",
                mapOf("accepted", true, "note", "Imported fine")));
        assertEquals("NOTHING_NEW_TO_EXPORT",
                ok(o.post("/api/v1/tally/exports", mapOf("from", today, "to", today)), 400).path("error").asText());
    }

    @Test
    void test_reports_split_operational_and_commercial() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        TestClient r = p.get("roaster");
        JsonNode rep = ok(m.get("/api/v1/reports"));
        assertTrue(rep.has("roasting"));
        assertFalse(rep.has("counter"));
        assertTrue(ok(o.get("/api/v1/reports")).has("counter"));
        ok(r.get("/api/v1/reports"), 403);
        JsonNode customers = ok(r.get("/api/v1/masters?kind=customer"));
        if (customers.size() > 0) {
            assertFalse(customers.get(0).has("phone"));
        }
    }
}
