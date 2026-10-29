package in.vasavi.vtc.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.ZoneId;

@Configuration
public class ClockConfig {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Bean
    public Clock utcClock() {
        return Clock.systemUTC();
    }
}
