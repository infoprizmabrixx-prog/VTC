package in.vasavi.vtc;

import in.vasavi.vtc.common.GlobalExceptionHandler;
import in.vasavi.vtc.config.JacksonConfig;
import in.vasavi.vtc.config.WebConfig;
import in.vasavi.vtc.security.SecurityConfig;
import in.vasavi.vtc.security.SecurityHeadersFilter;
import in.vasavi.vtc.security.XVtcHeaderFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(controllers = WebConfig.class)
@Import({
        SecurityConfig.class,
        SecurityHeadersFilter.class,
        XVtcHeaderFilter.class,
        GlobalExceptionHandler.class,
        JacksonConfig.class
})
class Phase0GateTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void indexServesBootSplashAndSecurityHeaders() throws Exception {
        mvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-cache"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Referrer-Policy", "same-origin"))
                .andExpect(header().string("Content-Security-Policy", SecurityHeadersFilter.CSP_POLICY))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("VASAVI")));
    }

    @Test
    void apiPostWithoutXVtcHeaderReturns403BadRequestOrigin() throws Exception {
        mvc.perform(post("/api/v1/login").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().json("{\"error\":\"BAD_REQUEST_ORIGIN\"}"));
    }

    @Test
    void unknownApiRouteReturns404WithDetailNotFound() throws Exception {
        mvc.perform(get("/api/v1/unknown-endpoint"))
                .andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.detail").value("Not Found"));
    }

    @Test
    void flywayBaselineMigrationsContainAll68Tables() throws Exception {
        String v1 = new ClassPathResource("db/migration/V1__baseline.sql").getContentAsString(StandardCharsets.UTF_8);
        String v2 = new ClassPathResource("db/migration/V2__session_sid.sql").getContentAsString(StandardCharsets.UTF_8);

        Matcher m = Pattern.compile("CREATE TABLE `([^`]+)`").matcher(v1);
        int count = 0;
        while (m.find()) {
            count++;
        }
        assertThat(count).isEqualTo(68);
        assertThat(v2).contains("ALTER TABLE `sessions`");
        assertThat(v2).contains("ADD COLUMN `sid` BIGINT NOT NULL AUTO_INCREMENT");
    }
}
