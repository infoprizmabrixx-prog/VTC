package in.vasavi.vtc.area.counter.printer;

import com.fasterxml.jackson.databind.ObjectMapper;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * REST Controller for ATPOS Thermal Printer Operations:
 * Print bill, print test page, cash drawer kick, hardware diagnostic, and settings.
 */
@RestController
@RequestMapping("/api/v1/counter/printer")
public class AtposPrinterController {

    private final AtposPrinterService printerService;
    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final ObjectMapper mapper;

    public AtposPrinterController(AtposPrinterService printerService,
                                  Db db,
                                  SessionService sessionService,
                                  PermissionService permissionService,
                                  ObjectMapper mapper) {
        this.printerService = printerService;
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.mapper = mapper;
    }

    private CurrentUser resolveUserOrLocal(HttpServletRequest req) {
        String token = sessionService.extractCookie(req);
        if (token != null) {
            try {
                return sessionService.current(req);
            } catch (Exception ignored) {}
        }
        String remoteAddr = req.getRemoteAddr();
        if ("127.0.0.1".equals(remoteAddr) || "0:0:0:0:0:0:0:1".equals(remoteAddr) || "localhost".equalsIgnoreCase(req.getServerName())) {
            return null; // Local workstation bypass
        }
        throw new ApiException("LOGIN_REQUIRED", 401);
    }

    /**
     * Prints an 80mm / 58mm thermal receipt for a counter sale.
     */
    @PostMapping("/print")
    public Map<String, Object> printSale(@RequestBody Map<String, Object> reqBody, HttpServletRequest req) {
        CurrentUser u = resolveUserOrLocal(req);
        if (u != null) {
            permissionService.requireAny(u, "counter.sell", "counter.refund", "counter.close_approve");
        }

        long saleId = ((Number) reqBody.getOrDefault("sale_id", 0)).longValue();
        if (saleId <= 0) {
            throw new ApiException("SALE_ID_REQUIRED", 400);
        }

        Map<String, Object> s = db.one("SELECT s.*, u.full_name cashier FROM counter_sales s JOIN users u ON u.id=s.created_by WHERE s.id=?", saleId);
        if (s == null) {
            throw new ApiException("NOT_FOUND", 404);
        }

        List<Map<String, Object>> lines = db.rows("SELECT * FROM counter_lines WHERE sale_id=? ORDER BY id", saleId);
        List<Map<String, Object>> pays = db.rows("SELECT * FROM counter_payments WHERE sale_id=? ORDER BY id", saleId);
        s.put("lines", lines);
        s.put("payments", pays);

        Map<String, Object> st = db.allSettings();
        s.put("header", Map.of(
                "company_name", st.getOrDefault("company_name", "VASAVI TRADING COMPANY"),
                "company_address", st.getOrDefault("company_address", "Coffee Roasters & Wholesale Merchants"),
                "company_gstin", st.getOrDefault("company_gstin", ""),
                "tax_setup_approved", st.getOrDefault("tax_setup_approved", 0)
        ));

        int paperWidth = reqBody.containsKey("paper_width") ? ((Number) reqBody.get("paper_width")).intValue() : 80;
        int copies = reqBody.containsKey("copies") ? ((Number) reqBody.get("copies")).intValue() : 1;
        boolean duplicate = Boolean.TRUE.equals(reqBody.get("duplicate")) || ((Number) s.getOrDefault("reprints", 0)).intValue() > 0;

        String target = String.valueOf(reqBody.getOrDefault("target", "spooler"));
        String ip = String.valueOf(reqBody.getOrDefault("ip", st.getOrDefault("atpos_ip", "")));
        int port = reqBody.containsKey("port") ? ((Number) reqBody.get("port")).intValue() : 9100;
        String printerName = String.valueOf(reqBody.getOrDefault("printer_name", st.getOrDefault("atpos_printer_name", "POS-80C")));

        List<String> copyLabels = copies > 1 ? List.of("CUSTOMER COPY", "OFFICE COPY") : List.of("CUSTOMER COPY");

        for (String copyLabel : copyLabels) {
            byte[] rawBytes = printerService.buildSaleReceipt(s, duplicate, copyLabel, paperWidth);

            if ("network".equalsIgnoreCase(target) || (!ip.isBlank() && "auto".equalsIgnoreCase(target))) {
                printerService.printViaNetwork(ip, port, rawBytes);
            } else {
                printerService.printViaSpooler(printerName, rawBytes);
            }
        }

        if (duplicate) {
            int newReprints = ((Number) s.getOrDefault("reprints", 0)).intValue() + 1;
            db.exec("UPDATE counter_sales SET reprints=? WHERE id=?", newReprints, saleId);
            long uid = u != null ? u.getId() : 1L;
            db.audit(uid, "COUNTER_BILL_REPRINT", "sale:" + saleId, s.get("bill_no") + " reprint #" + newReprints);
        }

        return Map.of(
                "ok", true,
                "bill_no", s.get("bill_no"),
                "copies_printed", copies,
                "target", target
        );
    }

