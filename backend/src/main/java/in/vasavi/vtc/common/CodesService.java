package in.vasavi.vtc.common;

import in.vasavi.vtc.db.Db;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class CodesService {

    public static final Pattern BEAN_CODE = Pattern.compile("^[A-Z0-9]{2,6}$");
    public static final Map<String, String> KIND_SUFFIX = Map.of(
            "SOUND", "",
            "DAMAGED", "D",
            "PARTIAL", "P"
    );
    public static final Map<String, String> STAGE_PREFIX = Map.of(
            "RAW", "RAW",
            "ROASTED", "RST",
            "GROUND", "GRD",
            "BLENDED", "BLD",
            "PACKED", "PCK"
    );
    private static final Set<String> STOP_WORDS = Set.of("COFFEE", "GREEN", "RAW", "BEAN", "BEANS", "GRADE", "ESTATE", "THE", "AND", "OF");
    private static final Pattern WORD_RE = Pattern.compile("[A-Za-z0-9]+");
    private static final Pattern TAIL_NUM = Pattern.compile("(\\d+)(?:-[DP])?$");

    private final Db db;

    public CodesService(Db db) {
        this.db = db;
    }

    private static final Set<String> RESERVED = Set.of("MIX", "LOT", "IN", "CUS", "TRF", "CTR", "LOS", "RAW", "RST", "GRD", "BLD", "PCK");

    public String suggest(String name, Set<String> taken) {
        List<String> words = new ArrayList<>();
        if (name != null) {
            Matcher m = Pattern.compile("[A-Za-z0-9]+").matcher(name);
            while (m.find()) {
                words.add(m.group());
            }
        }
        if (words.isEmpty()) words.add("X");

        StringBuilder sb = new StringBuilder();
        sb.append(words.get(0).substring(0, Math.min(3, words.get(0).length())));
        for (int i = 1; i < words.size(); i++) {
            String w = words.get(i);
            boolean isUpperOrDigit = true;
            for (char c : w.toCharArray()) {
                if (!Character.isUpperCase(c) && !Character.isDigit(c)) {
                    isUpperOrDigit = false;
                    break;
                }
            }
            if (isUpperOrDigit && w.length() <= 3) {
                sb.append(w);
            } else {
                sb.append(w.charAt(0));
            }
        }
        String code = sb.toString().toUpperCase();
        if (code.length() > 6) code = code.substring(0, 6);
        if (code.length() < 2) code = (code + "XX").substring(0, 2);

        if (!taken.contains(code)) return code;
        for (int i = 2; i < 100; i++) {
            String suf = String.valueOf(i);
            int trim = Math.min(code.length(), 6 - suf.length());
            String alt = code.substring(0, trim) + suf;
            if (!taken.contains(alt)) return alt;
        }
        throw new IllegalStateException("no free bean code");
    }

    public Set<String> takenCodes() {
        Set<String> set = new LinkedHashSet<>(RESERVED);
        for (Map<String, Object> r : db.rows("SELECT code FROM masters WHERE kind='product' AND code IS NOT NULL AND code<>''")) {
            set.add((String) r.get("code"));
        }
        return set;
    }

    public String beanCode(Long productId) {
        if (productId == null) {
            return "MIX";
        }
        Map<String, Object> r = db.one("SELECT code, name FROM masters WHERE id=?", productId);
        if (r == null) {
            return "MIX";
        }
        String code = (String) r.get("code");
        if (code != null && !code.isBlank()) {
            return code;
        }
        String newCode = suggest((String) r.get("name"), takenCodes());
        db.exec("UPDATE masters SET code=? WHERE id=?", newCode, productId);
        return newCode;
    }

    private int nextN(String table, String pattern) {
        int max = 0;
        String queryPattern = pattern.endsWith("%") ? pattern : pattern + "%";
        for (Map<String, Object> r : db.rows("SELECT code FROM " + table + " WHERE code LIKE ?", queryPattern)) {
            String s = (String) r.get("code");
            if (s != null && s.contains("-")) {
                String tail = s.substring(s.lastIndexOf('-') + 1);
                Matcher m = Pattern.compile("(\\d+)").matcher(tail);
                if (m.find()) {
                    max = Math.max(max, Integer.parseInt(m.group(1)));
                }
            }
        }
        return max + 1;
    }

    public record ReceiptCode(String code, int seq) {}

    public ReceiptCode receiptCode() {
        return receiptCode(Times.compactDayIst());
    }

    public ReceiptCode receiptCode(String d) {
        String prefix = "IN-" + d + "-";
        int n = nextN("receipts", prefix);
        return new ReceiptCode(String.format("%s%02d", prefix, n), n);
    }

    public String lotCode(String stage, Long productId, Long beanId, String bagKind, String d, Integer seq) {
        String dStr = d != null ? d : Times.compactDayIst();
        String pfx = STAGE_PREFIX.getOrDefault(stage, "LOT");
        String b = "BLENDED".equals(stage) && productId == null && beanId == null
                ? "BLD"
                : beanCode(beanId != null ? beanId : productId);
        String stem = pfx + "-" + b + "-" + dStr + "-";
        int n = seq != null ? seq : nextN("lots", pfx + "-%-" + dStr + "-%");
        String suf = bagKind != null ? KIND_SUFFIX.getOrDefault(bagKind, "") : "";
        return String.format("%s%02d%s", stem, n, suf);
    }

    public String lotCode(String stage, Long productId, Long beanId, String owner, String prefix) {
        String d = Times.compactDayIst();
        String pfx;
        String b;
        if (owner != null && !"VTC".equalsIgnoreCase(owner)) {
            pfx = "CUS";
            b = STAGE_PREFIX.getOrDefault(stage, "LOT");
        } else {
            pfx = prefix != null ? prefix : STAGE_PREFIX.getOrDefault(stage, "LOT");
            b = ("BLENDED".equals(stage) && productId == null && beanId == null)
                    ? "BLD"
                    : beanCode(beanId != null ? beanId : productId);
        }
        int n = nextN("lots", pfx + "-%-" + d + "-%");
        return String.format("%s-%s-%s-%02d", pfx, b, d, n);
    }

    public String isoDay() {
        return LocalDate.now(ZoneId.of("Asia/Kolkata")).toString();
    }

    public String code(String key, String def) {
        Object val = db.getSetting(key);
        return val != null ? val.toString() : def;
    }

    public String nextCode(String table, String column, String prefix) {
        String stem = prefix + "-" + LocalDate.now(ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ofPattern("yyMM")) + "-";
        int count = db.queryForInt("SELECT COUNT(*) FROM " + table + " WHERE " + column + " LIKE ?", stem + "%");
        return String.format("%s%04d", stem, count + 1);
    }
}
