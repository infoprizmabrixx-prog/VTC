package in.vasavi.vtc.db;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.vasavi.vtc.common.Times;
import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.InputStream;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.regex.Pattern;

@Component
public class Db {

    private static final Pattern ISO_UTC = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$");
    private static final Pattern ISO_OFFSET = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?[+-]\\d{2}:\\d{2}$");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate txTemplate;
    private final TransactionTemplate newTxTemplate;
    private final ObjectMapper mapper;

    private Map<String, Object> defaultSettings = new LinkedHashMap<>();
    private Map<String, List<Object>> businessSettings = new LinkedHashMap<>();

    public Db(JdbcTemplate jdbc, PlatformTransactionManager txManager, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.txTemplate = new TransactionTemplate(txManager);
        this.newTxTemplate = new TransactionTemplate(txManager);
        this.newTxTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.mapper = mapper;
    }

    @PostConstruct
    public void initCatalogSettings() {
        try (InputStream is = new ClassPathResource("generated/settings.json").getInputStream()) {
            JsonNode root = mapper.readTree(is);
            defaultSettings = mapper.convertValue(root.get("DEFAULT_SETTINGS"), new TypeReference<>() {});
            businessSettings = mapper.convertValue(root.get("BUSINESS_SETTINGS"), new TypeReference<>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load generated/settings.json", e);
        }
    }

    public Map<String, Object> getDefaultSettings() {
        return defaultSettings;
    }

    public Map<String, List<Object>> getBusinessSettings() {
        return businessSettings;
    }

    public JdbcTemplate jdbc() {
        return jdbc;
    }

    public <T> T tx(Supplier<T> action) {
        return txTemplate.execute(status -> action.get());
    }

    public void txVoid(Runnable action) {
        txTemplate.executeWithoutResult(status -> action.run());
    }

    public <T> T newTx(Supplier<T> action) {
        return newTxTemplate.execute(status -> action.get());
    }

    public void newTxVoid(Runnable action) {
        newTxTemplate.executeWithoutResult(status -> action.run());
    }

    private Object[] normArgs(Object... args) {
        if (args == null || args.length == 0) {
            return new Object[0];
        }
        Object[] out = new Object[args.length];
        for (int i = 0; i < args.length; i++) {
            Object a = args[i];
            if (a instanceof String s) {
                if (ISO_UTC.matcher(s).matches() || ISO_OFFSET.matcher(s).matches()) {
                    Instant inst = Times.parse(s);
                    out[i] = Timestamp.from(inst);
                } else {
                    out[i] = s;
                }
            } else if (a instanceof Instant inst) {
                out[i] = Timestamp.from(inst);
            } else if (a instanceof Boolean b) {
                out[i] = b ? 1 : 0;
            } else {
                out[i] = a;
            }
        }
        return out;
    }

    private static Object normValue(Object val) {
        if (val == null) {
            return null;
        }
        if (val instanceof Timestamp ts) {
            return ts.toInstant().truncatedTo(ChronoUnit.SECONDS).toString();
        }
        if (val instanceof LocalDateTime ldt) {
            return ldt.toInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS).toString();
        }
        if (val instanceof Instant inst) {
            return inst.truncatedTo(ChronoUnit.SECONDS).toString();
        }
        if (val instanceof Date d) {
            return d.toLocalDate().toString();
        }
        if (val instanceof LocalDate ld) {
            return ld.toString();
        }
        if (val instanceof BigDecimal bd) {
            return bd.doubleValue();
        }
        if (val instanceof Boolean b) {
            return b ? 1 : 0;
        }
        return val;
    }

    private static final RowMapper<Map<String, Object>> MAP_ROW_MAPPER = (ResultSet rs, int rowNum) -> {
        ResultSetMetaData meta = rs.getMetaData();
        int count = meta.getColumnCount();
        Map<String, Object> row = new LinkedHashMap<>(count);
        for (int i = 1; i <= count; i++) {
            String col = meta.getColumnLabel(i);
            Object val = rs.getObject(i);
            row.put(col, normValue(val));
        }
        return row;
    };

    public List<Map<String, Object>> rows(String sql, Object... args) {
        return jdbc.query(sql, MAP_ROW_MAPPER, normArgs(args));
    }

    public Map<String, Object> one(String sql, Object... args) {
        List<Map<String, Object>> list = rows(sql, args);
        return list.isEmpty() ? null : list.get(0);
    }

