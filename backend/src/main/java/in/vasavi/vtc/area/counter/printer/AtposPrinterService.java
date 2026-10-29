package in.vasavi.vtc.area.counter.printer;

import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.db.Db;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.print.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * High-performance ESC/POS Printer Service for ATPOS 80mm & 58mm Thermal Printers.
 * Handles raw ESC/POS protocol encoding, dynamic BharatQR / UPI QR code generation,
 * Network TCP socket printing (port 9100), Windows Print Spooler raw printing,
 * auto paper cutting, and cash drawer kick pulses.
 */
@Service
public class AtposPrinterService {

    private static final Logger log = LoggerFactory.getLogger(AtposPrinterService.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter IST_FORMATTER = DateTimeFormatter.ofPattern("dd/MM/yyyy hh:mm a");

    // Standard ESC/POS Command Constants
    private static final byte[] ESC_INIT = {0x1B, 0x40}; // ESC @
    private static final byte[] ESC_ALIGN_LEFT = {0x1B, 0x61, 0x00}; // ESC a 0
    private static final byte[] ESC_ALIGN_CENTER = {0x1B, 0x61, 0x01}; // ESC a 1
    private static final byte[] ESC_ALIGN_RIGHT = {0x1B, 0x61, 0x02}; // ESC a 2
    private static final byte[] ESC_BOLD_ON = {0x1B, 0x45, 0x01}; // ESC E 1
    private static final byte[] ESC_BOLD_OFF = {0x1B, 0x45, 0x00}; // ESC E 0
    private static final byte[] GS_DOUBLE_SIZE = {0x1D, 0x21, 0x11}; // GS ! 17 (Double width & height)
    private static final byte[] GS_NORMAL_SIZE = {0x1D, 0x21, 0x00}; // GS ! 0
    private static final byte[] ESC_DRAWER_KICK = {0x1B, 0x70, 0x00, 0x19, (byte) 0xFA}; // ESC p 0 25 250 (pulse 50ms)
    private static final byte[] GS_PARTIAL_CUT = {0x1D, 0x56, 0x42, 0x00}; // GS V 66 0 (Feed and cut)

    private final Db db;

    public AtposPrinterService(Db db) {
        this.db = db;
    }

    /**
     * Builds raw ESC/POS binary data for an 80mm or 58mm ATPOS thermal bill.
     */
    @SuppressWarnings("unchecked")
    public byte[] buildSaleReceipt(Map<String, Object> bill, boolean duplicate, String copyLabel, int paperWidth) {
        int cols = paperWidth <= 58 ? 32 : 48;
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        try {
            // 1. Initialize Printer
            out.write(ESC_INIT);

            // Optional Cash Drawer Kick on Cash payment
            boolean hasCash = false;
            Object paysObj = bill.get("payments");
            if (paysObj instanceof List<?> pays) {
                for (Object p : pays) {
                    if (p instanceof Map<?, ?> pm && "CASH".equalsIgnoreCase(String.valueOf(pm.get("method")))) {
                        hasCash = true;
                        break;
                    }
                }
            }
            if (hasCash) {
                out.write(ESC_DRAWER_KICK);
            }

            // 2. Header
            out.write(ESC_ALIGN_CENTER);
            out.write(ESC_BOLD_ON);
            out.write(GS_DOUBLE_SIZE);
            Map<String, Object> header = (Map<String, Object>) bill.getOrDefault("header", Map.of());
            String companyName = header.get("company_name") != null ? header.get("company_name").toString().toUpperCase() : "VASAVI TRADING COMPANY";
            out.write((companyName + "\n").getBytes(StandardCharsets.UTF_8));

            out.write(GS_NORMAL_SIZE);
            out.write(ESC_BOLD_OFF);

            String address = header.get("company_address") != null ? header.get("company_address").toString() : "Coffee Roasters & Wholesale Merchants";
            if (!address.isBlank()) {
                out.write((address + "\n").getBytes(StandardCharsets.UTF_8));
            }

            String gstin = header.get("company_gstin") != null ? header.get("company_gstin").toString() : "";
            if (!gstin.isBlank()) {
                out.write(("GSTIN: " + gstin + "\n").getBytes(StandardCharsets.UTF_8));
            }

            out.write(ESC_BOLD_ON);
            out.write("RETAIL TAX INVOICE / CASH MEMO\n".getBytes(StandardCharsets.UTF_8));
            if (copyLabel != null && !copyLabel.isBlank()) {
                out.write(("[" + copyLabel + "]\n").getBytes(StandardCharsets.UTF_8));
            }
            if (duplicate) {
                Object reps = bill.getOrDefault("reprints", 1);
                out.write(("*** DUPLICATE COPY #" + reps + " ***\n").getBytes(StandardCharsets.UTF_8));
            }
            out.write(ESC_BOLD_OFF);

            // Separator
            out.write(line(cols).getBytes(StandardCharsets.UTF_8));

            // 3. Bill Metadata
            out.write(ESC_ALIGN_LEFT);
            String billNo = String.valueOf(bill.getOrDefault("bill_no", ""));
            String createdAtStr = String.valueOf(bill.getOrDefault("created_at", ""));
            String formattedDate = formatIstDate(createdAtStr);

            out.write(twoCols("Bill: " + billNo, formattedDate, cols).getBytes(StandardCharsets.UTF_8));

            String cashier = String.valueOf(bill.getOrDefault("cashier", "Staff"));
            String customerName = String.valueOf(bill.getOrDefault("customer_name", ""));
            String customerPhone = String.valueOf(bill.getOrDefault("customer_phone", ""));

            StringBuilder custLine = new StringBuilder("Cashier: " + cashier);
            if (!customerName.isBlank()) {
                custLine.append(" | Customer: ").append(customerName);
            }
            if (!customerPhone.isBlank()) {
                custLine.append(" (").append(customerPhone).append(")");
            }
            out.write((wrapText(custLine.toString(), cols) + "\n").getBytes(StandardCharsets.UTF_8));

            out.write(line(cols).getBytes(StandardCharsets.UTF_8));

            // 4. Line Items Table Header
            out.write(ESC_BOLD_ON);
            if (cols >= 48) {
                out.write(String.format("%-24s %13s %9s\n", "Item Description", "Qty x Rate", "Amount").getBytes(StandardCharsets.UTF_8));
            } else {
                out.write(String.format("%-14s %8s %8s\n", "Item", "Qty", "Amount").getBytes(StandardCharsets.UTF_8));
            }
            out.write(ESC_BOLD_OFF);
            out.write(line(cols).getBytes(StandardCharsets.UTF_8));

            // 5. Line Items Rows
            Object linesObj = bill.get("lines");
            if (linesObj instanceof List<?> lines) {
                for (Object itemObj : lines) {
                    if (itemObj instanceof Map) {
                        Map<String, Object> lineMap = (Map<String, Object>) itemObj;
                        String itemName = lineMap.get("item_name") != null ? lineMap.get("item_name").toString() : "Item";
                        double weightKg = lineMap.get("weight_kg") != null ? ((Number) lineMap.get("weight_kg")).doubleValue() : 0.0;
                        long ratePaise = lineMap.get("rate_paise") != null ? ((Number) lineMap.get("rate_paise")).longValue() : 0L;
                        long amountPaise = lineMap.get("amount_paise") != null ? ((Number) lineMap.get("amount_paise")).longValue() : 0L;

                        String weightStr = formatKg(weightKg);
                        String rateStr = formatRupeeShort(ratePaise);
                        String amountStr = formatRupeeShort(amountPaise);

                        if (cols >= 48) {
                            String qtyRateStr = weightStr + "x" + rateStr;
                            if (itemName.length() > 24) {
                                out.write((itemName + "\n").getBytes(StandardCharsets.UTF_8));
                                out.write(String.format("%24s %13s %9s\n", "", qtyRateStr, amountStr).getBytes(StandardCharsets.UTF_8));
                            } else {
                                out.write(String.format("%-24s %13s %9s\n", itemName, qtyRateStr, amountStr).getBytes(StandardCharsets.UTF_8));
                            }
                        } else {
                            if (itemName.length() > 14) {
                                out.write((itemName + "\n").getBytes(StandardCharsets.UTF_8));
                                out.write(String.format("%14s %8s %8s\n", "", weightStr, amountStr).getBytes(StandardCharsets.UTF_8));
                            } else {
                                out.write(String.format("%-14s %8s %8s\n", itemName, weightStr, amountStr).getBytes(StandardCharsets.UTF_8));
                            }
                        }
                    }
                }
            }

            out.write(line(cols).getBytes(StandardCharsets.UTF_8));

            // 6. Totals & Discount
            long subtotalPaise = ((Number) bill.getOrDefault("subtotal_paise", 0L)).longValue();
            long discountPaise = ((Number) bill.getOrDefault("discount_paise", 0L)).longValue();
            long totalPaise = ((Number) bill.getOrDefault("total_paise", 0L)).longValue();

            out.write(twoCols("Subtotal:", "Rs. " + formatRupee(subtotalPaise), cols).getBytes(StandardCharsets.UTF_8));

            if (discountPaise > 0) {
                String dReason = String.valueOf(bill.getOrDefault("discount_reason", ""));
                String dLabel = "Discount" + (!dReason.isBlank() ? " (" + dReason + "):" : ":");
                out.write(twoCols(dLabel, "- Rs. " + formatRupee(discountPaise), cols).getBytes(StandardCharsets.UTF_8));
            }

            out.write(line(cols).getBytes(StandardCharsets.UTF_8));

            // 7. Grand Total (Double size + bold)
            out.write(ESC_ALIGN_LEFT);
            out.write(ESC_BOLD_ON);
            out.write(GS_DOUBLE_SIZE);
            String grandTotalStr = "Rs. " + formatRupee(totalPaise);
            out.write(twoCols("NET TOTAL:", grandTotalStr, cols / 2).getBytes(StandardCharsets.UTF_8));
            out.write(GS_NORMAL_SIZE);
            out.write(ESC_BOLD_OFF);

            out.write(line(cols).getBytes(StandardCharsets.UTF_8));

            // 8. Payment Breakdown
            out.write(ESC_BOLD_ON);
            out.write("PAYMENT DETAILS:\n".getBytes(StandardCharsets.UTF_8));
            out.write(ESC_BOLD_OFF);

            if (paysObj instanceof List<?> pays) {
                for (Object p : pays) {
                    if (p instanceof Map) {
                        Map<String, Object> pm = (Map<String, Object>) p;
                        String method = pm.get("method") != null ? pm.get("method").toString() : "CASH";
                        long amtPaise = pm.get("amount_paise") != null ? ((Number) pm.get("amount_paise")).longValue() : 0L;
                        String ref = pm.get("reference") != null ? pm.get("reference").toString() : "";
                        String mStr = method + (!ref.isBlank() ? " (" + ref + ")" : "");
                        out.write(twoCols("  " + mStr, "Rs. " + formatRupee(amtPaise), cols).getBytes(StandardCharsets.UTF_8));
                    }
                }
            }

            // 9. Dynamic UPI QR Code Generation
            String upiVpa = (String) db.getSetting("upi_vpa");
            if (upiVpa == null || upiVpa.isBlank()) {
                upiVpa = "vasavitrading@okhdfcbank";
            }
            double totalRupees = totalPaise / 100.0;
            String upiPayload = String.format("upi://pay?pa=%s&pn=Vasavi%%20Trading%%20Company&am=%.2f&cu=INR&tn=Bill%%20%s",
                    upiVpa, totalRupees, billNo);

            out.write(ESC_ALIGN_CENTER);
            out.write("\nScan to Pay / Verify UPI:\n".getBytes(StandardCharsets.UTF_8));
            byte[] qrBytes = buildEscPosQrCode(upiPayload);
            out.write(qrBytes);

            // 10. Footer Notes
            out.write(ESC_ALIGN_CENTER);
            out.write("\nThank You For Visiting Vasavi Trading Company!\n".getBytes(StandardCharsets.UTF_8));
            out.write("Freshly Roasted & Ground Coffee Beans\n".getBytes(StandardCharsets.UTF_8));
            out.write("Store coffee powder in an airtight glass/steel tin.\n".getBytes(StandardCharsets.UTF_8));
            out.write("Quality Guaranteed · Estd. 1965\n\n".getBytes(StandardCharsets.UTF_8));

            // Feed 4 lines before cut
            out.write(new byte[]{0x1B, 0x64, 0x04});

            // Auto partial paper cut
            out.write(GS_PARTIAL_CUT);

        } catch (IOException e) {
            log.error("Failed to build ESC/POS receipt data", e);
            throw new ApiException("PRINTER_ENCODE_ERROR", 500);
        }

        return out.toByteArray();
    }

    /**
     * Builds standard diagnostic test slip to verify ATPOS printer hardware.
     */
    public byte[] buildTestReceipt(int paperWidth) {
        int cols = paperWidth <= 58 ? 32 : 48;
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        try {
            out.write(ESC_INIT);
            out.write(ESC_DRAWER_KICK); // Test cash drawer kick

            out.write(ESC_ALIGN_CENTER);
            out.write(ESC_BOLD_ON);
            out.write(GS_DOUBLE_SIZE);
            out.write("ATPOS PRINTER TEST\n".getBytes(StandardCharsets.UTF_8));
            out.write(GS_NORMAL_SIZE);
            out.write(ESC_BOLD_OFF);

            out.write(twoCols("Model:", "ATPOS 80mm/58mm POS", cols).getBytes(StandardCharsets.UTF_8));
            out.write(twoCols("Interface:", "USB / Serial / TCP 9100", cols).getBytes(StandardCharsets.UTF_8));
            out.write(twoCols("Columns:", cols + " cols", cols).getBytes(StandardCharsets.UTF_8));
            out.write(twoCols("Time:", IST_FORMATTER.format(Instant.now().atZone(IST)), cols).getBytes(StandardCharsets.UTF_8));
            out.write(line(cols).getBytes(StandardCharsets.UTF_8));

            out.write(ESC_ALIGN_LEFT);
            out.write("1. Font Regular: ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890\n".getBytes(StandardCharsets.UTF_8));
            out.write(ESC_BOLD_ON);
            out.write("2. Font Bold: ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890\n".getBytes(StandardCharsets.UTF_8));
            out.write(ESC_BOLD_OFF);

            out.write(line(cols).getBytes(StandardCharsets.UTF_8));
            out.write(ESC_ALIGN_CENTER);
            out.write("Dynamic Test QR Code:\n".getBytes(StandardCharsets.UTF_8));
            out.write(buildEscPosQrCode("https://vasavitrading.in/pos-test"));

            out.write("\n*** ATPOS HARDWARE READY ***\n".getBytes(StandardCharsets.UTF_8));
            out.write("Cash Drawer Pulse: SUCCESS\n".getBytes(StandardCharsets.UTF_8));
            out.write("Auto-Cutter: SUCCESS\n\n".getBytes(StandardCharsets.UTF_8));

            out.write(new byte[]{0x1B, 0x64, 0x03});
            out.write(GS_PARTIAL_CUT);

        } catch (IOException e) {
            log.error("Failed to build test receipt", e);
        }

        return out.toByteArray();
    }

    /**
     * Sends raw ESC/POS bytes to an ATPOS Network Thermal Printer via TCP Socket (Port 9100).
     */
    public void printViaNetwork(String host, int port, byte[] data) {
        if (host == null || host.isBlank()) {
            throw new ApiException("PRINTER_IP_REQUIRED", 400);
        }
        int targetPort = port > 0 ? port : 9100;

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, targetPort), 3500);
            socket.setSoTimeout(5000);
            try (OutputStream os = socket.getOutputStream()) {
                os.write(data);
                os.flush();
            }
            log.info("Successfully sent {} bytes to ATPOS printer at {}:{}", data.length, host, targetPort);
        } catch (Exception e) {
            log.error("Failed to connect to ATPOS printer at {}:{}", host, targetPort, e);
            throw new ApiException("ATPOS_PRINTER_OFFLINE", 503);
        }
    }

    /**
     * Sends raw ESC/POS bytes to an installed Windows ATPOS Print Spooler queue via Java Print Service.
     */
    public void printViaSpooler(String printerName, byte[] data) {
        PrintService targetService = findPrintService(printerName);
        if (targetService == null) {
            throw new ApiException("PRINTER_DRIVER_NOT_FOUND", 404);
        }

        try {
            DocFlavor flavor = DocFlavor.BYTE_ARRAY.AUTOSENSE;
            Doc doc = new SimpleDoc(data, flavor, null);
            DocPrintJob printJob = targetService.createPrintJob();
            printJob.print(doc, null);
            log.info("Successfully spooled {} bytes to Windows printer '{}'", data.length, targetService.getName());
        } catch (PrintException e) {
            log.error("Windows print spooler error for printer '{}'", printerName, e);
            throw new ApiException("PRINTER_SPOOLER_ERROR", 500);
        }
    }

    /**
     * Scans and returns all available Windows Print Spooler service names.
     */
    public List<Map<String, Object>> listAvailablePrinters() {
        List<Map<String, Object>> result = new ArrayList<>();
        try {
            PrintService[] services = PrintServiceLookup.lookupPrintServices(null, null);
            PrintService defaultService = PrintServiceLookup.lookupDefaultPrintService();

            for (PrintService ps : services) {
                String name = ps.getName();
                boolean isDefault = defaultService != null && defaultService.getName().equals(name);
                boolean isPosMatch = name.toUpperCase().matches(".*(ATPOS|POS|THERMAL|80|58|RECEIPT|BILL).*");

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("name", name);
                item.put("is_default", isDefault);
                item.put("is_pos_matched", isPosMatch);
                result.add(item);
            }
        } catch (Exception e) {
            log.warn("Error listing local print services", e);
        }
        return result;
    }

    /**
     * Fires cash drawer pulse directly to ATPOS printer.
     */
    public void kickCashDrawer(String host, int port, String printerName) {
        byte[] kickBytes = new byte[]{0x1B, 0x40, 0x1B, 0x70, 0x00, 0x19, (byte) 0xFA};
        if (host != null && !host.isBlank()) {
            printViaNetwork(host, port, kickBytes);
        } else if (printerName != null && !printerName.isBlank()) {
            printViaSpooler(printerName, kickBytes);
        } else {
            PrintService def = PrintServiceLookup.lookupDefaultPrintService();
            if (def != null) {
                printViaSpooler(def.getName(), kickBytes);
            } else {
                throw new ApiException("NO_PRINTER_CONFIGURED", 400);
            }
        }
    }

    // --- Helper Formatting Utilities ---

    private PrintService findPrintService(String printerName) {
        PrintService[] services = PrintServiceLookup.lookupPrintServices(null, null);
        if (printerName != null && !printerName.isBlank()) {
            for (PrintService ps : services) {
                if (ps.getName().equalsIgnoreCase(printerName.trim())) {
                    return ps;
                }
            }
            for (PrintService ps : services) {
                if (ps.getName().toLowerCase().contains(printerName.toLowerCase().trim())) {
                    return ps;
                }
            }
        }
        return PrintServiceLookup.lookupDefaultPrintService();
    }

    private static String line(int cols) {
        return "-".repeat(cols) + "\n";
    }

    private static String twoCols(String left, String right, int width) {
        int space = width - left.length() - right.length();
        if (space < 1) {
            space = 1;
        }
        return left + " ".repeat(space) + right + "\n";
    }

    private static String wrapText(String text, int width) {
        if (text.length() <= width) return text;
        StringBuilder sb = new StringBuilder();
        int idx = 0;
        while (idx < text.length()) {
            int end = Math.min(idx + width, text.length());
            sb.append(text, idx, end);
            if (end < text.length()) sb.append("\n");
            idx = end;
        }
        return sb.toString();
    }

    private static String formatRupee(long paise) {
        return new DecimalFormat("#,##0.00").format(paise / 100.0);
    }

    private static String formatRupeeShort(long paise) {
        return new DecimalFormat("0.00").format(paise / 100.0);
    }

    private static String formatKg(double kg) {
        if (kg >= 1.0) {
            return new DecimalFormat("0.000").format(kg) + "kg";
        } else {
            return (int) Math.round(kg * 1000) + "g";
        }
    }

    private static String formatIstDate(String dateStr) {
        try {
            Instant instant = Instant.parse(dateStr);
            return IST_FORMATTER.format(instant.atZone(IST));
        } catch (Exception e) {
            return IST_FORMATTER.format(Instant.now().atZone(IST));
        }
    }

    /**
     * Builds ESC/POS 2D QR Code native binary command sequence (GS ( k).
     */
    private static byte[] buildEscPosQrCode(String data) throws IOException {
        ByteArrayOutputStream qros = new ByteArrayOutputStream();
        byte[] payload = data.getBytes(StandardCharsets.UTF_8);
        int len = payload.length + 3;

        // 1. Select Model 2: GS ( k 4 0 49 65 50 0
        qros.write(new byte[]{0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00});

        // 2. Set Module Size 6: GS ( k 3 0 49 67 6
        qros.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06});

        // 3. Set Error Correction Level M: GS ( k 3 0 49 69 49
        qros.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31});

        // 4. Store Data in symbol storage: GS ( k pL pH 49 80 48 d1...dk
        byte pL = (byte) (len & 0xFF);
        byte pH = (byte) ((len >> 8) & 0xFF);
        qros.write(new byte[]{0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30});
        qros.write(payload);

        // 5. Print the QR symbol: GS ( k 3 0 49 81 48
        qros.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30});

        return qros.toByteArray();
    }
}
