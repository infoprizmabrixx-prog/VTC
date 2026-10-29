package in.vasavi.vtc.common;

import in.vasavi.vtc.db.Db;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;

@Service
public class LedgerService {

    public static final String PROD = "PROD-01";
    public static final String COUNTER = "CTR-01";
    public static final String TRANSIT = "IN_TRANSIT";
    public static final double EPS = 1e-6;

    private final Db db;
    private final CodesService codes;
    private final StockwatchService stockwatch;

    public LedgerService(Db db, CodesService codes, StockwatchService stockwatch) {
        this.db = db;
        this.codes = codes;
        this.stockwatch = stockwatch;
    }

    public static double r3(double x) {
        return ValidationUtils.r3(x);
    }

    public double balance(long lotId) {
        Double v = db.val(Double.class, "SELECT COALESCE(SUM(delta_kg),0) FROM movements WHERE lot_id=? FOR UPDATE", lotId);
        return r3(v != null ? v : 0.0);
    }

    public double reserved(long lotId) {
        Double v = db.val(Double.class, "SELECT COALESCE(SUM(kg),0) FROM reservations WHERE lot_id=? AND state='ACTIVE' FOR UPDATE", lotId);
        return r3(v != null ? v : 0.0);
    }

    public double available(long lotId) {
        return r3(balance(lotId) - reserved(lotId));
    }

    public Map<String, Object> lot(long lotId) {
        Map<String, Object> row = db.one("SELECT * FROM lots WHERE id=?", lotId);
        if (row == null) throw new ApiException("LOT_NOT_FOUND", 404);
        return row;
    }

    public long move(long lotId, double deltaKg, String action, Object sourceId, long actorId) {
        long mid = db.insert(
                "INSERT INTO movements(lot_id, delta_kg, action, source_id, actor_id, created_at) VALUES(?,?,?,?,?,?)",
                lotId, r3(deltaKg), action, sourceId, actorId, Times.stamp()
        );
        stockwatch.watch();
        return mid;
    }

    public Map<String, Object> consume(long lotId, double kg, String action, Object sourceId, long actorId,
                                      Set<String> stage, String location, String owner, Long allowReservedFor) {
        Map<String, Object> row = lot(lotId);
        String lotStatus = (String) row.get("status");
        String lotOwner = (String) row.get("owner");
        String requiredOwner = owner != null ? owner : "VTC";

        if (!"RELEASED".equals(lotStatus) || !requiredOwner.equals(lotOwner)) {
            throw new ApiException("LOT_NOT_ALLOCATABLE");
        }
        if (stage != null && !stage.isEmpty() && !stage.contains(row.get("stage"))) {
            throw new ApiException("LOT_WRONG_STAGE");
        }
        if (location != null && !location.equals(row.get("location"))) {
            throw new ApiException("LOT_WRONG_LOCATION");
        }

        double free = available(lotId);
        if (allowReservedFor != null) {
            double extra = db.queryForDouble("SELECT COALESCE(SUM(kg),0) FROM reservations WHERE lot_id=? AND order_id=? AND state='ACTIVE'", lotId, allowReservedFor);
            free = r3(free + extra);
        }
        if (free + EPS < kg) {
            throw new ApiException("INSUFFICIENT_STOCK");
        }
        move(lotId, -kg, action, sourceId, actorId);
        return row;
    }

    public Map<String, Object> consume(long lotId, double kg, String action, Object sourceId, long actorId, Set<String> stage, String location) {
        return consume(lotId, kg, action, sourceId, actorId, stage, location, "VTC", null);
    }

    public Map<String, Object> consume(long lotId, double kg, String action, Object sourceId, long actorId, Set<String> stage, String location, String owner) {
        return consume(lotId, kg, action, sourceId, actorId, stage, location, owner, null);
    }

    public long newLot(String name, String stage, String status, String owner, String location,
                       Long productId, Long receiptId, Long roastId, Long customerId,
                       Double packG, String form, Long beanId, String code, String roastedOn) {
        String loc = location != null ? location : PROD;
        String own = owner != null ? owner : "VTC";
        String finalCode = code != null ? code : codes.lotCode(stage, productId, beanId, own, null);
        return db.insert(
                "INSERT INTO lots(product_id, name, stage, owner, status, receipt_id, roast_id, created_at, " +
                        "location, customer_id, pack_g, form, bean_id, code, roasted_on) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                productId, name, stage, own, status, receiptId, roastId, Times.stamp(),
                loc, customerId, packG, form != null ? form : stage, beanId, finalCode, roastedOn
        );
    }

    public long newLot(String name, String stage, String status, String owner, Long productId, String location,
                       Long customerId, Long receiptId, Long roastId, Double packG, Long beanId, String prefix, String roastedOn) {
        String loc = location != null ? location : PROD;
        String own = owner != null ? owner : "VTC";
        Long effectiveBean = beanId != null ? beanId : productId;
        String finalCode = codes.lotCode(stage, productId, effectiveBean, own, prefix);
        return db.insert(
                "INSERT INTO lots(product_id, name, stage, owner, status, receipt_id, roast_id, created_at, " +
                        "location, customer_id, pack_g, form, bean_id, code, roasted_on) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                productId, name, stage, own, status, receiptId, roastId, Times.stamp(),
                loc, customerId, packG, stage, beanId, finalCode, roastedOn
        );
    }