    /**
     * Prints an ATPOS hardware diagnostic test page.
     */
    @PostMapping("/test")
    public Map<String, Object> testPrint(@RequestBody(required = false) Map<String, Object> reqBody, HttpServletRequest req) {
        CurrentUser u = resolveUserOrLocal(req);
        if (u != null) {
            permissionService.requireAny(u, "counter.sell", "system.settings");
        }

        Map<String, Object> body = reqBody != null ? reqBody : Map.of();
        int paperWidth = body.containsKey("paper_width") ? ((Number) body.get("paper_width")).intValue() : 80;
        String target = String.valueOf(body.getOrDefault("target", "spooler"));
        String ip = String.valueOf(body.getOrDefault("ip", ""));
        int port = body.containsKey("port") ? ((Number) body.get("port")).intValue() : 9100;
        String printerName = String.valueOf(body.getOrDefault("printer_name", "POS-80C"));

        byte[] testBytes = printerService.buildTestReceipt(paperWidth);

        if ("network".equalsIgnoreCase(target) && !ip.isBlank()) {
            printerService.printViaNetwork(ip, port, testBytes);
        } else {
            printerService.printViaSpooler(printerName, testBytes);
        }

        return Map.of("ok", true, "message", "ATPOS test receipt sent successfully");
    }

    /**
     * Manually kicks open the cash drawer connected to ATPOS printer.
     */
    @PostMapping("/kick-drawer")
    public Map<String, Object> kickDrawer(@RequestBody(required = false) Map<String, Object> reqBody, HttpServletRequest req) {
        CurrentUser u = resolveUserOrLocal(req);
        if (u != null) {
            permissionService.require(u, "counter.sell");
        }

        Map<String, Object> body = reqBody != null ? reqBody : Map.of();
        String host = body.containsKey("ip") ? String.valueOf(body.get("ip")) : null;
        int port = body.containsKey("port") ? ((Number) body.get("port")).intValue() : 9100;
        String printerName = String.valueOf(body.getOrDefault("printer_name", "POS-80C"));

        printerService.kickCashDrawer(host, port, printerName);
        long uid = u != null ? u.getId() : 1L;
        db.audit(uid, "CASH_DRAWER_KICKED", "counter:drawer", "Manual cash drawer pulse sent to ATPOS printer");

        return Map.of("ok", true, "message", "Cash drawer pulse signal delivered");
    }

    /**
     * Lists local printer drivers and returns saved ATPOS configuration.
     */
    @GetMapping("/status")
    public Map<String, Object> getPrinterStatus(HttpServletRequest req) {
        CurrentUser u = resolveUserOrLocal(req);
        if (u != null) {
            permissionService.requireAny(u, "counter.sell", "system.settings");
        }

        List<Map<String, Object>> spoolerPrinters = printerService.listAvailablePrinters();
        Map<String, Object> settings = db.allSettings();

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("atpos_paper_width", settings.getOrDefault("atpos_paper_width", 80));
        config.put("atpos_ip", settings.getOrDefault("atpos_ip", ""));
        config.put("atpos_port", settings.getOrDefault("atpos_port", 9100));
        config.put("atpos_printer_name", settings.getOrDefault("atpos_printer_name", "POS-80C"));
        config.put("atpos_auto_cut", settings.getOrDefault("atpos_auto_cut", 1));
        config.put("atpos_auto_kick_drawer", settings.getOrDefault("atpos_auto_kick_drawer", 1));
        config.put("atpos_default_copies", settings.getOrDefault("atpos_default_copies", 1));
        config.put("upi_vpa", settings.getOrDefault("upi_vpa", "vasavitrading@okhdfcbank"));

        return Map.of(
                "printers", spoolerPrinters,
                "config", config
        );
    }

    /**
     * Saves ATPOS printer settings in the database.
     */
    @PutMapping("/config")
    public Map<String, Object> saveConfig(@RequestBody Map<String, Object> config, HttpServletRequest req) {
        CurrentUser u = resolveUserOrLocal(req);
        if (u != null) {
            permissionService.require(u, "system.settings");
        }
        long uid = u != null ? u.getId() : 1L;

        String now = Times.stamp();
        for (String key : List.of("atpos_paper_width", "atpos_ip", "atpos_port", "atpos_printer_name",
                "atpos_auto_cut", "atpos_auto_kick_drawer", "atpos_default_copies", "upi_vpa")) {
            if (config.containsKey(key)) {
                try {
                    String jsonVal = mapper.writeValueAsString(config.get(key));
                    db.exec("INSERT INTO settings(`key`, `value`, changed_by, changed_at) VALUES(?,?,?,?) " +
                                    "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), changed_by=VALUES(changed_by), changed_at=VALUES(changed_at)",
                            key, jsonVal, uid, now);
                } catch (Exception e) {}
            }
        }

        db.audit(uid, "ATPOS_CONFIG_UPDATED", "settings:printer", "Updated ATPOS printer parameters");
        return Map.of("ok", true);
    }
}
