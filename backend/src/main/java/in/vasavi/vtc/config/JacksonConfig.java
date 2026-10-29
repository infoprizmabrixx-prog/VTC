package in.vasavi.vtc.config;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializerProvider;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

@Configuration
public class JacksonConfig {

    public static final DateTimeFormatter VTC_INSTANT_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'+00:00'").withZone(ZoneOffset.UTC);

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer vtcJacksonCustomizer() {
        return builder -> builder
                .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
                .serializationInclusion(JsonInclude.Include.ALWAYS)
                .serializerByType(Instant.class, new JsonSerializer<Instant>() {
                    @Override
                    public void serialize(Instant value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
                        if (value == null) {
                            gen.writeNull();
                        } else {
                            gen.writeString(VTC_INSTANT_FORMAT.format(value.truncatedTo(ChronoUnit.SECONDS)));
                        }
                    }
                });
    }
}
