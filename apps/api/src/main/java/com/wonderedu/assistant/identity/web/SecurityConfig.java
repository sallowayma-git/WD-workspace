package com.wonderedu.assistant.identity.web;

import com.wonderedu.assistant.shared.ApiProblem;
import com.wonderedu.assistant.shared.RequestIdContext;
import com.wonderedu.assistant.shared.RequestIdFilter;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import com.wonderedu.assistant.identity.AuthProperties;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import tools.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Production security configuration. Active for every profile except {@code dev}.
 * In {@code dev}, {@link DevSecurityConfig} takes over and authenticates every
 * request as the local administrator without requiring a bearer token.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@Profile("!dev")
public class SecurityConfig {

    private final ObjectMapper objectMapper;
    private final BearerTokenFilter bearerTokenFilter;
    private final AuthProperties authProperties;

    public SecurityConfig(
            ObjectMapper objectMapper,
            BearerTokenFilter bearerTokenFilter,
            AuthProperties authProperties) {
        this.objectMapper = objectMapper;
        this.bearerTokenFilter = bearerTokenFilter;
        this.authProperties = authProperties;
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests((requests) -> requests
                        .requestMatchers(
                                "/actuator/health",
                                "/actuator/info",
                                "/api/v1/auth/login",
                                "/api/v1/auth/refresh")
                        .permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(
                        exceptions ->
                                exceptions
                                        .authenticationEntryPoint(
                                                (request, response, exception) ->
                                                        writeProblem(
                                                                response,
                                                                401,
                                                                "AUTHENTICATION_REQUIRED",
                                                                "需要登录后才能访问"))
                                        .accessDeniedHandler(
                                                (request, response, exception) ->
                                                        writeProblem(
                                                                response,
                                                                403,
                                                                "ACCESS_DENIED",
                                                                "当前用户无权执行此操作")))
                .sessionManagement(
                        sessions -> sessions.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(bearerTokenFilter, UsernamePasswordAuthenticationFilter.class)
                .httpBasic(AbstractHttpConfigurer::disable);
        return http.build();
    }

    private void writeProblem(
            jakarta.servlet.http.HttpServletResponse response,
            int status,
            String code,
            String detail)
            throws IOException {
        String requestId = RequestIdContext.currentOrCreate();
        ApiProblem problem =
                new ApiProblem(
                        URI.create("https://errors.wonderedu.com/" + code.toLowerCase()),
                        status == 401 ? "Unauthorized" : "Forbidden",
                        status,
                        detail,
                        code,
                        requestId,
                        List.of(),
                        Map.of());
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setHeader(RequestIdFilter.HEADER_NAME, requestId);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(authProperties.allowedOrigins());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "If-Match", "Idempotency-Key", "X-Request-Id"));
        configuration.setExposedHeaders(List.of("X-Request-Id"));
        configuration.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
