package in.vasavi.vtc.area.operations;

import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.LedgerService;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class LotsController {

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final LedgerService ledger;

    public LotsController(Db db, SessionService sessionService, PermissionService permissionService, LedgerService ledger) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.ledger = ledger;
    }

    private String parseScan(String text) {
        String s = text != null ? text.trim().toUpperCase() : "";
        if (s.startsWith("VTC:")) {
            s = s.substring(4);
        }
        return s.split("/")[0].split(" ")[0];
    }

    @GetMapping("/lots/find")
    public Map<String, Object> findLot(@RequestParam(required = false) String code,
                                       @RequestParam(required = false) Long id,
                                       HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "inventory.view", "counter.sell", "goods.receive", "roast.execute", "pack.execute");

        Map<String, Object> r;
        if (code != null && !code.isBlank()) {
            String cleanCode = parseScan(code);
            r = db.one("SELECT id FROM lots WHERE code=?", cleanCode);
        } else {
            r = db.one("SELECT id FROM lots WHERE id=?", id != null ? id : 0L);
        }

        if (r == null) {
            throw new ApiException("LOT_NOT_FOUND", 404);
        }

        long lotId = ((Number) r.get("id")).longValue();
        List<Map<String, Object>> stock = ledger.stockRows(true, "l.id=?", lotId);
        if (stock.isEmpty()) {
            throw new ApiException("LOT_NOT_FOUND", 404);
        }
        Map<String, Object> lot = stock.get(0);

        List<Map<String, Object>> transfers = db.rows(
                "SELECT t.id, t.kg_sent, t.state, t.sent_by, tl.code transit_code FROM transfers t " +
                "LEFT JOIN lots tl ON tl.id=t.transit_lot_id " +
                "WHERE t.state='IN_TRANSIT' AND (t.transit_lot_id=? OR t.source_lot_id=?) ORDER BY t.id",
                lotId, lotId
        );

        Integer bag = null;
        if (code != null && code.contains("/")) {
            String part = code.split("/")[1].trim();
            if (part.matches("^\\d+$")) {
                bag = Integer.parseInt(part);
            }
        }

        return Map.of("lot", lot, "transfers", transfers, "bag", bag != null ? bag : "");
    }
}
