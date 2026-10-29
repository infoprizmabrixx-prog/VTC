package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Layer 5 Concurrency tests (09_TESTING_AND_PARITY.md §5):
 * Parallel counter sales on the last kg — exactly one succeeds, one returns 400 NOT_ENOUGH_AT_COUNTER,
 * balance is 0.000 kg.
 */
class TestConcurrency extends VtcTestBase {

    @Test
    void test_parallel_counter_sales_on_last_kg() throws Exception {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient r = p.get("roaster");
        TestClient m = p.get("manager");

        // Create 1.000 kg of ground coffee at the counter
        int rob = ok(o.post(A + "/masters", mapOf("kind", "product", "name", "Robusta Concurrency", "nominal_kg", 50))).path("id").asInt();
        ok(r.post(A + "/inward", mapOf("source", "OTHER", "source_name", "Supplier", "product_id", rob, "bags", 1, "damaged", 0), key()));
        JsonNode raw = findFirst(ok(r.get(A + "/inventory")), x -> x.path("product_id").asInt(-1) == rob);
        JsonNode roast = ok(r.post(A + "/roasts", mapOf(
                "inputs", List.of(mapOf("lot_id", raw.path("id").asInt(), "kg", 10)),
                "output_kg", 8.5,
                "duration_min", 15
        ), key()));
        ok(o.post(A + "/qc/" + roast.path("id").asInt() + "/decision", mapOf("decision", "RELEASED", "note", "OK")));
        JsonNode roasted = findFirst(ok(r.get(A + "/inventory")), x -> "ROASTED".equals(x.path("stage").asText()));
        ok(r.post(A + "/grinds", mapOf("lot_id", roasted.path("id").asInt(), "input_kg", 2, "output_kg", 2, "grind", "Filter"), key()));
        JsonNode ground = findFirst(ok(r.get(A + "/inventory")), x -> "GROUND".equals(x.path("stage").asText()));
        int tid = ok(r.post(A + "/transfers", mapOf("lot_id", ground.path("id").asInt(), "kg", 1.0), key())).path("id").asInt();
        ok(m.post(A + "/transfers/" + tid + "/receive", Map.of("kg_received", 1.0)));

        int item = ok(o.post(A + "/counter/items", mapOf(
                "name", "Pure Ground 100",
                "kind", "coffee_ground",
                "coffee_pct", 100,
                "price_per_kg_paise", 80000
        ))).path("id").asInt();

        TestClient c1 = login("roaster");
        TestClient c2 = login("manager");
        Map<String, Object> saleBody = mapOf(
                "lines", List.of(mapOf("item_id", item, "weight_kg", 1.0)),
                "payments", List.of(mapOf("method", "CASH", "amount_paise", 80000))
        );

        CyclicBarrier barrier = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Callable<TestResponse> task1 = () -> {
                barrier.await();
                return c1.post(A + "/counter/sales", saleBody, key());
            };
            Callable<TestResponse> task2 = () -> {
                barrier.await();
                return c2.post(A + "/counter/sales", saleBody, key());
            };
            List<Future<TestResponse>> futures = List.of(pool.submit(task1), pool.submit(task2));
            List<TestResponse> responses = new ArrayList<>();
            for (Future<TestResponse> f : futures) {
                responses.add(f.get());
            }

            long okCount = responses.stream().filter(res -> res.statusCode() == 200).count();
            long failCount = responses.stream().filter(res -> res.statusCode() == 400).count();
            assertEquals(1, okCount, "Expected exactly one 200 response");
            assertEquals(1, failCount, "Expected exactly one 400 response");

            TestResponse failed = responses.stream().filter(res -> res.statusCode() == 400).findFirst().orElseThrow();
            assertEquals("NOT_ENOUGH_AT_COUNTER", failed.json().path("error").asText());

            double ctrGroundKg = stream(ok(o.get(A + "/inventory")))
                    .filter(x -> "CTR-01".equals(x.path("location").asText()) && "GROUND".equals(x.path("stage").asText()))
                    .mapToDouble(x -> x.path("kg").asDouble())
                    .sum();
            assertEquals(0.0, ctrGroundKg, 1e-6);
            assertEquals(1, ok(r.get(A + "/counter/sales")).path("totals").path("bills").asInt());
        } finally {
            pool.shutdownNow();
        }
    }
}
