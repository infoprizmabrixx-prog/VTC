package in.vasavi.vtc.security;

import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.config.AppProperties;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;

@Service
public class SessionService {

    public static final String COOKIE_NAME = "vtc_session";
    private static final int SESSION_HOURS = 12;
    private static final Set<String> SECRET_CHANGE_ALLOWED_PATHS = Set.of(
            "/api/v1/me", "/api/v1/me/secret", "/api/v1/logout", "/api/v1/i18n"
    );

    private final Db db;
    private final PasswordHasher hasher;
    private final PermissionService permissionService;
    private final AppProperties appProperties;

    public SessionService(Db db, PasswordHasher hasher, PermissionService permissionService, AppProperties appProperties) {
        this.db = db;
        this.hasher = hasher;
        this.permissionService = permissionService;
        this.appProperties = appProperties;
    }

    public String extractCookie(HttpServletRequest req) {
        Cookie[] cookies = req.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if (COOKIE_NAME.equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank()) {
                    return c.getValue();
                }
            }
        }
        return null;
    }

    public CurrentUser current(HttpServletRequest req) {
        String token = extractCookie(req);
        if (token == null) {
            throw new ApiException("LOGIN_REQUIRED", 401);
        }
        String th = hasher.tokenHash(token);
        Map<String, Object> s = db.one("SELECT * FROM sessions WHERE token_hash=?", th);
        if (s == null) {
            throw new ApiException("LOGIN_REQUIRED", 401);
        }
        Instant now = Times.now();
        Instant expiresAt = Times.parse((String) s.get("expires_at"));
        long userId = ((Number) s.get("user_id")).longValue();
        String deviceMode = (String) s.get("device_mode");

        if (expiresAt != null && !expiresAt.isAfter(now)) {
            db.newTxVoid(() -> db.exec("DELETE FROM sessions WHERE token_hash=?", th));
            throw new ApiException("SESSION_EXPIRED", 401);
        }

        Object idleSetting = db.getSetting("shared".equals(deviceMode) ? "idle_shared_min" : "idle_personal_min");
        long idleMin = idleSetting instanceof Number n ? n.longValue() : Long.parseLong(idleSetting.toString());
        Instant lastSeen = Times.parse((String) s.get("last_seen"));
        if (lastSeen != null && Duration.between(lastSeen, now).compareTo(Duration.ofMinutes(idleMin)) >= 0) {
            db.newTxVoid(() -> {
                db.exec("DELETE FROM sessions WHERE token_hash=?", th);
                db.audit(userId, "SESSION_IDLE_TIMEOUT", "user:" + userId, deviceMode, "access");
            });
            throw new ApiException("SESSION_IDLE", 401);
        }

        CurrentUser u = permissionService.loadUser(userId, s);
        if (u == null) {
            db.newTxVoid(() -> db.exec("DELETE FROM sessions WHERE token_hash=?", th));
            throw new ApiException("ACCOUNT_DISABLED", 401);
        }

        if (lastSeen != null && Duration.between(lastSeen, now).getSeconds() > 30) {
            db.newTxVoid(() -> db.exec("UPDATE sessions SET last_seen=? WHERE token_hash=?", Times.stamp(now), th));
        }

        String path = req.getRequestURI();
        if (u.isMustChangeSecret() && !SECRET_CHANGE_ALLOWED_PATHS.contains(path)) {
            throw new ApiException("MUST_CHANGE_SECRET", 403);
        }
        return u;
    }

    public String createSession(long userId, String mode, HttpServletRequest req, HttpServletResponse res) {
        String m = ("shared".equals(mode) || "personal".equals(mode)) ? mode : "personal";
        String token = hasher.newToken();
        String now = Times.stamp();
        String ua = req != null && req.getHeader("User-Agent") != null ? req.getHeader("User-Agent") : "";
        if (ua.length() > 160) {
            ua = ua.substring(0, 160);
        }
        String finalUa = ua;
        db.txVoid(() -> db.exec(
                "INSERT INTO sessions(token_hash, user_id, device_mode, created_at, last_seen, expires_at, user_agent) " +
                "VALUES(?,?,?,?,?,?,?)",
                hasher.tokenHash(token), userId, m, now, now, Times.later(SESSION_HOURS * 60L), finalUa
        ));

        ResponseCookie cookie = ResponseCookie.from(COOKIE_NAME, token)
                .httpOnly(true)
                .sameSite("Lax")
                .secure(appProperties.isHttps())
                .path("/")
                .maxAge(Duration.ofHours(SESSION_HOURS))
                .build();
        res.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        return m;
    }

    public void clearCookie(HttpServletResponse res) {
        ResponseCookie cookie = ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .sameSite("Lax")
                .secure(appProperties.isHttps())
                .path("/")
                .maxAge(0)
                .build();
        res.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
