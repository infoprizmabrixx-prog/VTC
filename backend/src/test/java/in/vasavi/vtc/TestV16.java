package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * v1.6 go-live setup (27 Oct 2026): Excel template import, opening stock, cash and old dues,
 * owner confirms "We're live", old dues paid with maker != checker.
 * Ported 1:1 from reference/vtc_portal_v1_6/tests/test_v16.py (2 tests).
 */
class TestV16 extends VtcTestBase {

    static final Map<String, List<String>> SHEETS = new LinkedHashMap<>();

    static {
        SHEETS.put("Clients", List.of("Name*", "Phone", "Address"));
        SHEETS.put("Suppliers", List.of("Name*", "Phone", "Address"));
        SHEETS.put("Counter customers", List.of("Phone*", "Name"));
        SHEETS.put("Beans & products", List.of("Name*", "Category (Green coffee / Chicory / Tea / Packaging / Other)", "Kg per bag", "Short code (optional)"));
        SHEETS.put("Opening stock", List.of("Bean or product*", "Form* (Raw / Roasted / Ground)", "Bag condition (Sound / Partial / Damaged — raw only)", "Bags", "Kg*", "Place* (Production / Counter)", "Roast date (roasted or ground)"));
        SHEETS.put("Old dues", List.of("Type* (Client owes us / We owe supplier / Staff advance)", "Name*", "Amount ₹*", "Since (date)", "Due date", "Note"));
    }

    private static String colName(int n) {
        StringBuilder sb = new StringBuilder();
        while (n > 0) {
            int rem = (n - 1) % 26;
            sb.insert(0, (char) ('A' + rem));
            n = (n - 1) / 26;
        }
        return sb.toString();
    }

