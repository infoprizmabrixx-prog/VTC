package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Counter Sales (DPR §9) and transfers to the counter.
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_counter.py (6 tests).
 */
class TestCounter extends VtcTestBase {

    public static int[] setupCounter(VtcTestBase base, TestClient o, TestClient r, TestClient m) {
        int chic = base.ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", "Chicory", "nominal_kg", 25))).path("id").asInt();
        int rob = base.ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", "Robusta", "nominal_kg", 50))).path("id").asInt();
        base.ok(r.post("/api/v1/inward", mapOf("source", "OTHER", "source_name", "Supplier", "product_id", chic, "bags", 1, "damaged", 0), key()));
        base.ok(r.post("/api/v1/inward", mapOf("source", "OTHER", "source_name", "Supplier", "product_id", rob, "bags", 1, "damaged", 0), key()));
        JsonNode raw = findFirst(base.ok(r.get("/api/v1/inventory")), x -> x.path("product_id").asInt(-1) == rob);
        JsonNode roast = base.ok(r.post("/api/v1/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", raw.path("id").asInt(), "kg", 20)),
                "output_kg", 17,
                "duration_min", 15
        ), key()));
        base.ok(o.post("/api/v1/qc/" + roast.path("id").asInt() + "/decision", mapOf("decision", "RELEASED", "note", "Checked colour")));
        JsonNode inv = base.ok(r.get("/api/v1/inventory"));
        JsonNode roasted = findFirst(inv, x -> "ROASTED".equals(x.path("stage").asText()));
        JsonNode chicLot = findFirst(inv, x -> x.path("product_id").asInt(-1) == chic);
        int t1 = base.ok(r.post("/api/v1/transfers", mapOf("lot_id", roasted.path("id").asInt(), "kg", 10), key())).path("id").asInt();
        int t2 = base.ok(r.post("/api/v1/transfers", mapOf("lot_id", chicLot.path("id").asInt(), "kg", 5), key())).path("id").asInt();
        base.ok(m.post("/api/v1/transfers/" + t1 + "/receive", Map.of("kg_received", 10)));
        base.ok(m.post("/api/v1/transfers/" + t2 + "/receive", Map.of("kg_received", 5)));
        int item = base.ok(o.post("/api/v1/counter/items", mapOf(
                "name", "Filter coffee 70/30",
                "kind", "coffee_beans",
                "coffee_pct", 70,
                "chicory_product_id", chic,
                "price_per_kg_paise", 80000
        ))).path("id").asInt();
        return new int[]{item, chic};
    }

    int[] setupCounter(TestClient o, TestClient r, TestClient m) {
        return setupCounter(this, o, r, m);
    }

    @Test
    void test_transfer_shortage_is_recorded_not_hidden() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int pid = ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", "Tea dust", "nominal_kg", 20))).path("id").asInt();
        ok(r.post("/api/v1/inward", mapOf("source", "OTHER", "source_name", "Supplier", "product_id", pid, "bags", 1, "damaged", 0), key()));
        JsonNode lot = findFirst(ok(r.get("/api/v1/inventory")), x -> x.path("product_id").asInt(-1) == pid);
        int lotId = lot.path("id").asInt();
        int tid = ok(r.post("/api/v1/transfers", mapOf("lot_id", lotId, "kg", 8), key())).path("id").asInt();
        ok(r.post("/api/v1/transfers/" + tid + "/receive", Map.of("kg_received", 8)), 400); // sender can't confirm own transfer
        ok(m.post("/api/v1/transfers/" + tid + "/receive", Map.of("kg_received", 9)), 400); // can't receive more than sent
        JsonNode res = ok(m.post("/api/v1/transfers/" + tid + "/receive", Map.of("kg_received", 7.5)));
        assertEquals("SHORTAGE", res.path("state").asText());
        assertEquals(0.5, res.path("shortage_kg").asDouble(), 1e-6);
        JsonNode inv = ok(o.get("/api/v1/inventory"));
        assertEquals(12.0, findFirst(inv, x -> x.path("id").asInt() == lotId).path("kg").asDouble(), 1e-6);
        double ctrKg = stream(inv)
                .filter(x -> x.path("product_id").asInt(-1) == pid && "CTR-01".equals(x.path("location").asText()))
                .mapToDouble(x -> x.path("kg").asDouble())
                .sum();
        assertEquals(7.5, ctrKg, 1e-6);
        assertTrue(anyMatch(ok(o.get("/api/v1/alerts")), a -> a.path("title").asText().contains("short")));
    }

    @Test
    void test_sale_deducts_coffee_and_chicory_and_blocks_oversell() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int[] sc = setupCounter(o, r, m);
        int item = sc[0];
        int chic = sc[1];
        Map<String, String> k = key();
        Map<String, Object> sale = mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 1)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 80000))
        );
        JsonNode bill = ok(r.post("/api/v1/counter/sales", sale, k));
        assertTrue(bill.path("bill_no").asText().startsWith("CTR-"));
        assertEquals(80000, bill.path("total_paise").asInt());
        assertEquals(bill.path("id").asInt(), ok(r.post("/api/v1/counter/sales", sale, k)).path("id").asInt()); // retry = same bill
        JsonNode inv = ok(o.get("/api/v1/inventory"));
        double roastedCtr = stream(inv)
                .filter(x -> "CTR-01".equals(x.path("location").asText()) && "ROASTED".equals(x.path("stage").asText()))
                .mapToDouble(x -> x.path("kg").asDouble())
                .sum();
        double chicCtr = stream(inv)
                .filter(x -> "CTR-01".equals(x.path("location").asText()) && x.path("product_id").asInt(-1) == chic)
                .mapToDouble(x -> x.path("kg").asDouble())
                .sum();
        assertEquals(9.3, Math.round(roastedCtr * 1000.0) / 1000.0, 1e-6); // 10 - 0.7
        assertEquals(4.7, Math.round(chicCtr * 1000.0) / 1000.0, 1e-6);    // 5 - 0.3
        // pay less than total -> refused
        ok(r.post("/api/v1/counter/sales", mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 0.5)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 30000))
        ), key()), 400);
        // more chicory than the counter holds -> refused, nothing posted
        JsonNode e = ok(r.post("/api/v1/counter/sales", mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 20)),
                "payments", List.of(mapOf("method", "UPI", "amount_paise", 1600000))
        ), key()), 400);
        assertEquals("NOT_ENOUGH_AT_COUNTER", e.path("error").asText());
        assertEquals(1, ok(r.get("/api/v1/counter/sales")).path("totals").path("bills").asInt());
        // split payment
        ok(r.post("/api/v1/counter/sales", mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 0.25)),
                "payments", List.of(
                        mapOf("method", "CASH", "amount_paise", 10000),
                        mapOf("method", "UPI", "amount_paise", 10000, "reference", "UPI-123")
                )
        ), key()));
    }

    @Test
    void test_discount_needs_right_cap_and_reason() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int item = setupCounter(o, r, m)[0];
        Map<String, Object> sale = mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 1)),
                "discount_paise", 4000,
                "discount_reason", "Regular customer",
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 76000))
        );
        ok(r.post("/api/v1/counter/sales", sale, key()), 403); // staff lack discount right
        assertEquals("DISCOUNTS_NOT_SET_UP", ok(o.post("/api/v1/counter/sales", sale, key()), 400).path("error").asText());
        ok(o.put("/api/v1/admin/settings", Map.of("discount_cap_pct", 5)));
        ok(o.post("/api/v1/counter/sales", sale, key()));
        sale.put("discount_paise", 8000);
        sale.put("payments", List.of(mapOf("method", "CASH", "amount_paise", 72000))); // 10% > 5% cap
        assertEquals("DISCOUNT_ABOVE_CAP", ok(o.post("/api/v1/counter/sales", sale, key()), 400).path("error").asText());
    }

    @Test
    void test_refund_maker_checker_and_manager_limit() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int item = setupCounter(o, r, m)[0];
        JsonNode bill = ok(r.post("/api/v1/counter/sales", mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 1)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 80000))
        ), key()));
        int billId = bill.path("id").asInt();
        int rid = ok(r.post("/api/v1/counter/sales/" + billId + "/refunds", mapOf(
                "amount_paise", 20000,
                "reason", "Wrong grind given"
        ))).path("id").asInt();
        ok(r.post("/api/v1/counter/sales/" + billId + "/refunds", mapOf("amount_paise", 70000, "reason", "Too much")), 400);
        // give the manager refund rights; no limit set yet -> cannot approve
        ok(o.post("/api/v1/admin/users/" + uidOf(o, "Demo Manager") + "/grants", mapOf(
                "perm_key", "counter.refund",
                "effect", "allow",
                "reason", "Handles counter refunds"
        )));
        assertEquals("ABOVE_YOUR_APPROVAL_LIMIT",
                ok(m.post("/api/v1/counter/refunds/" + rid + "/decide", Map.of("approve", true)), 403).path("error").asText());
        ok(o.put("/api/v1/admin/settings", Map.of("refund_manager_cap_paise", 50000)));
        ok(m.post("/api/v1/counter/refunds/" + rid + "/decide", Map.of("approve", true)));
        assertEquals("PART_REFUNDED", ok(o.get("/api/v1/counter/sales/" + billId)).path("status").asText());
        // owner can't approve a refund the owner asked for
        int rid2 = ok(o.post("/api/v1/counter/sales/" + billId + "/refunds", mapOf("amount_paise", 1000, "reason", "Owner test")))
                .path("id").asInt();
        assertEquals("CANNOT_APPROVE_OWN_REQUEST",
                ok(o.post("/api/v1/counter/refunds/" + rid2 + "/decide", Map.of("approve", true)), 403).path("error").asText());
    }

    @Test
    void test_cash_close_variance_needs_second_person() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");
        int item = setupCounter(o, r, m)[0];
        ok(r.post("/api/v1/counter/sales", mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 1)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 80000))
        ), key()));
        assertEquals("OPENING_CASH_NOT_SET",
                ok(r.post("/api/v1/counter/cash-close", Map.of("counted_paise", 80000)), 400).path("error").asText());
        ok(o.put("/api/v1/admin/settings", Map.of("counter_opening_float_paise", 200000)));
        assertEquals(280000, ok(r.get("/api/v1/counter/cash-close")).path("today").path("expected_paise").asInt());
        ok(r.post("/api/v1/counter/cash-close", Map.of("counted_paise", 279000)), 400); // must explain a difference
        JsonNode k = ok(r.post("/api/v1/counter/cash-close", mapOf("counted_paise", 279000, "note", "₹10 coin short")));
        assertEquals("VARIANCE_REVIEW", k.path("state").asText());
        assertEquals(-1000, k.path("difference_paise").asInt());
        ok(r.post("/api/v1/counter/cash-close", Map.of("counted_paise", 280000)), 400); // one close per day
        ok(o.post("/api/v1/counter/cash-close/" + k.path("id").asInt() + "/decide",
                mapOf("approve", true, "note", "Accepted, coin found later")));
    }

    @Test
    void test_price_list_is_admin_only_and_versioned() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient m = p.get("manager");
        int pid = ok(o.post("/api/v1/masters", mapOf("kind", "product", "name", "Assam CTC", "nominal_kg", 25))).path("id").asInt();
        ok(m.post("/api/v1/counter/items", mapOf(
                "name", "Tea",
                "kind", "product",
                "stock_product_id", pid,
                "price_per_kg_paise", 50000
        )), 403);
        ok(o.post("/api/v1/counter/items", mapOf(
                "name", "Tea",
                "kind", "product",
                "price_per_kg_paise", 50000
        )), 400); // needs stock mapping
        int iid = ok(o.post("/api/v1/counter/items", mapOf(
                "name", "Tea",
                "kind", "product",
                "stock_product_id", pid,
                "price_per_kg_paise", 50000
        ))).path("id").asInt();
        ok(o.put("/api/v1/counter/items/" + iid, Map.of("price_per_kg_paise", 52000)));
        JsonNode item = findFirst(ok(o.get("/api/v1/counter/setup")).path("items"), i -> i.path("id").asInt() == iid);
        assertEquals(2, item.path("version").asInt());
        assertEquals(52000, item.path("price_per_kg_paise").asInt());
    }
}