    public List<Map<String, Object>> stockRows(String whereSql, Object... args) {
        return stockRows(false, whereSql, args);
    }

    public List<Map<String, Object>> stockRows(boolean keepEmpty, String whereSql, Object... args) {
        String restRaw = db.getSetting("roast_rest_days") != null ? db.getSetting("roast_rest_days").toString() : "13";
        int rest = Integer.parseInt(restRaw);
        String extra = (whereSql != null && !whereSql.isBlank()) ? (" AND (" + whereSql + ")") : "";
        String sql = "SELECT l.id, l.code, l.name, l.stage, l.owner, l.status, l.location, l.product_id, l.bean_id, l.customer_id, " +
                "l.pack_g, l.form, l.receipt_id, l.roast_id, l.bag_kind, l.bags, l.created_at, " +
                "COALESCE(l.roasted_on, DATE(rb.created_at)) roasted_on, " +
                "COALESCE(mb.name, m.name) bean, " +
                "COALESCE(m.name, mb.name) product, " +
                "COALESCE(m.name, mb.name) product_name, COALESCE(m.code, mb.code) bean_code, m.nominal_kg bag_kg, " +
                "rc.code receipt_code, rc.source_name supplier, " +
                "ROUND(COALESCE(SUM(mv.delta_kg),0), 3) kg, " +
                "ROUND(COALESCE(SUM(mv.delta_kg),0), 3) balance_kg, " +
                "ROUND(COALESCE((SELECT SUM(kg) FROM reservations r WHERE r.lot_id=l.id AND r.state='ACTIVE'),0), 3) reserved_kg " +
                "FROM lots l " +
                "LEFT JOIN movements mv ON mv.lot_id=l.id " +
                "LEFT JOIN masters m ON m.id=l.product_id " +
                "LEFT JOIN masters mb ON mb.id=l.bean_id " +
                "LEFT JOIN roast_batches rb ON rb.id=l.roast_id " +
                "LEFT JOIN receipts rc ON rc.id=l.receipt_id " +
                "WHERE 1=1" + extra + " GROUP BY l.id ORDER BY l.id DESC";
        List<Map<String, Object>> rows = db.rows(sql, args);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            double bal = r.get("balance_kg") instanceof Number n ? n.doubleValue() : 0.0;
            if (bal <= 0.0001 && !keepEmpty) {
                continue;
            }
            double res = r.get("reserved_kg") instanceof Number n ? n.doubleValue() : 0.0;
            r.put("available_kg", r3(bal - res));
            Object packGObj = r.get("pack_g");
            if (packGObj instanceof Number pg && pg.doubleValue() > 0) {
                r.put("units", (int) Math.round(bal * 1000.0 / pg.doubleValue()));
            }
            Object roastedOn = r.get("roasted_on");
            String todayStr = Times.isoDayIst();
            if (roastedOn != null && !roastedOn.toString().isBlank()) {
                try {
                    LocalDate rd = LocalDate.parse(roastedOn.toString());
                    Object restObj = db.getSetting("roast_rest_days");
                    int restDays = restObj != null ? ((Number) restObj).intValue() : 0;
                    String readyFrom = rd.plusDays(restDays).toString();
                    r.put("ready_from", readyFrom);
                    r.put("ready_on", readyFrom);
                    r.put("resting", restDays > 0 && readyFrom.compareTo(todayStr) > 0);
                } catch (Exception e) {
                    r.put("ready_from", null);
                    r.put("ready_on", null);
                    r.put("resting", false);
                }
            } else {
                r.put("ready_from", null);
                r.put("ready_on", null);
                r.put("resting", false);
            }
            out.add(r);
        }
        return out;
    }

    public List<Map.Entry<Long, Double>> fifo(double kg, String whereSql, List<Object> args, String action, Object sourceId, long actorId) {
        String sql = "SELECT id FROM lots WHERE status='RELEASED' AND " + whereSql + " ORDER BY id FOR UPDATE";
        List<Map<String, Object>> lots = db.rows(sql, args.toArray());
        List<Map.Entry<Long, Double>> plan = new ArrayList<>();
        double need = r3(kg);
        for (Map<String, Object> x : lots) {
            if (need <= 1e-4) break;
            long lid = ((Number) x.get("id")).longValue();
            double free = available(lid);
            if (free <= 1e-4) continue;
            double take = r3(Math.min(free, need));
            plan.add(Map.entry(lid, take));
            need = r3(need - take);
        }
        if (need > 1e-4) {
            throw new ApiException("INSUFFICIENT_STOCK", 400);
        }
        for (Map.Entry<Long, Double> entry : plan) {
            move(entry.getKey(), -entry.getValue(), action, sourceId, actorId);
        }
        return plan;
    }
}
