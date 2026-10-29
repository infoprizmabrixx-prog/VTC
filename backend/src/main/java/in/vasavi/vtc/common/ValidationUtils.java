package in.vasavi.vtc.common;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;

public final class ValidationUtils {

    private ValidationUtils() {
    }

    /**
     * Banker's rounding (half-to-even) to 3 decimal places, matching Python round(x, 3).
     */
    public static double r3(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x)) {
            return 0.0;
        }
        return BigDecimal.valueOf(x).setScale(3, RoundingMode.HALF_EVEN).doubleValue();
    }

    public static double number(Map<String, Object> d, String key) {
        return number(d, key, false);
    }

    public static double number(Map<String, Object> d, String key, boolean allowZero) {
        Object raw = d != null ? d.get(key) : null;
        if (raw == null || raw instanceof Boolean || "".equals(raw)) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        double val;
        try {
            val = raw instanceof Number n ? n.doubleValue() : Double.parseDouble(raw.toString().trim());
        } catch (NumberFormatException e) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        if (Double.isNaN(val) || Double.isInfinite(val)) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        if (val < 0 || (!allowZero && val == 0)) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        return val;
    }

    public static int integer(Map<String, Object> d, String key, int minimum) {
        Object raw = d != null ? d.get(key) : null;
        if (raw == null || raw instanceof Boolean) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        int val;
        if (raw instanceof Integer i) {
            val = i;
        } else if (raw instanceof Long l) {
            val = l.intValue();
        } else if (raw instanceof String s) {
            try {
                val = Integer.parseInt(s.trim());
            } catch (NumberFormatException e) {
                throw new ApiException("INVALID_" + key.toUpperCase());
            }
        } else {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        if (val < minimum) {
            throw new ApiException("INVALID_" + key.toUpperCase());
        }
        return val;
    }

    public static int integer(Map<String, Object> d, String key, int minimum, String errorDetail) {
        try {
            return integer(d, key, minimum);
        } catch (ApiException e) {
            throw new ApiException(errorDetail);
        }
    }

    public static String text(Map<String, Object> d, String key, int minLen, int maxLen, String code) {
        Object raw = d != null ? d.get(key) : null;
        String val = raw != null ? raw.toString().trim() : "";
        String errCode = code != null ? code : ("INVALID_" + key.toUpperCase());
        if (val.length() < minLen || val.length() > maxLen) {
            throw new ApiException(errCode);
        }
        return val;
    }

    public static String text(Map<String, Object> d, String key, int minLen, int maxLen) {
        return text(d, key, minLen, maxLen, null);
    }

    public static long paise(Map<String, Object> d, String key, boolean allowZero) {
        if (d != null && d.get(key + "_paise") != null && !"".equals(d.get(key + "_paise"))) {
            return integer(d, key + "_paise", allowZero ? 0 : 1);
        }
        double rupees = number(d, key, allowZero);
        long p = Math.round(rupees * 100.0);
        if (Math.abs(p - rupees * 100.0) > 1e-6) {
            throw new ApiException("MONEY_MAX_2_DECIMALS");
        }
        return p;
    }
}
