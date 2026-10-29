package in.vasavi.vtc.area.admin;

import in.vasavi.vtc.common.AlertsService;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.CodesService;
import in.vasavi.vtc.common.LedgerService;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFFont;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/v1")
public class GoLiveController {

    private static final Map<String, String> FORMS = Map.of(
            "RAW", "Raw beans",
            "ROASTED", "Roasted",
            "GROUND", "Ground"
    );

    private static final Map<String, String> KINDS = Map.of(
            "SOUND", "Sound",
            "PARTIAL", "Partial",
            "DAMAGED", "Damaged"
    );

    private static final Map<String, String> PLACES = Map.of(
            "PROD-01", "Production",
            "CTR-01", "Counter"
    );

    private static final Map<String, String> SIDES = Map.of(
            "CLIENT", "Client owes us",
            "SUPPLIER", "We owe supplier",
            "STAFF", "Staff advance"
    );

    private static final Map<String, List<String>> SHEETS = new LinkedHashMap<>();
    static {
        SHEETS.put("Clients", List.of("Name*", "Phone", "Address"));
        SHEETS.put("Suppliers", List.of("Name*", "Phone", "Address"));
        SHEETS.put("Counter customers", List.of("Phone*", "Name"));
        SHEETS.put("Beans & products", List.of("Name*", "Category (Green coffee / Chicory / Tea / Packaging / Other)", "Kg per bag", "Short code (optional)"));
        SHEETS.put("Opening stock", List.of("Bean or product*", "Form* (Raw / Roasted / Ground)", "Bag condition (Sound / Partial / Damaged — raw only)", "Bags", "Kg*", "Place* (Production / Counter)", "Roast date (roasted or ground)"));
        SHEETS.put("Old dues", List.of("Type* (Client owes us / We owe supplier / Staff advance)", "Name*", "Amount ₹*", "Since (date)", "Due date", "Note"));
    }

    private static final Map<String, List<String>> EXAMPLES = new LinkedHashMap<>();
    static {
        EXAMPLES.put("Clients", List.of("e.g. Sample Café", "9000000000", "Banjara Hills, Hyderabad"));
        EXAMPLES.put("Suppliers", List.of("e.g. Sample Estate", "9000000001", "Chikmagalur"));
        EXAMPLES.put("Counter customers", List.of("e.g. 9000000002", "Sample Customer"));
        EXAMPLES.put("Beans & products", List.of("e.g. Robusta Cherry AB", "Green coffee", "50", "ROBCAB"));
        EXAMPLES.put("Opening stock", List.of("e.g. Robusta Cherry AB", "Raw", "Sound", "4", "200", "Production", ""));
        EXAMPLES.put("Old dues", List.of("e.g. Client owes us", "Sample Café", "12500", "2026-09-30", "2026-11-15", "September bills"));
    }

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final LedgerService ledger;
    private final CodesService codes;
    private final AlertsService alerts;

