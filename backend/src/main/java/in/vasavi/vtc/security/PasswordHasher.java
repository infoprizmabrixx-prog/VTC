package in.vasavi.vtc.security;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Set;
import java.util.regex.Pattern;

@Component
public class PasswordHasher {

    private static final int ROUNDS = 240_000;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final HexFormat HEX = HexFormat.of();
    private static final Pattern PIN_RE = Pattern.compile("^\\d{4,6}$");
    private static final Set<String> WEAK_PINS = Set.of(
            "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
            "1234", "4321", "123456", "654321", "000000", "111111"
    );
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();

    public String hashSecret(String raw) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        String saltHex = HEX.formatHex(salt);
        byte[] dk = pbkdf2(raw, saltHex);
        return saltHex + "$" + HEX.formatHex(dk);
    }

    public boolean verifySecret(String raw, String stored) {
        if (raw == null || stored == null || stored.isEmpty()) {
            return false;
        }
        try {
            if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
                return bcrypt.matches(raw, stored);
            }
            int idx = stored.indexOf('$');
            if (idx <= 0) {
                return false;
            }
            String saltHex = stored.substring(0, idx);
            String digestHex = stored.substring(idx + 1);
            byte[] check = pbkdf2(raw, saltHex);
            String checkHex = HEX.formatHex(check);
            return MessageDigest.isEqual(
                    checkHex.getBytes(StandardCharsets.UTF_8),
                    digestHex.getBytes(StandardCharsets.UTF_8)
            );
        } catch (Exception e) {
            return false;
        }
    }

    private byte[] pbkdf2(String raw, String saltHex) {
        try {
            PBEKeySpec spec = new PBEKeySpec(
                    raw.toCharArray(),
                    saltHex.getBytes(StandardCharsets.UTF_8),
                    ROUNDS,
                    256
            );
            SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return skf.generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("PBKDF2 failure", e);
        }
    }

    public void validPassword(String pw) {
        if (pw == null || pw.length() < 10 || !Pattern.compile("[A-Za-z]").matcher(pw).find() || !Pattern.compile("\\d").matcher(pw).find()) {
            throw new in.vasavi.vtc.common.ApiException("PASSWORD_TOO_WEAK", 400);
        }
    }

    public void validPin(String pin) {
        if (pin == null || !Pattern.compile("^\\d{4,6}$").matcher(pin).matches()) {
            throw new in.vasavi.vtc.common.ApiException("PIN_MUST_BE_4_TO_6_DIGITS", 400);
        }
        if (pin.chars().distinct().count() == 1 || "0123456789".contains(pin) || "9876543210".contains(pin)) {
            throw new in.vasavi.vtc.common.ApiException("PIN_TOO_SIMPLE", 400);
        }
    }

    public String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public String tokenHash(String token) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] dig = md.digest(token.getBytes(StandardCharsets.UTF_8));
            return HEX.formatHex(dig);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 failure", e);
        }
    }
}
