package in.vasavi.vtc.common;

import in.vasavi.vtc.db.Db;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;

@Service
public class StockwatchService {

    private final Db db;
    private final AlertsService alertsService;

    public StockwatchService(Db db, AlertsService alertsService) {
        this.db = db;
        this.alertsService = alertsService;
    }

    public Map<Long, Double> used30() {
        String since = Times.stamp(Times.now().minus(Duration.ofDays(30)));
        List<Map<String, Object>> rows = db.rows(
                "SELECT COALESCE(l.bean_id, l.product_id) f, -SUM(m.delta_kg) used_kg " +
                "FROM movements m JOIN lots l ON l.id=m.lot_id " +
                "WHERE l.owner='VTC' AND COALESCE(l.bean_id, l.product_id) IS NOT NULL AND m.created_at>=? " +
                "AND m.action NOT IN ('RECEIVED_PROVISIONAL', 'RECEIVED_WEIGHED', 'QUARANTINE_VERIFICATION_ADJUSTMENT', 'COUNT_CORRECTION', 'RECEIPT_REVERSED') " +
                "GROUP BY COALESCE(l.bean_id, l.product_id)", since
        );
        Map<Long, Double> map = new HashMap<>();
        for (Map<String, Object> r : rows) {
            long fid = ((Number) r.get("f")).longValue();
            double kg = r.get("used_kg") instanceof Number n ? n.doubleValue() : 0.0;
            map.put(fid, ValidationUtils.r3(Math.max(kg, 0.0)));
        }
        return map;
    }

    public Map<Long, Double> usable() {
        List<Map<String, Object>> rows = db.rows(
                "SELECT COALESCE(l.bean_id, l.product_id) f, SUM(m.delta_kg) have_kg " +
                "FROM lots l JOIN movements m ON m.lot_id=l.id " +
                "WHERE l.status='RELEASED' AND l.owner='VTC' AND COALESCE(l.bean_id, l.product_id) IS NOT NULL " +
                "GROUP BY COALESCE(l.bean_id, l.product_id)"
        );
        Map<Long, Double> have = new HashMap<>();
        for (Map<String, Object> r : rows) {
            long fid = ((Number) r.get("f")).longValue();
            double kg = r.get("have_kg") instanceof Number n ? n.doubleValue() : 0.0;
            have.put(fid, kg);
        }

        List<Map<String, Object>> resRows = db.rows(
                "SELECT COALESCE(l.bean_id, l.product_id) f, SUM(r.kg) res_kg " +
                "FROM reservations r JOIN lots l ON l.id=r.lot_id " +
                "WHERE r.state='ACTIVE' AND l.status='RELEASED' AND l.owner='VTC' AND COALESCE(l.bean_id, l.product_id) IS NOT NULL " +
                "GROUP BY COALESCE(l.bean_id, l.product_id)"
        );
        for (Map<String, Object> r : resRows) {
            long fid = ((Number) r.get("f")).longValue();
            double resKg = r.get("res_kg") instanceof Number n ? n.doubleValue() : 0.0;
            have.put(fid, have.getOrDefault(fid, 0.0) - resKg);
        }

        Map<Long, Double> out = new HashMap<>();
        for (Map.Entry<Long, Double> entry : have.entrySet()) {
            out.put(entry.getKey(), ValidationUtils.r3(entry.getValue()));
        }
        return out;
    }

    public Integer daysLeft(double kg, double used) {
        if (used < 0.05) return null;
        return (int) (kg / (used / 30.0));
    }

    public void watch() {
        List<Map<String, Object>> cards = db.rows(
                "SELECT s.product_id, s.low_kg, s.low_alerted, COALESCE(NULLIF(s.label,''), m.name) name " +
                "FROM stock_cards s JOIN masters m ON m.id=s.product_id " +
                "WHERE s.low_kg IS NOT NULL AND s.hidden=0"
        );
        if (cards.isEmpty()) return;

        Map<Long, Double> have = usable();
        Map<Long, Double> used = null;

        for (Map<String, Object> card : cards) {
            long pid = ((Number) card.get("product_id")).longValue();
            double lowKg = ((Number) card.get("low_kg")).doubleValue();
            int lowAlerted = card.get("low_alerted") != null ? ((Number) card.get("low_alerted")).intValue() : 0;
            String name = (String) card.get("name");
            double kg = have.getOrDefault(pid, 0.0);
            boolean below = kg < lowKg;

            if (below && lowAlerted == 0) {
                if (used == null) used = used30();
                double uKg = used.getOrDefault(pid, 0.0);
                Integer d = daysLeft(kg, uKg);
                String kgStr = (kg == Math.floor(kg)) ? String.valueOf((long) kg) : String.valueOf(kg);
                String lowKgStr = (lowKg == Math.floor(lowKg)) ? String.valueOf((long) lowKg) : String.valueOf(lowKg);
                String title = "Low stock: " + name + " \u2014 " + kgStr + " kg left";
                String body = "Below the " + lowKgStr + " kg level." + (d != null ? " About " + d + " days left at the last 30 days' pace." : "");
                alertsService.notifyPerm("exceptions.view", "high", title, body, "inventory", "product", pid, null, null);
            }

            if (below != (lowAlerted == 1)) {
                db.exec("UPDATE stock_cards SET low_alerted=? WHERE product_id=?", below ? 1 : 0, pid);
            }
        }
    }
}
