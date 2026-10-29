package in.vasavi.vtc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import javax.sql.DataSource;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class VtcTestBase {

    public static final String A = "/api/v1";

    public static final Map<String, String> PASSWORDS = Map.of(
            "owner", "VTC-Owner-Demo26",
            "admin", "VTC-Admin-Demo26",
            "manager", "VTC-Manager-Demo26"
    );

    public static final Map<String, String> PINS = Map.of(
            "roaster", "2580",
            "packer", "1470"
    );

    protected static final Path TEST_DIR;
    protected static final Path DB_PATH;
    protected static final Path FILES_DIR;

    static {
        try {
            TEST_DIR = Files.createTempDirectory("vtc-junit-");
            DB_PATH = TEST_DIR.resolve("test.sqlite3");
            FILES_DIR = TEST_DIR.resolve("files");
            Files.createDirectories(FILES_DIR);
            System.setProperty("VTC_DB", DB_PATH.toAbsolutePath().toString());
            System.setProperty("VTC_DEMO", "1");
            System.setProperty("VTC_FILES_DIR", FILES_DIR.toAbsolutePath().toString());
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("vtc.demo", () -> "1");
        registry.add("vtc.https", () -> "0");
        registry.add("vtc.files-dir", () -> FILES_DIR.toAbsolutePath().toString());
    }

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected ObjectMapper mapper;

    @Autowired
    protected ApplicationContext context;

    @BeforeEach
    void resetPortalBeforeEachTest() throws Exception {
        resetDatabase();
    }

    protected void resetDatabase() throws Exception {
        Object vtcDbBean = findVtcDbBean();
        if (vtcDbBean != null) {
            for (String mName : new String[]{"reset", "resetForTest", "reinit", "reinitialize"}) {
                try {
                    Method m = vtcDbBean.getClass().getMethod(mName);
                    m.invoke(vtcDbBean);
                    return;
                } catch (NoSuchMethodException ignored) {
                }
            }
            try {
                Method m = vtcDbBean.getClass().getMethod("resetAndSeedForTests", boolean.class);
                m.invoke(vtcDbBean, true);
                return;
            } catch (NoSuchMethodException ignored) {
            }
        }
        // Fallback: clear all tables and invoke init() / seed() / SeedRunner.ensureAll() if present
        try (Connection con = openJdbcConnection(); Statement st = con.createStatement()) {
            boolean isSqlite = con.getMetaData().getURL().contains("sqlite");
            if (isSqlite) {
                st.execute("PRAGMA foreign_keys = OFF");
                List<String> tables = new ArrayList<>();
                try (ResultSet rs = st.executeQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
                    while (rs.next()) {
                        tables.add(rs.getString(1));
                    }
                }
                for (String t : tables) {
                    st.execute("DELETE FROM \"" + t + "\"");
                }
                try {
                    st.execute("DELETE FROM sqlite_sequence");
                } catch (Exception ignored) {
                }
                st.execute("PRAGMA foreign_keys = ON");
            } else {
                st.execute("SET FOREIGN_KEY_CHECKS = 0");
                List<String> tables = new ArrayList<>();
                try (ResultSet rs = st.executeQuery("SHOW TABLES")) {
                    while (rs.next()) {
                        String t = rs.getString(1);
                        if (!t.startsWith("flyway_")) {
                            tables.add(t);
                        }
                    }
                }
                for (String t : tables) {
                    st.execute("TRUNCATE TABLE `" + t + "`");
                }
                st.execute("SET FOREIGN_KEY_CHECKS = 1");
            }
        }
        if (vtcDbBean != null) {
            for (String mName : new String[]{"init", "initAndSeed", "initialize", "seedDemo", "seed"}) {
                try {
                    Method m = vtcDbBean.getClass().getDeclaredMethod(mName);
                    m.setAccessible(true);
                    m.invoke(vtcDbBean);
                    break;
                } catch (NoSuchMethodException ignored) {
                }
            }
        }
        for (String name : context.getBeanDefinitionNames()) {
            Object bean = context.getBean(name);
            if (bean.getClass().getSimpleName().contains("SeedRunner")) {
                try {
                    Method m = bean.getClass().getMethod("ensureAll");
                    m.invoke(bean);
                } catch (NoSuchMethodException ignored) {
                }
            }
        }
    }

    private Object findVtcDbBean() {
        for (String name : context.getBeanDefinitionNames()) {
            Object bean = context.getBean(name);
            String simple = bean.getClass().getSimpleName();
            if (simple.contains("VtcDb")) {
                return bean;
            }
        }
        for (String name : context.getBeanDefinitionNames()) {
            Object bean = context.getBean(name);
            String simple = bean.getClass().getSimpleName();
            if (simple.equals("Db") || simple.startsWith("Db$")) {
                return bean;
            }
        }
        return null;
    }

    protected Connection openJdbcConnection() throws Exception {
        Object vtcDbBean = findVtcDbBean();
        if (vtcDbBean != null) {
            for (String mName : new String[]{"openConnection", "getConnection", "connect"}) {
                try {
                    Method m = vtcDbBean.getClass().getDeclaredMethod(mName);
                    m.setAccessible(true);
                    Object res = m.invoke(vtcDbBean);
                    if (res instanceof Connection c) {
                        return c;
                    }
                } catch (NoSuchMethodException ignored) {
                }
            }
            for (String fName : new String[]{"dbPath", "path"}) {
                try {
                    Field f = vtcDbBean.getClass().getDeclaredField(fName);
                    f.setAccessible(true);
                    Object val = f.get(vtcDbBean);
                    if (val != null) {
                        return DriverManager.getConnection("jdbc:sqlite:" + val);
                    }
                } catch (NoSuchFieldException ignored) {
                }
            }
        }
        try {
            DataSource ds = context.getBean(DataSource.class);
            return ds.getConnection();
        } catch (Exception ignored) {
        }
        return DriverManager.getConnection("jdbc:sqlite:" + DB_PATH.toAbsolutePath());
    }

    protected void execSql(String sql, Object... params) {
        try (Connection con = openJdbcConnection();
             PreparedStatement ps = con.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            ps.executeUpdate();
        } catch (Exception e) {
            throw new RuntimeException("SQL execution failed: " + sql, e);
        }
    }

    protected String queryScalar(String sql, Object... params) {
        try (Connection con = openJdbcConnection();
             PreparedStatement ps = con.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        } catch (Exception e) {
            throw new RuntimeException("SQL query failed: " + sql, e);
        }
    }

    public TestClient newClient() {
        return new TestClient(mvc, mapper);
    }

    public TestClient login(String who) {
        TestClient c = newClient();
        TestResponse r;
        if (PASSWORDS.containsKey(who)) {
            r = c.post("/api/v1/login", Map.of("username", who, "password", PASSWORDS.get(who)));
        } else {
            JsonNode pinPeople = ok(c.get("/api/v1/login/pin-people"));
            int uid = findFirst(pinPeople, p -> p.path("full_name").asText().toLowerCase().endsWith(who.toLowerCase()))
                    .path("id").asInt();
            r = c.post("/api/v1/login/pin", Map.of("user_id", uid, "pin", PINS.get(who)));
        }
        assertEquals(200, r.statusCode(), r.text());
        return c;
    }

    public Map<String, TestClient> people() {
        Map<String, TestClient> clients = new LinkedHashMap<>();
        for (String w : new String[]{"owner", "admin", "manager", "roaster"}) {
            clients.put(w, login(w));
        }
        Map<String, Object> settings = new LinkedHashMap<>();
        settings.put("quiet_start_hour", 0);
        settings.put("quiet_end_hour", 0);
        settings.put("roast_rest_days", 0);
        ok(clients.get("owner").put("/api/v1/admin/settings", settings));
        return clients;
    }

    public JsonNode ok(TestResponse r) {
        return ok(r, 200);
    }

    public JsonNode ok(TestResponse r, int status) {
        assertEquals(status, r.statusCode(), () -> r.statusCode() + ": " + r.text());
        return r.json();
    }

    public int uidOf(TestClient client, String namePart) {
        JsonNode users = ok(client.get("/api/v1/admin/users"));
        return findFirst(users, p -> p.path("full_name").asText().contains(namePart)).path("id").asInt();
    }

    public int roleId(TestClient client, String key) {
        JsonNode roles = ok(client.get("/api/v1/admin/roles"));
        return findFirst(roles, r -> key.equals(r.path("key").asText())).path("id").asInt();
    }

    public static Map<String, String> key() {
        return Map.of("X-Idempotency-Key", UUID.randomUUID().toString());
    }

    public static Stream<JsonNode> stream(JsonNode arrayNode) {
        if (arrayNode == null || !arrayNode.isContainerNode()) {
            return Stream.empty();
        }
        return StreamSupport.stream(arrayNode.spliterator(), false);
    }

    public static JsonNode findFirst(JsonNode arrayNode, Predicate<JsonNode> predicate) {
        return stream(arrayNode)
                .filter(predicate)
                .findFirst()
                .orElseGet(() -> {
                    fail("No matching element found in JSON array: " + arrayNode);
                    return null;
                });
    }

    public static boolean anyMatch(JsonNode arrayNode, Predicate<JsonNode> predicate) {
        return stream(arrayNode).anyMatch(predicate);
    }

    public static boolean noneMatch(JsonNode arrayNode, Predicate<JsonNode> predicate) {
        return stream(arrayNode).noneMatch(predicate);
    }

    public static boolean allMatch(JsonNode arrayNode, Predicate<JsonNode> predicate) {
        return stream(arrayNode).allMatch(predicate);
    }

    public static List<String> stringList(JsonNode arrayNode) {
        List<String> list = new ArrayList<>();
        if (arrayNode != null && arrayNode.isArray()) {
            for (JsonNode n : arrayNode) {
                list.add(n.asText());
            }
        }
        return list;
    }

    public static Map<String, Object> mapOf(Object... kvs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < kvs.length; i += 2) {
            map.put(String.valueOf(kvs[i]), kvs[i + 1]);
        }
        return map;
    }

    public static class TestResponse {
        private final int status;
        private final byte[] content;
        private final ObjectMapper mapper;

        public TestResponse(int status, byte[] content, ObjectMapper mapper) {
            this.status = status;
            this.content = content != null ? content : new byte[0];
            this.mapper = mapper;
        }

        public int statusCode() {
            return status;
        }

        public byte[] content() {
            return content;
        }

        public String text() {
            return new String(content, StandardCharsets.UTF_8);
        }

        public JsonNode json() {
            try {
                if (content.length == 0) {
                    return mapper.createObjectNode();
                }
                return mapper.readTree(content);
            } catch (Exception e) {
                throw new RuntimeException("Failed to parse JSON from response (" + status + "): " + text(), e);
            }
        }
    }

    public static class TestClient {
        private final MockMvc mvc;
        private final ObjectMapper mapper;
        private final Map<String, Cookie> cookies = new LinkedHashMap<>();

        public TestClient(MockMvc mvc, ObjectMapper mapper) {
            this.mvc = mvc;
            this.mapper = mapper;
        }

        public TestResponse get(String url) {
            return request("GET", url, null, null, null, true);
        }

        public TestResponse get(String url, Map<String, String> params) {
            return request("GET", url, params, null, null, true);
        }

        public TestResponse post(String url, Object jsonBody) {
            return request("POST", url, null, jsonBody, null, true);
        }

        public TestResponse post(String url, Object jsonBody, Map<String, String> headers) {
            return request("POST", url, null, jsonBody, headers, true);
        }

        public TestResponse put(String url, Object jsonBody) {
            return request("PUT", url, null, jsonBody, null, true);
        }

        public TestResponse put(String url, Object jsonBody, Map<String, String> headers) {
            return request("PUT", url, null, jsonBody, headers, true);
        }

        public TestResponse delete(String url) {
            return request("DELETE", url, null, null, null, true);
        }

        public TestResponse rawRequest(String method, String url, Object jsonBody) {
            return request(method, url, null, jsonBody, null, false);
        }

        public synchronized TestResponse request(
                String method,
                String url,
                Map<String, String> params,
                Object jsonBody,
                Map<String, String> headers,
                boolean includeXVtc
        ) {
            try {
                MockHttpServletRequestBuilder builder = MockMvcRequestBuilders.request(
                        org.springframework.http.HttpMethod.valueOf(method.toUpperCase()),
                        url
                );
                if (includeXVtc) {
                    builder.header("X-VTC", "1");
                }
                if (headers != null) {
                    for (Map.Entry<String, String> h : headers.entrySet()) {
                        builder.header(h.getKey(), h.getValue());
                    }
                }
                if (params != null) {
                    for (Map.Entry<String, String> p : params.entrySet()) {
                        builder.param(p.getKey(), p.getValue());
                    }
                }
                if (!cookies.isEmpty()) {
                    builder.cookie(cookies.values().toArray(new Cookie[0]));
                }
                if (jsonBody != null) {
                    builder.contentType(MediaType.APPLICATION_JSON);
                    String serialized = (jsonBody instanceof String s) ? s : mapper.writeValueAsString(jsonBody);
                    builder.content(serialized.getBytes(StandardCharsets.UTF_8));
                }
                MvcResult res = mvc.perform(builder).andReturn();
                MockHttpServletResponse resp = res.getResponse();
                Cookie[] respCookies = resp.getCookies();
                if (respCookies != null) {
                    for (Cookie c : respCookies) {
                        if (c.getMaxAge() == 0 || c.getValue() == null || c.getValue().isEmpty()) {
                            cookies.remove(c.getName());
                        } else {
                            cookies.put(c.getName(), c);
                        }
                    }
                }
                return new TestResponse(resp.getStatus(), resp.getContentAsByteArray(), mapper);
            } catch (Exception e) {
                throw new RuntimeException("Request failed: " + method + " " + url, e);
            }
        }
    }
}