    private static String xmlEscape(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    static byte[] xlsxWrite(Map<String, List<List<String>>> sheets) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            List<Map.Entry<String, List<List<String>>>> entries = new ArrayList<>(sheets.entrySet());
            try (ZipOutputStream z = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
                StringBuilder ct = new StringBuilder();
                ct.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">")
                        .append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>")
                        .append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>")
                        .append("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>")
                        .append("<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
                for (int i = 1; i <= entries.size(); i++) {
                    ct.append("<Override PartName=\"/xl/worksheets/sheet").append(i)
                            .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                }
                ct.append("</Types>");
                putZipEntry(z, "[Content_Types].xml", ct.toString());

                putZipEntry(z, "_rels/.rels",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");

                StringBuilder wb = new StringBuilder();
                wb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" ")
                        .append("xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
                for (int i = 0; i < entries.size(); i++) {
                    wb.append("<sheet name=\"").append(xmlEscape(entries.get(i).getKey()))
                            .append("\" sheetId=\"").append(i + 1)
                            .append("\" r:id=\"rId").append(i + 1).append("\"/>");
                }
                wb.append("</sheets></workbook>");
                putZipEntry(z, "xl/workbook.xml", wb.toString());

                StringBuilder rels = new StringBuilder();
                rels.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
                for (int i = 1; i <= entries.size(); i++) {
                    rels.append("<Relationship Id=\"rId").append(i)
                            .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet")
                            .append(i).append(".xml\"/>");
                }
                rels.append("<Relationship Id=\"rId").append(entries.size() + 1)
                        .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
                putZipEntry(z, "xl/_rels/workbook.xml.rels", rels.toString());

                putZipEntry(z, "xl/styles.xml",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
                                "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>" +
                                "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>" +
                                "<borders count=\"1\"><border/></borders><cellStyleXfs count=\"1\"><xf/></cellStyleXfs>" +
                                "<cellXfs count=\"3\"><xf/><xf fontId=\"1\" applyFont=\"1\"/><xf numFmtId=\"49\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>");

                for (int i = 0; i < entries.size(); i++) {
                    List<List<String>> rows = entries.get(i).getValue();
                    int width = rows.stream().mapToInt(List::size).max().orElse(1);
                    StringBuilder sh = new StringBuilder();
                    sh.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">")
                            .append("<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>")
                            .append("<cols>");
                    for (int c = 1; c <= width; c++) {
                        sh.append("<col min=\"").append(c).append("\" max=\"").append(c).append("\" width=\"24\" style=\"2\" customWidth=\"1\"/>");
                    }
                    sh.append("</cols><sheetData>");
                    for (int r = 0; r < rows.size(); r++) {
                        List<String> row = rows.get(r);
                        int rowNum = r + 1;
                        sh.append("<row r=\"").append(rowNum).append("\">");
                        for (int c = 0; c < row.size(); c++) {
                            String v = row.get(c);
                            if (v != null && !v.isEmpty()) {
                                sh.append("<c r=\"").append(colName(c + 1)).append(rowNum)
                                        .append("\" t=\"inlineStr\" s=\"").append(rowNum == 1 ? 1 : 2)
                                        .append("\"><is><t xml:space=\"preserve\">").append(xmlEscape(v)).append("</t></is></c>");
                            }
                        }
                        sh.append("</row>");
                    }
                    sh.append("</sheetData></worksheet>");
                    putZipEntry(z, "xl/worksheets/sheet" + (i + 1) + ".xml", sh.toString());
                }
            }
            return out.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void putZipEntry(ZipOutputStream z, String name, String content) throws Exception {
        z.putNextEntry(new ZipEntry(name));
        z.write(content.getBytes(StandardCharsets.UTF_8));
        z.closeEntry();
    }

    static Map<String, List<List<String>>> xlsxRead(byte[] data) {
        try (Workbook wb = WorkbookFactory.create(new ByteArrayInputStream(data))) {
            DataFormatter fmt = new DataFormatter();
            Map<String, List<List<String>>> out = new LinkedHashMap<>();
            for (int s = 0; s < wb.getNumberOfSheets(); s++) {
                Sheet sheet = wb.getSheetAt(s);
                List<List<String>> rows = new ArrayList<>();
                for (Row row : sheet) {
                    int last = row.getLastCellNum();
                    if (last <= 0) {
                        continue;
                    }
                    List<String> vals = new ArrayList<>();
                    boolean any = false;
                    for (int c = 0; c < last; c++) {
                        Cell cell = row.getCell(c);
                        String val = cell == null ? "" : fmt.formatCellValue(cell);
                        if (!val.isEmpty()) {
                            any = true;
                        }
                        vals.add(val);
                    }
                    if (any) {
                        rows.add(vals);
                    }
                }
                out.put(sheet.getSheetName(), rows);
            }
            return out;
        } catch (Exception e) {
            throw new IllegalArgumentException("not an xlsx file", e);
        }
    }

    static String excelDate(Object v) {
        if (v == null || "".equals(v)) {
            return null;
        }
        if (v instanceof Number n) {
            return LocalDate.of(1899, 12, 30).plusDays(n.longValue()).toString();
        }
        String s = v.toString().trim();
        Matcher m1 = Pattern.compile("^(\\d{4})-(\\d{1,2})-(\\d{1,2})$").matcher(s);
        if (m1.matches()) {
            return LocalDate.of(Integer.parseInt(m1.group(1)), Integer.parseInt(m1.group(2)), Integer.parseInt(m1.group(3))).toString();
        }
        Matcher m2 = Pattern.compile("^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})$").matcher(s);
        if (m2.matches()) {
            return LocalDate.of(Integer.parseInt(m2.group(3)), Integer.parseInt(m2.group(2)), Integer.parseInt(m2.group(1))).toString();
        }
        throw new IllegalArgumentException("date");
    }

    static String book(Map<String, List<List<String>>> sheetRows) {
        Map<String, List<List<String>>> full = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : SHEETS.entrySet()) {
            String key = e.getKey().replace(" & ", "_").replace(" ", "_").toLowerCase();
            List<List<String>> rows = new ArrayList<>();
            rows.add(e.getValue());
            if (sheetRows.containsKey(key)) {
                rows.addAll(sheetRows.get(key));
            }
            full.put(e.getKey(), rows);
        }
        return Base64.getEncoder().encodeToString(xlsxWrite(full));
    }