    public GoLiveController(Db db,
                            SessionService sessionService,
                            PermissionService permissionService,
                            LedgerService ledger,
                            CodesService codes,
                            AlertsService alerts) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.ledger = ledger;
        this.codes = codes;
        this.alerts = alerts;
    }

    private Map<String, Object> getState() {
        Map<String, Object> st = db.one("SELECT * FROM golive WHERE id=1");
        if (st == null) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", 1L);
            m.put("state", "SETUP");
            m.put("cash_paise", null);
            m.put("confirmed_by", null);
            m.put("confirmed_at", null);
            return m;
        }
        return new LinkedHashMap<>(st);
    }

    private void ensureSetupOnly() {
        Map<String, Object> st = getState();
        if (!"SETUP".equals(st.get("state"))) {
            throw new ApiException("ALREADY_LIVE", 400);
        }
    }

    public static String normPhone(Object v) {
        if (v == null) return "";
        String s = v.toString();
        StringBuilder sb = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (Character.isDigit(c)) {
                sb.append(c);
            }
        }
        String digits = sb.toString();
        if (digits.length() == 12 && digits.startsWith("91")) {
            digits = digits.substring(2);
        }
        return (digits.length() >= 10 && digits.length() <= 13) ? digits : "";
    }

    public static String excelDate(Object v) {
        if (v == null) return null;
        String s = v.toString().trim();
        if (s.isEmpty()) return null;
        if (v instanceof Number n) {
            return LocalDate.of(1899, 12, 30).plusDays(n.longValue()).toString();
        }
        if (s.matches("^\\d+$")) {
            try {
                long days = Long.parseLong(s);
                if (days >= 1000 && days <= 100000) {
                    return LocalDate.of(1899, 12, 30).plusDays(days).toString();
                }
            } catch (Exception ignored) {}
        }
        Matcher m1 = Pattern.compile("^(\\d{4})-(\\d{1,2})-(\\d{1,2})$").matcher(s);
        if (m1.matches()) {
            return LocalDate.of(Integer.parseInt(m1.group(1)), Integer.parseInt(m1.group(2)), Integer.parseInt(m1.group(3))).toString();
        }
        Matcher m2 = Pattern.compile("^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})$").matcher(s);
        if (m2.matches()) {
            return LocalDate.of(Integer.parseInt(m2.group(3)), Integer.parseInt(m2.group(2)), Integer.parseInt(m2.group(1))).toString();
        }
        throw new ApiException("INVALID_DATE", 400);
    }

    public static long parseMoney(Object v) {
        if (v == null) throw new ApiException("INVALID_AMOUNT", 400);
        String s = v.toString().replace(",", "").replace("₹", "").trim();
        try {
            double d = Double.parseDouble(s);
            long paise = Math.round(d * 100.0);
            if (paise <= 0) throw new ApiException("INVALID_AMOUNT", 400);
            return paise;
        } catch (Exception e) {
            throw new ApiException("INVALID_AMOUNT", 400);
        }
    }

    public static Double parseKg(Object v, boolean allowNone) {
        if (v == null || v.toString().trim().isEmpty()) {
            if (allowNone) return null;
            throw new ApiException("INVALID_KG", 400);
        }
        String s = v.toString().replace(",", "").trim();
        try {
            double d = Double.parseDouble(s);
            double kg = Math.round(d * 1000.0) / 1000.0;
            if (kg <= 0) throw new ApiException("INVALID_KG", 400);
            return kg;
        } catch (Exception e) {
            throw new ApiException("INVALID_KG", 400);
        }
    }

    private static String parseWord(Object v, Map<String, String> table, String err) {
        String s = v != null ? v.toString().trim().toLowerCase() : "";
        for (Map.Entry<String, String> e : table.entrySet()) {
            String k = e.getKey();
            String label = e.getValue();
            if (s.equals(k.toLowerCase()) || s.equals(label.toLowerCase()) || (!s.isEmpty() && label.toLowerCase().startsWith(s))) {
                return k;
            }
        }
        throw new ApiException(err, 400);
    }

    private long lookupProduct(String name, Set<String> newBeans) {
        if (name == null || name.trim().isEmpty()) {
            throw new ApiException("UNKNOWN_BEAN", 400);
        }
        String n = name.trim();
        Map<String, Object> r = db.one("SELECT id FROM masters WHERE kind='product' AND state='ACTIVE' AND LOWER(name)=LOWER(?)", n);
        if (r != null) {
            return ((Number) r.get("id")).longValue();
        }
        if (newBeans.contains(n.toLowerCase())) {
            return -1L;
        }
        throw new ApiException("UNKNOWN_BEAN", 400);
    }

    private long lookupParty(String side, String name, Set<String> newParties) {
        String n = name != null ? name.trim() : "";
        if (n.isEmpty()) {
            throw new ApiException("STAFF".equals(side) ? "UNKNOWN_STAFF" : ("CLIENT".equals(side) ? "UNKNOWN_CLIENT" : "UNKNOWN_SUPPLIER"), 400);
        }
        if ("STAFF".equals(side)) {
            Map<String, Object> r = db.one("SELECT id FROM users WHERE active=1 AND LOWER(full_name)=LOWER(?)", n);
            if (r == null) throw new ApiException("UNKNOWN_STAFF", 400);
            return ((Number) r.get("id")).longValue();
        }
        String kind = "CLIENT".equals(side) ? "customer" : "supplier";
        Map<String, Object> r = db.one("SELECT id FROM masters WHERE kind=? AND state='ACTIVE' AND LOWER(name)=LOWER(?)", kind, n);
        if (r != null) {
            return ((Number) r.get("id")).longValue();
        }
        if (newParties.contains(kind + ":" + n.toLowerCase())) {
            return -1L;
        }
        throw new ApiException("CLIENT".equals(side) ? "UNKNOWN_CLIENT" : "UNKNOWN_SUPPLIER", 400);
    }

    private Map<String, Object> parseStockRow(Map<String, Object> d, Set<String> newBeans) {
        String prodName = d.get("product") != null ? d.get("product").toString().trim() : "";
        long pid = lookupProduct(prodName, newBeans);
        String form = parseWord(d.get("form"), FORMS, "INVALID_FORM");
        String kind = null;
        if ("RAW".equals(form)) {
            Object kObj = d.get("bag_kind");
            kind = parseWord(kObj != null && !kObj.toString().trim().isEmpty() ? kObj : "Sound", KINDS, "INVALID_BAG_CONDITION");
        }
        Integer bags = null;
        if ("RAW".equals(form)) {
            Object bObj = d.get("bags");
            if (bObj != null && !bObj.toString().trim().isEmpty()) {
                try {
                    bags = (int) Double.parseDouble(bObj.toString().trim());
                    if (bags < 0) throw new ApiException("INVALID_BAGS", 400);
                } catch (Exception e) {
                    throw new ApiException("INVALID_BAGS", 400);
                }
            }
        }
        Double kg = parseKg(d.get("kg"), false);
        Object placeObj = d.get("place");
        String place = parseWord(placeObj != null && !placeObj.toString().trim().isEmpty() ? placeObj : "Production", PLACES, "INVALID_PLACE");
        String roastedOn = null;
        if (!"RAW".equals(form)) {
            Object rOn = d.get("roasted_on");
            if (rOn == null || rOn.toString().trim().isEmpty()) {
                throw new ApiException("ROAST_DATE_REQUIRED", 400);
            }
            roastedOn = excelDate(rOn);
        }
        String note = d.get("note") != null ? d.get("note").toString().trim() : "";
        if (note.length() > 120) note = note.substring(0, 120);

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("product_id", pid);
        row.put("form", form);
        row.put("bag_kind", kind);
        row.put("bags", bags);
        row.put("kg", kg);
        row.put("location", place);
        row.put("roasted_on", roastedOn);
        row.put("note", note);
        return row;
    }

    private Map<String, Object> parseDueRow(Map<String, Object> d, Set<String> newParties) {
        String side = parseWord(d.get("side"), SIDES, "INVALID_DUE_TYPE");
        String name = d.get("name") != null ? d.get("name").toString().trim() : "";
        long partyId = lookupParty(side, name, newParties);
        long amountPaise = parseMoney(d.get("amount"));
        String since = excelDate(d.get("since"));
        String dueDate = excelDate(d.get("due_date"));
        String note = d.get("note") != null ? d.get("note").toString().trim() : "";
        if (note.length() > 120) note = note.substring(0, 120);

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("side", side);
        row.put("party_id", partyId);
        row.put("amount_paise", amountPaise);
        row.put("since", since);
        row.put("due_date", dueDate);
        row.put("note", note);
        return row;
    }

    private void insertStock(Map<String, Object> r, long userId) {
        db.insert(
                "INSERT INTO opening_stock(product_id, form, bag_kind, bags, kg, location, roasted_on, note, created_by, created_at) " +
                        "VALUES(?,?,?,?,?,?,?,?,?,?)",
                r.get("product_id"), r.get("form"), r.get("bag_kind"), r.get("bags"), r.get("kg"),
                r.get("location"), r.get("roasted_on"), r.get("note"), userId, Times.stamp()
        );
    }

    private void insertDue(Map<String, Object> r, long userId) {
        db.insert(
                "INSERT INTO opening_dues(side, party_id, amount_paise, since, due_date, note, state, created_by, created_at) " +
                        "VALUES(?,?,?,?,?,?,?,?,?)",
                r.get("side"), r.get("party_id"), r.get("amount_paise"), r.get("since"), r.get("due_date"),
                r.get("note"), "DRAFT", userId, Times.stamp()
        );
    }

    @GetMapping("/golive")
    public Map<String, Object> golive(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        Map<String, Object> st = getState();
        if (st.get("confirmed_by") != null) {
            Map<String, Object> confUser = db.one("SELECT full_name FROM users WHERE id=?", st.get("confirmed_by"));
            if (confUser != null) {
                st.put("confirmed_by_name", confUser.get("full_name"));
            }
        }
        List<Map<String, Object>> stock = db.rows(
                "SELECT s.*, m.name product FROM opening_stock s JOIN masters m ON m.id=s.product_id ORDER BY s.id"
        );
        List<Map<String, Object>> dues = db.rows(
                "SELECT d.*, CASE d.side WHEN 'STAFF' THEN (SELECT full_name FROM users WHERE id=d.party_id) " +
                        "ELSE (SELECT name FROM masters WHERE id=d.party_id) END party FROM opening_dues d ORDER BY d.id"
        );
        Map<String, Object> counts = Map.of(
                "clients", db.count("SELECT COUNT(*) FROM masters WHERE kind='customer' AND state='ACTIVE'"),
                "suppliers", db.count("SELECT COUNT(*) FROM masters WHERE kind='supplier' AND state='ACTIVE'"),
                "beans", db.count("SELECT COUNT(*) FROM masters WHERE kind='product' AND state='ACTIVE'"),
                "customers", db.count("SELECT COUNT(*) FROM counter_customers")
        );
        return Map.of("state", st, "stock", stock, "dues", dues, "counts", counts);
    }

    @GetMapping(value = "/golive/template", produces = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    public ResponseEntity<byte[]> template(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");

        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            CellStyle headerStyle = wb.createCellStyle();
            XSSFFont font = wb.createFont();
            font.setBold(true);
            font.setFontName("Calibri");
            headerStyle.setFont(font);

            for (Map.Entry<String, List<String>> e : SHEETS.entrySet()) {
                XSSFSheet sheet = wb.createSheet(e.getKey());
                Row hRow = sheet.createRow(0);
                List<String> headers = e.getValue();
                for (int c = 0; c < headers.size(); c++) {
                    Cell cell = hRow.createCell(c);
                    cell.setCellValue(headers.get(c));
                    cell.setCellStyle(headerStyle);
                    sheet.setColumnWidth(c, 24 * 256);
                }
                List<String> example = EXAMPLES.get(e.getKey());
                if (example != null) {
                    Row exRow = sheet.createRow(1);
                    for (int c = 0; c < example.size(); c++) {
                        Cell cell = exRow.createCell(c);
                        cell.setCellValue(example.get(c));
                    }
                }
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            byte[] bytes = out.toByteArray();

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"VTC_go_live_template.xlsx\"")
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                    .body(bytes);
        } catch (Exception ex) {
            throw new RuntimeException("Failed to generate Excel template", ex);
        }
    }

    private static String cell(List<String> row, int i) {
        return (row != null && i < row.size() && row.get(i) != null) ? row.get(i) : "";
    }

    private List<List<String>> getSheetRows(Map<String, List<List<String>>> book, String targetName) {
        if (book.containsKey(targetName)) {
            return book.get(targetName);
        }
        String normTarget = targetName.replace("&", "").replace("_", "").replace(" ", "").toLowerCase();
        for (Map.Entry<String, List<List<String>>> e : book.entrySet()) {
            String normKey = e.getKey().replace("&", "").replace("_", "").replace(" ", "").toLowerCase();
            if (normKey.equals(normTarget)) {
                return e.getValue();
            }
        }
        return Collections.emptyList();
    }

    private List<List<String>> pickRows(List<List<String>> rawRows) {
        if (rawRows == null || rawRows.size() <= 1) {
            return Collections.emptyList();
        }
        List<List<String>> result = new ArrayList<>();
        for (int i = 1; i < rawRows.size(); i++) {
            List<String> r = rawRows.get(i);
            boolean any = false;
            for (String cell : r) {
                if (cell != null && !cell.trim().isEmpty()) {
                    any = true;
                    break;
                }
            }
            if (!any) continue;
            String first = r.isEmpty() || r.get(0) == null ? "" : r.get(0).trim().toLowerCase();
            if (first.startsWith("e.g.")) continue;
            result.add(r);
        }
        return result;
    }

    @PostMapping("/golive/import")
    public Map<String, Object> importSheet(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");

        String dataBase64 = (String) body.get("data");
        if (dataBase64 == null) {
            throw new ApiException("NOT_AN_EXCEL_FILE", 400);
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(dataBase64.trim());
        } catch (Exception e) {
            throw new ApiException("NOT_AN_EXCEL_FILE", 400);
        }

        Map<String, List<List<String>>> book = new LinkedHashMap<>();
        try (Workbook wb = WorkbookFactory.create(new ByteArrayInputStream(bytes))) {
            DataFormatter fmt = new DataFormatter();
            for (int s = 0; s < wb.getNumberOfSheets(); s++) {
                Sheet sheet = wb.getSheetAt(s);
                List<List<String>> rows = new ArrayList<>();
                for (Row row : sheet) {
                    int last = row.getLastCellNum();
                    if (last <= 0) continue;
                    List<String> vals = new ArrayList<>();
                    boolean any = false;
                    for (int c = 0; c < last; c++) {
                        Cell cell = row.getCell(c, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
                        String val = "";
                        if (cell != null) {
                            if (cell.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) {
                                val = cell.getLocalDateTimeCellValue().toLocalDate().toString();
                            } else {
                                val = fmt.formatCellValue(cell).trim();
                            }
                        }
                        if (!val.isEmpty()) any = true;
                        vals.add(val);
                    }
                    if (any) {
                        rows.add(vals);
                    }
                }
                book.put(sheet.getSheetName(), rows);
            }
        } catch (Exception e) {
            throw new ApiException("NOT_AN_EXCEL_FILE", 400);
        }

        boolean apply = Boolean.TRUE.equals(body.get("apply"));
        Map<String, Object> report = new LinkedHashMap<>();
        for (String k : SHEETS.keySet()) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("ok", 0);
            r.put("skipped", new ArrayList<String>());
            r.put("errors", new ArrayList<String>());
            report.put(k, r);
        }

        Map<String, Object> st = getState();
        boolean live = !"SETUP".equals(st.get("state"));

        Set<String> newBeans = new LinkedHashSet<>();
        Set<String> newParties = new LinkedHashSet<>();
        Set<String> takenInImport = new LinkedHashSet<>();

        // Masters first
        String[][] masterSheets = new String[][]{
                {"Clients", "customer"},
                {"Suppliers", "supplier"},
                {"Beans & products", "product"}
        };

        for (String[] def : masterSheets) {
            String sheetName = def[0];
            String kind = def[1];
            @SuppressWarnings("unchecked")
            Map<String, Object> rep = (Map<String, Object>) report.get(sheetName);
            @SuppressWarnings("unchecked")
            List<String> skippedList = (List<String>) rep.get("skipped");
            @SuppressWarnings("unchecked")
            List<String> errorList = (List<String>) rep.get("errors");

            List<List<String>> rows = pickRows(getSheetRows(book, sheetName));
            int n = 2;
            for (List<String> r : rows) {
                try {
                    String name = cell(r, 0).trim();
                    if (name.length() < 2 || name.length() > 110) {
                        throw new ApiException("NAME_REQUIRED", 400);
                    }
                    boolean exists = db.one("SELECT 1 FROM masters WHERE kind=? AND LOWER(name)=LOWER(?) AND state!='INACTIVE'", kind, name) != null;
                    if (exists || ("product".equals(kind) && newBeans.contains(name.toLowerCase())) || newParties.contains(kind + ":" + name.toLowerCase())) {
                        skippedList.add("Row " + n + ": " + name + " already exists");
                        n++;
                        continue;
                    }

                    String phone = "";
                    String address = "";
                    String category = "";
                    String code = null;
                    Double nominal = null;

                    if ("product".equals(kind)) {
                        String catStr = cell(r, 1).trim();
                        if (!catStr.isEmpty()) {
                            String lower = catStr.toLowerCase();
                            if (lower.contains("green") || lower.contains("coffee")) {
                                category = "GREEN_COFFEE";
                            } else if (lower.contains("chicory")) {
                                category = "CHICORY";
                            } else if (lower.contains("tea")) {
                                category = "TEA";
                            } else if (lower.contains("pack")) {
                                category = "PACKAGING";
                            } else if (lower.contains("other")) {
                                category = "OTHER";
                            } else {
                                throw new ApiException("INVALID_CATEGORY", 400);
                            }
                        }
                        nominal = parseKg(cell(r, 2), true);
                        String codeGiven = cell(r, 3).trim();
                        if (!codeGiven.isEmpty()) {
                            code = codeGiven.toUpperCase();
                            if (!CodesService.BEAN_CODE.matcher(code).matches()) {
                                throw new ApiException("INVALID_BEAN_CODE", 400);
                            }
                            if (codes.takenCodes().contains(code) || takenInImport.contains(code)) {
                                throw new ApiException("BEAN_CODE_TAKEN", 400);
                            }
                            takenInImport.add(code);
                        } else {
                            Set<String> taken = new LinkedHashSet<>(codes.takenCodes());
                            taken.addAll(takenInImport);
                            code = codes.suggest(name, taken);
                            takenInImport.add(code);
                        }
                    } else {
                        phone = cell(r, 1).trim();
                        if (phone.length() > 20) phone = phone.substring(0, 20);
                        address = cell(r, 2).trim();
                        if (address.length() > 200) address = address.substring(0, 200);
                    }

                    if (apply) {
                        db.insert(
                                "INSERT INTO masters(kind, name, nominal_kg, state, creator_id, approved_by, created_at, phone, address, category, code) " +
                                        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                kind, name, nominal, "ACTIVE", u.getId(), u.getId(), Times.stamp(), phone, address, category, code
                        );
                    }
                    if ("product".equals(kind)) {
                        newBeans.add(name.toLowerCase());
                    } else {
                        newParties.add(kind + ":" + name.toLowerCase());
                    }
                    rep.put("ok", ((Number) rep.get("ok")).intValue() + 1);
                } catch (ApiException ex) {
                    errorList.add("Row " + n + ": " + ex.getMessage());
                } catch (Exception ex) {
                    errorList.add("Row " + n + ": " + ex.getMessage());
                }
                n++;
            }
        }

        // Counter customers
        {
            @SuppressWarnings("unchecked")
            Map<String, Object> rep = (Map<String, Object>) report.get("Counter customers");
            @SuppressWarnings("unchecked")
            List<String> skippedList = (List<String>) rep.get("skipped");
            @SuppressWarnings("unchecked")
            List<String> errorList = (List<String>) rep.get("errors");

            List<List<String>> rows = pickRows(getSheetRows(book, "Counter customers"));
            int n = 2;
            for (List<String> r : rows) {
                String p = normPhone(cell(r, 0));
                if (p.isEmpty()) {
                    errorList.add("Row " + n + ": INVALID_PHONE");
                } else if (db.one("SELECT 1 FROM counter_customers WHERE phone=?", p) != null) {
                    String masked = "•".repeat(Math.max(0, p.length() - 4)) + p.substring(Math.max(0, p.length() - 4));
                    skippedList.add("Row " + n + ": " + masked + " already saved");
                } else {
                    if (apply) {
                        String custName = cell(r, 1).trim();
                        if (custName.length() > 60) custName = custName.substring(0, 60);
                        db.insert(
                                "INSERT INTO counter_customers(phone, name, visits, first_seen, last_seen) VALUES(?,?,0,?,?)",
                                p, custName, Times.stamp(), Times.stamp()
                        );
                    }
                    rep.put("ok", ((Number) rep.get("ok")).intValue() + 1);
                }
                n++;
            }
        }

        // Opening stock and Old dues
        for (String sheetName : List.of("Opening stock", "Old dues")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> rep = (Map<String, Object>) report.get(sheetName);
            @SuppressWarnings("unchecked")
            List<String> errorList = (List<String>) rep.get("errors");

            List<List<String>> rows = pickRows(getSheetRows(book, sheetName));
            if (!rows.isEmpty() && live) {
                errorList.add("ALREADY_LIVE");
                continue;
            }
            int n = 2;
            for (List<String> r : rows) {
                try {
                    if ("Opening stock".equals(sheetName)) {
                        Map<String, Object> in = new LinkedHashMap<>();
                        in.put("product", cell(r, 0));
                        in.put("form", cell(r, 1));
                        in.put("bag_kind", cell(r, 2));
                        in.put("bags", cell(r, 3));
                        in.put("kg", cell(r, 4));
                        in.put("place", cell(r, 5));
                        in.put("roasted_on", cell(r, 6));

                        Map<String, Object> parsed = parseStockRow(in, newBeans);
                        if (apply) {
                            if (parsed.get("product_id") != null && ((Number) parsed.get("product_id")).longValue() == -1L) {
                                Map<String, Object> m = db.one("SELECT id FROM masters WHERE kind='product' AND state='ACTIVE' AND LOWER(name)=LOWER(?)", cell(r, 0).trim());
                                if (m != null) {
                                    parsed.put("product_id", ((Number) m.get("id")).longValue());
                                }
                            }
                            insertStock(parsed, u.getId());
                        }
                    } else {
                        Map<String, Object> in = new LinkedHashMap<>();
                        in.put("side", cell(r, 0));
                        in.put("name", cell(r, 1));
                        in.put("amount", cell(r, 2));
                        in.put("since", cell(r, 3));
                        in.put("due_date", cell(r, 4));
                        in.put("note", cell(r, 5));

                        Map<String, Object> parsed = parseDueRow(in, newParties);
                        if (apply) {
                            if (parsed.get("party_id") != null && ((Number) parsed.get("party_id")).longValue() == -1L) {
                                String sideKind = "CLIENT".equals(parsed.get("side")) ? "customer" : "supplier";
                                Map<String, Object> m = db.one("SELECT id FROM masters WHERE kind=? AND state='ACTIVE' AND LOWER(name)=LOWER(?)", sideKind, cell(r, 1).trim());
                                if (m != null) {
                                    parsed.put("party_id", ((Number) m.get("id")).longValue());
                                }
                            }
                            insertDue(parsed, u.getId());
                        }
                    }
                    rep.put("ok", ((Number) rep.get("ok")).intValue() + 1);
                } catch (ApiException ex) {
                    errorList.add("Row " + n + ": " + ex.getMessage());
                } catch (Exception ex) {
                    errorList.add("Row " + n + ": " + ex.getMessage());
                }
                n++;
            }
        }

        if (apply) {
            List<String> summary = new ArrayList<>();
            for (Map.Entry<String, Object> e : report.entrySet()) {
                @SuppressWarnings("unchecked")
                Map<String, Object> r = (Map<String, Object>) e.getValue();
                int ok = ((Number) r.get("ok")).intValue();
                if (ok > 0) summary.add(e.getKey() + ": " + ok);
            }
            db.audit(u.getId(), "GOLIVE_IMPORT", "golive", String.join(", ", summary), "access");
        }

        return Map.of("applied", apply, "report", report);
    }

    @PostMapping("/golive/stock")
    public Map<String, Object> addStock(@RequestBody Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        ensureSetupOnly();
        Map<String, Object> r = parseStockRow(d, Set.of());
        insertStock(r, u.getId());
        return Map.of("ok", true);
    }

    @PostMapping("/golive/dues")
    public Map<String, Object> addDue(@RequestBody Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        ensureSetupOnly();
        Map<String, Object> r = parseDueRow(d, Set.of());
        insertDue(r, u.getId());
        return Map.of("ok", true);
    }

    @DeleteMapping("/golive/{what}/{rid}")
    public Map<String, Object> removeDraft(@PathVariable String what, @PathVariable long rid, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "system.settings");
        ensureSetupOnly();
        String table;
        if ("stock".equals(what)) {
            table = "opening_stock";
        } else if ("dues".equals(what)) {
            table = "opening_dues";
        } else {
            throw new ApiException("NOT_FOUND", 404);
        }
        int affected = db.exec("DELETE FROM " + table + " WHERE id=?", rid);
        if (affected == 0) {
            throw new ApiException("NOT_FOUND", 404);
        }
        return Map.of("ok", true);
    }

    @PostMapping("/golive/confirm")
    public Map<String, Object> confirm(@RequestBody Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        if (!u.isOwner()) {
            throw new ApiException("ONLY_OWNER_CONFIRMS", 403);
        }
        ensureSetupOnly();

        Object cashObj = d.get("cash_paise");
        Long cash = null;
        if (cashObj != null && !"".equals(cashObj.toString().trim())) {
            cash = ((Number) cashObj).longValue();
            if (cash < 0 || cash > 100_000_000L) {
                throw new ApiException("INVALID_AMOUNT", 400);
            }
        }

        int n = 0;
        List<Map<String, Object>> stockRows = db.rows("SELECT * FROM opening_stock WHERE lot_id IS NULL ORDER BY id");
        for (Map<String, Object> s : stockRows) {
            long pid = ((Number) s.get("product_id")).longValue();
            Map<String, Object> p = db.one("SELECT name FROM masters WHERE id=?", pid);
            String form = (String) s.get("form");
            boolean raw = "RAW".equals(form);
            String bagKind = (String) s.get("bag_kind");
            String status = "DAMAGED".equals(bagKind) ? "QUARANTINE" : "RELEASED";
            String lotName = (p != null ? p.get("name") : "Product") + " • opening stock";
            String loc = (String) s.get("location");
            String roastedOn = s.get("roasted_on") != null ? s.get("roasted_on").toString() : null;

            long lid = ledger.newLot(
                    lotName,
                    form,
                    status,
                    "VTC",
                    loc,
                    raw ? pid : null,
                    null,
                    null,
                    null,
                    null,
                    form,
                    raw ? null : pid,
                    null,
                    roastedOn
            );
            if (raw) {
                Object bagsObj = s.get("bags");
                int bags = bagsObj instanceof Number nb ? nb.intValue() : 0;
                db.exec("UPDATE lots SET bag_kind=?, bags=? WHERE id=?", bagKind, bags, lid);
            }
            ledger.move(lid, ((Number) s.get("kg")).doubleValue(), "OPENING", s.get("id"), u.getId());
            db.exec("UPDATE opening_stock SET lot_id=? WHERE id=?", lid, s.get("id"));
            n++;
        }

        int dues = db.exec("UPDATE opening_dues SET state='OPEN' WHERE state='DRAFT'");
        if (cash != null) {
            db.exec("INSERT INTO settings(`key`, value, changed_by, changed_at) VALUES('counter_opening_float_paise',?,?,?) " +
                            "ON DUPLICATE KEY UPDATE value=VALUES(value), changed_by=VALUES(changed_by), changed_at=VALUES(changed_at)",
                    String.valueOf(cash), u.getId(), Times.stamp());
        }
        db.exec("INSERT INTO golive(id, state, cash_paise, confirmed_by, confirmed_at) VALUES(1,'LIVE',?,?,?) " +
                        "ON DUPLICATE KEY UPDATE state='LIVE', cash_paise=VALUES(cash_paise), confirmed_by=VALUES(confirmed_by), confirmed_at=VALUES(confirmed_at)",
                cash, u.getId(), Times.stamp());
        db.exec("UPDATE stock_dirty SET dirty=1 WHERE id=1");
        db.audit(u.getId(), "GOLIVE_CONFIRMED", "golive", n + " stock lines, " + dues + " old dues" + (cash != null ? String.format(", cash ₹%.2f", cash / 100.0) : ""), "access");
        return Map.of("ok", true, "stock_lots", n, "dues", dues);
    }

    @GetMapping("/opening-dues")
    public Map<String, Object> openingDues(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        List<String> sides = new ArrayList<>();
        if (u.can("finance.view") || u.can("finance.collection.record") || u.can("finance.collection.verify")) {
            sides.add("CLIENT");
            sides.add("STAFF");
        }
        if (u.can("finance.view") || u.can("supplier.pay.record") || u.can("supplier.pay.approve")) {
            sides.add("SUPPLIER");
        }
        if (sides.isEmpty()) {
            throw new ApiException("ACCESS_DENIED", 403);
        }

        List<Map<String, Object>> dues = db.rows(
                "SELECT d.*, " +
                        "CASE d.side WHEN 'STAFF' THEN (SELECT full_name FROM users WHERE id=d.party_id) ELSE (SELECT name FROM masters WHERE id=d.party_id) END party, " +
                        "CASE d.side WHEN 'CLIENT' THEN (SELECT phone FROM masters WHERE id=d.party_id) END party_phone, " +
                        "(SELECT COALESCE(SUM(amount_paise),0) FROM opening_due_payments p WHERE p.due_id=d.id AND p.state='VERIFIED') paid_paise " +
                        "FROM opening_dues d WHERE d.state!='DRAFT' ORDER BY d.side, d.due_date IS NULL, d.due_date, d.id"
        );
        List<Map<String, Object>> pending = db.rows(
                "SELECT p.*, d.side, x.full_name recorded_by_name FROM opening_due_payments p " +
                        "JOIN opening_dues d ON d.id=p.due_id JOIN users x ON x.id=p.recorded_by " +
                        "WHERE p.state='RECORDED' ORDER BY p.id"
        );

        List<Map<String, Object>> filteredDues = new ArrayList<>();
        for (Map<String, Object> d : dues) {
            String side = (String) d.get("side");
            if (!sides.contains(side)) continue;
            long amt = ((Number) d.get("amount_paise")).longValue();
            long paid = ((Number) d.get("paid_paise")).longValue();
            d.put("due_paise", amt - paid);
            if (!u.can("customer.contacts")) {
                d.remove("party_phone");
            }
            filteredDues.add(d);
        }

        List<Map<String, Object>> filteredPending = new ArrayList<>();
        for (Map<String, Object> p : pending) {
            String side = (String) p.get("side");
            if (sides.contains(side)) {
                filteredPending.add(p);
            }
        }

        return Map.of("dues", filteredDues, "pending", filteredPending);
    }

    @PostMapping("/opening-dues/{did}/payments")
    public Map<String, Object> recordDuePayment(@PathVariable long did, @RequestBody Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        long amount = d.get("amount_paise") != null ? ((Number) d.get("amount_paise")).longValue() : 0L;
        if (amount <= 0) {
            throw new ApiException("INVALID_AMOUNT", 400);
        }
        String method = (String) d.get("method");
        if (method == null || !Set.of("CASH", "UPI", "BANK", "CHEQUE", "SALARY").contains(method)) {
            throw new ApiException("INVALID_PAYMENT_METHOD", 400);
        }
        Map<String, Object> due = db.one("SELECT * FROM opening_dues WHERE id=? AND state='OPEN'", did);
        if (due == null) {
            throw new ApiException("NOT_FOUND", 404);
        }
        String side = (String) due.get("side");
        String recPerm = "SUPPLIER".equals(side) ? "supplier.pay.record" : "finance.collection.record";
        permissionService.require(u, recPerm);

        long totalDue = ((Number) due.get("amount_paise")).longValue();
        Long alreadyPaidOrRecorded = db.val(
                Long.class,
                "SELECT COALESCE(SUM(amount_paise),0) FROM opening_due_payments WHERE due_id=? AND state IN ('RECORDED','VERIFIED')", did
        );
        long left = totalDue - (alreadyPaidOrRecorded != null ? alreadyPaidOrRecorded : 0L);
        if (amount > left) {
            throw new ApiException("MORE_THAN_DUE", 400);
        }
        String ref = d.get("reference") != null ? d.get("reference").toString().trim() : "";
        if (ref.length() > 60) ref = ref.substring(0, 60);

        db.insert(
                "INSERT INTO opening_due_payments(due_id, amount_paise, method, reference, state, recorded_by, created_at) " +
                        "VALUES(?,?,?,?,?,?,?)",
                did, amount, method, ref, "RECORDED", u.getId(), Times.stamp()
        );
        db.audit(u.getId(), "OLD_DUE_PAYMENT_RECORDED", "opening_due:" + did, String.format("₹%.2f %s", amount / 100.0, method));
        String verPerm = "SUPPLIER".equals(side) ? "supplier.pay.approve" : "finance.collection.verify";
        alerts.notifyPerm(verPerm, "normal", String.format("Verify ₹%.2f on an old due", amount / 100.0), "Verify old due payment", "finance", null, null, null, u.getId());
        return Map.of("ok", true);
    }

    @PostMapping("/opening-due-payments/{pid}/verify")
    public Map<String, Object> verifyDuePayment(@PathVariable long pid, @RequestBody Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        boolean approve = d.get("approve") == null || Boolean.TRUE.equals(d.get("approve"));
        Map<String, Object> p = db.one(
                "SELECT p.*, d.side, d.amount_paise due_amount FROM opening_due_payments p JOIN opening_dues d ON d.id=p.due_id WHERE p.id=?", pid
        );
        if (p == null) {
            throw new ApiException("NOT_FOUND", 404);
        }
        String side = (String) p.get("side");
        String verPerm = "SUPPLIER".equals(side) ? "supplier.pay.approve" : "finance.collection.verify";
        permissionService.require(u, verPerm);

        if (!"RECORDED".equals(p.get("state"))) {
            throw new ApiException("ALREADY_DECIDED", 400);
        }
        long recordedBy = ((Number) p.get("recorded_by")).longValue();
        if (recordedBy == u.getId()) {
            throw new ApiException("CANNOT_APPROVE_OWN_REQUEST", 403);
        }

        db.exec("UPDATE opening_due_payments SET state=?, verified_by=?, verified_at=? WHERE id=?",
                approve ? "VERIFIED" : "REJECTED", u.getId(), Times.stamp(), pid);

        long dueId = ((Number) p.get("due_id")).longValue();
        long dueAmount = ((Number) p.get("due_amount")).longValue();
        Long paid = db.val(
                Long.class,
                "SELECT COALESCE(SUM(amount_paise),0) FROM opening_due_payments WHERE due_id=? AND state='VERIFIED'", dueId
        );
        if (paid != null && paid >= dueAmount) {
            db.exec("UPDATE opening_dues SET state='PAID' WHERE id=?", dueId);
        }
        db.audit(u.getId(), "OLD_DUE_PAYMENT_" + (approve ? "VERIFIED" : "REJECTED"), "opening_due:" + dueId, String.format("₹%.2f", ((Number) p.get("amount_paise")).longValue() / 100.0));
        return Map.of("ok", true);
    }
}