    public <T> T val(Class<T> type, String sql, Object... args) {
        List<Map<String, Object>> list = rows(sql, args);
        if (list.isEmpty()) {
            return null;
        }
        Object v = list.get(0).values().iterator().next();
        if (v == null) {
            return null;
        }
        if (type == Long.class && v instanceof Number n) {
            return type.cast(n.longValue());
        }
        if (type == Integer.class && v instanceof Number n) {
            return type.cast(n.intValue());
        }
        if (type == Double.class && v instanceof Number n) {
            return type.cast(n.doubleValue());
        }
        if (type == String.class) {
            return type.cast(v.toString());
        }
        return type.cast(v);
    }

    public long count(String sql, Object... args) {
        Long v = val(Long.class, sql, args);
        return v != null ? v : 0L;
    }

    public int queryForInt(String sql, Object... args) {
        Integer v = val(Integer.class, sql, args);
        return v != null ? v : 0;
    }

    public long queryForLong(String sql, Object... args) {
        Long v = val(Long.class, sql, args);
        return v != null ? v : 0L;
    }

    public double queryForDouble(String sql, Object... args) {
        Double v = val(Double.class, sql, args);
        return v != null ? v : 0.0;
    }

    public List<Map<String, Object>> readJsonList(String json) {
        if (json == null || json.isBlank()) return new java.util.ArrayList<>();
        try {
            return mapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return new java.util.ArrayList<>();
        }
    }

    public Map<String, Object> readJsonMap(String json) {
        if (json == null || json.isBlank()) return new LinkedHashMap<>();
        try {
            return mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    public String toJson(Object obj) {
        try {
            return mapper.writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }

    public int exec(String sql, Object... args) {
        return jdbc.update(sql, normArgs(args));
    }

    public long insert(String sql, Object... args) {
        Object[] normalized = normArgs(args);
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            for (int i = 0; i < normalized.length; i++) {
                ps.setObject(i + 1, normalized[i]);
            }
            return ps;
        }, kh);
        Number key = kh.getKey();
        return key != null ? key.longValue() : 0L;
    }

    public Object getSetting(String key) {
        Map<String, Object> row = one("SELECT `value` FROM settings WHERE `key`=?", key);
        if (row != null && row.get("value") != null) {
            try {
                return mapper.readValue(row.get("value").toString(), Object.class);
            } catch (Exception e) {
                return row.get("value");
            }
        }
        return defaultSettings.get(key);
    }

    public Map<String, Object> allSettings() {
        Map<String, Object> out = new LinkedHashMap<>(defaultSettings);
        for (Map<String, Object> r : rows("SELECT `key`, `value` FROM settings")) {
            String k = (String) r.get("key");
            String v = (String) r.get("value");
            if (k != null && v != null) {
                try {
                    out.put(k, mapper.readValue(v, Object.class));
                } catch (Exception ignored) {
                }
            }
        }
        return out;
    }

    public void audit(Long userId, String action, String subject, String info, String category) {
        exec("INSERT INTO audit(user_id, category, action, subject, info, created_at) VALUES(?,?,?,?,?,?)",
                userId, category != null ? category : "operations", action, subject, info != null ? info : "", Times.stamp());
    }

    public void audit(Long userId, String action, String subject, String info) {
        audit(userId, action, subject, info, "operations");
    }

    public void audit(Long userId, String action, String subject) {
        audit(userId, action, subject, "", "operations");
    }

    public Map<String, Object> idemGet(Long userId, String op, String key) {
        if (key == null || key.isBlank()) {
            return null;
        }
        Map<String, Object> r = one("SELECT result FROM idem WHERE user_id=? AND operation=? AND idem_key=?",
                userId, op, key.substring(0, Math.min(80, key.length())));
        if (r == null || r.get("result") == null) {
            return null;
        }
        try {
            return mapper.readValue(r.get("result").toString(), new TypeReference<>() {});
        } catch (Exception e) {
            return null;
        }
    }

    public void idemSave(Long userId, String op, String key, Map<String, Object> res) {
        if (key == null || key.isBlank()) {
            return;
        }
        try {
            String json = mapper.writeValueAsString(res);
            exec("INSERT IGNORE INTO idem(user_id, operation, idem_key, result) VALUES(?,?,?,?)",
                    userId, op, key.substring(0, Math.min(80, key.length())), json);
        } catch (Exception ignored) {
        }
    }
}
