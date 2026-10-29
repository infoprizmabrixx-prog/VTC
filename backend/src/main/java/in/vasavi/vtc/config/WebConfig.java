package in.vasavi.vtc.config;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@RestController
public class WebConfig {

    @GetMapping(value = "/", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> index() throws IOException {
        Resource resource = new ClassPathResource("static/index.html");
        String html = resource.exists()
                ? resource.getContentAsString(StandardCharsets.UTF_8)
                : """
                  <!DOCTYPE html>
                  <html lang="en">
                  <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
                    <meta name="theme-color" content="#3c2419" />
                    <meta name="apple-mobile-web-app-capable" content="yes" />
                    <title>VTC Portal</title>
                    <link rel="manifest" href="/manifest.webmanifest" />
                    <link rel="icon" href="/static/icon.svg" type="image/svg+xml" />
                    <link rel="apple-touch-icon" href="/static/icon.svg" />
                    <link rel="stylesheet" href="/static/css/app.css" />
                  </head>
                  <body>
                    <div id="app"><div class="boot">VASAVI<span>TRADING COMPANY</span></div></div>
                    <div id="toast" role="status" aria-live="polite"></div>
                    <noscript>This portal needs JavaScript switched on.</noscript>
                  </body>
                  </html>
                  """;
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .contentType(MediaType.TEXT_HTML)
                .body(html);
    }

    @GetMapping(value = "/manifest.webmanifest", produces = "application/manifest+json")
    public ResponseEntity<Resource> manifest() {
        Resource resource = new ClassPathResource("static/manifest.webmanifest");
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .contentType(MediaType.parseMediaType("application/manifest+json"))
                .body(resource);
    }
}
