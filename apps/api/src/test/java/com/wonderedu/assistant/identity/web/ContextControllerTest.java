package com.wonderedu.assistant.identity.web;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.identity.AuthProperties;
import com.wonderedu.assistant.identity.application.ContextService;
import com.wonderedu.assistant.shared.BusinessClock;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ContextController.class)
@Import({ContextService.class, SecurityConfig.class, ContextControllerTest.PropertiesConfig.class})
@ActiveProfiles("test")
class ContextControllerTest {

    @TestConfiguration
    static class PropertiesConfig {
        @Bean
        IdentityProperties identityProperties() {
            return new IdentityProperties(
                    "Asia/Shanghai",
                    LocalTime.of(5, 0),
                    UUID.fromString("00000000-0000-0000-0000-000000000001"),
                    "TEST",
                    "Test Organization",
                    "0.1.0");
        }

        @Bean
        BusinessClock businessClock() {
            return () -> Instant.parse("2026-08-15T16:30:00Z");
        }

        @Bean
        AuthProperties authProperties() {
                return new AuthProperties(
                        java.util.List.of("http://127.0.0.1:5173"),
                        900,
                        2592000,
                        5,
                        900);
        }
    }

    @Autowired MockMvc mockMvc;

    @Test
    void rejectsUnauthenticatedContextRequest() throws Exception {
        mockMvc.perform(get("/api/v1/context"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentType("application/problem+json"))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId").isNotEmpty())
                .andExpect(header().exists("X-Request-Id"));
    }

    @Test
    void returnsBusinessDateForAuthenticatedUser() throws Exception {
        mockMvc.perform(get("/api/v1/context").with(user("assistant").roles("ASSISTANT")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.displayName").value("assistant"))
                .andExpect(jsonPath("$.organization.code").value("TEST"))
                .andExpect(jsonPath("$.user.roles[0]").value("ASSISTANT"))
                .andExpect(jsonPath("$.permissions[0]").value("student.read"))
                .andExpect(jsonPath("$.businessDate").value("2026-08-16"))
                .andExpect(jsonPath("$.timezone").value("Asia/Shanghai"))
                .andExpect(jsonPath("$.clientMinCompatibleVersion").value("0.1.0"));
    }
}
