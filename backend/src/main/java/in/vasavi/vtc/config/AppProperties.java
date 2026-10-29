package in.vasavi.vtc.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;

@ConfigurationProperties(prefix = "vtc")
public record AppProperties(
        String https,
        String demo,
        String filesDir,
        String jwtSecret
) {
    public boolean isHttps() {
        return "1".equals(https) || "true".equalsIgnoreCase(https);
    }

    public boolean isDemo() {
        return !"0".equals(demo) && !"false".equalsIgnoreCase(demo);
    }

    public boolean isSeedDemo() {
        return isDemo();
    }

    public String getFilesDir() {
        return filesDir == null || filesDir.isBlank() ? "./data/files" : filesDir;
    }

    public String getJwtSecret() {
        return jwtSecret == null || jwtSecret.isBlank()
                ? "vtc-inhouse-portal-default-hmac-sha256-secret-key-2026"
                : jwtSecret;
    }

    public Path filesPath() {
        return Path.of(getFilesDir());
    }
}