    @Test
    void test_template_round_trip() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestResponse r = o.get(A + "/golive/template");
        assertEquals(200, r.statusCode());
        byte[] content = r.content();
        assertTrue(content.length >= 2 && content[0] == 'P' && content[1] == 'K');
        Map<String, List<List<String>>> sheets = xlsxRead(content);
        List<String> sheetNames = new ArrayList<>(sheets.keySet());
        assertEquals(List.of("Clients", "Suppliers"), sheetNames.subList(0, 2));
        assertTrue(sheets.get("Clients").get(1).get(0).startsWith("e.g."));
        assertEquals("2026-10-27", excelDate(46322));
        assertEquals("2026-10-27", excelDate("27/10/2026"));
        assertEquals(403, p.get("manager").get(A + "/golive/template").statusCode());
    }

    @Test
    void test_import_check_then_save_then_go_live() {
        Map<String, TestClient> p = people();
        TestClient o = p.get("owner");
        TestClient a = p.get("admin");
        TestClient m = p.get("manager");

        Map<String, List<List<String>>> inputSheets = new LinkedHashMap<>();
        inputSheets.put("clients", List.of(List.of("Hill Café (test)", "9000011111", "Jubilee Hills")));
        inputSheets.put("suppliers", List.of(List.of("Estate One (test)", "", "")));
        inputSheets.put("counter_customers", List.of(
                List.of("+91 90000 22222", "Ravi"),
                List.of("12", "bad")
        ));
        inputSheets.put("beans_products", List.of(
                List.of("Test Arabica PB", "Green coffee", "50", "TAPB"),
                List.of("Test Chicory", "Chicory", "", "")
        ));
        inputSheets.put("opening_stock", List.of(
                List.of("Test Arabica PB", "Raw", "Sound", "4", "200", "Production", ""),
                List.of("Test Arabica PB", "Ground", "", "", "6.5", "Counter", "2026-10-01"),
                List.of("Test Chicory", "Raw", "Sound", "", "10", "Counter", ""),
                List.of("Nope bean", "Raw", "", "", "5", "Production", ""),
                List.of("Test Arabica PB", "Roasted", "", "", "3", "Production", "")
        ));
        inputSheets.put("old_dues", List.of(
                List.of("Client owes us", "Hill Café (test)", "12,500", "2026-09-30", "2026-11-15", "Sept"),
                List.of("We owe supplier", "Estate One (test)", "40000", "", "", ""),
                List.of("Staff advance", "Demo Packer", "2000", "", "", "festival"),
                List.of("Client owes us", "Unknown Café", "100", "", "", "")
        ));
        String data = book(inputSheets);

        JsonNode check = ok(a.post(A + "/golive/import", Map.of("data", data))).path("report");
        assertEquals(3, check.path("Opening stock").path("ok").asInt());
        assertEquals(2, check.path("Opening stock").path("errors").size());
        assertEquals(3, check.path("Old dues").path("ok").asInt());
        assertTrue(check.path("Old dues").path("errors").get(0).asText().contains("UNKNOWN_CLIENT"));
        assertEquals(1, check.path("Counter customers").path("ok").asInt());
        assertTrue(check.path("Counter customers").path("errors").size() > 0);
        assertFalse(anyMatch(ok(o.get(A + "/masters?kind=customer")), x -> "Hill Café (test)".equals(x.path("name").asText()))); // check saves nothing

        JsonNode saved = ok(a.post(A + "/golive/import", mapOf("data", data, "apply", true))).path("report");
        assertEquals(1, saved.path("Clients").path("ok").asInt());
        assertEquals(2, saved.path("Beans & products").path("ok").asInt());

        String againBook = book(Map.of("clients", List.of(List.of("Hill Café (test)", "", ""))));
        JsonNode again = ok(a.post(A + "/golive/import", mapOf("data", againBook, "apply", true))).path("report");
        assertEquals(0, again.path("Clients").path("ok").asInt());
        assertTrue(again.path("Clients").path("skipped").size() > 0);

        JsonNode g = ok(a.get(A + "/golive"));
        assertEquals("SETUP", g.path("state").path("state").asText());
        assertEquals(3, g.path("stock").size());
        assertEquals(3, g.path("dues").size());

        // nothing is stock until the owner confirms; only the owner may
        assertEquals("ONLY_OWNER_CONFIRMS", ok(a.post(A + "/golive/confirm", Map.of("cash_paise", 250000)), 403).path("error").asText());
        ok(m.post(A + "/golive/stock", Map.of()), 403);
        JsonNode r = ok(o.post(A + "/golive/confirm", Map.of("cash_paise", 250000)));
        assertEquals(3, r.path("stock_lots").asInt());
        assertEquals(3, r.path("dues").asInt());

        List<JsonNode> inv = stream(ok(o.get(A + "/inventory")))
                .filter(x -> {
                    String b = x.hasNonNull("bean") ? x.path("bean").asText() : x.path("product").asText("");
                    return b.startsWith("Test");
                })
                .toList();
        List<Double> kgs = inv.stream().map(x -> Math.round(x.path("kg").asDouble() * 1000.0) / 1000.0).sorted().toList();
        assertEquals(List.of(6.5, 10.0, 200.0), kgs);
        assertTrue(inv.stream().anyMatch(x -> "CTR-01".equals(x.path("location").asText())
                && "GROUND".equals(x.path("stage").asText())
                && "2026-10-01".equals(x.path("roasted_on").asText())));
        assertTrue(ok(o.get(A + "/counter/setup")).path("stock").path("coffee_ground").asDouble() >= 6.5);

        // locked after go-live; masters can still be imported
        assertEquals("ALREADY_LIVE",
                ok(a.post(A + "/golive/dues", mapOf("side", "Staff advance", "name", "Demo Packer", "amount", "1")), 400).path("error").asText());
        String lateBook = book(Map.of(
                "clients", List.of(List.of("Later Café (test)", "", "")),
                "opening_stock", List.of(List.of("Test Chicory", "Raw", "", "", "1", "Counter", ""))
        ));
        JsonNode late = ok(a.post(A + "/golive/import", mapOf("data", lateBook, "apply", true))).path("report");
        assertEquals(1, late.path("Clients").path("ok").asInt());
        assertEquals(1, late.path("Opening stock").path("errors").size());
        assertEquals("ALREADY_LIVE", late.path("Opening stock").path("errors").get(0).asText());

        // old dues in Finance: record by one person, verify by another
        JsonNode dues = ok(o.get(A + "/opening-dues")).path("dues");
        JsonNode cafe = findFirst(dues, d -> "CLIENT".equals(d.path("side").asText()));
        int cafeId = cafe.path("id").asInt();
        assertEquals(1250000, cafe.path("amount_paise").asInt());
        assertEquals(1250000, cafe.path("due_paise").asInt());
        assertEquals("9000011111", cafe.path("party_phone").asText());

        ok(m.post(A + "/opening-dues/" + cafeId + "/payments", mapOf(
                "amount_paise", 500000,
                "method", "UPI",
                "reference", "UTR1"
        )));
        assertEquals("MORE_THAN_DUE",
                ok(m.post(A + "/opening-dues/" + cafeId + "/payments", mapOf("amount_paise", 900000, "method", "UPI")), 400).path("error").asText());
        int pid = ok(o.get(A + "/opening-dues")).path("pending").get(0).path("id").asInt();
        String verifyErr = ok(m.post(A + "/opening-due-payments/" + pid + "/verify", Map.of("approve", true)), 403).path("error").asText();
        assertTrue(Set.of("CANNOT_APPROVE_OWN_REQUEST", "ACCESS_DENIED").contains(verifyErr));
        ok(o.post(A + "/opening-due-payments/" + pid + "/verify", Map.of("approve", true)));
        assertEquals(750000, findFirst(ok(o.get(A + "/opening-dues")).path("dues"), d -> d.path("id").asInt() == cafeId)
                .path("due_paise").asInt());
        assertEquals("ALREADY_LIVE", ok(o.post(A + "/golive/confirm", Map.of()), 400).path("error").asText());
    }
}
