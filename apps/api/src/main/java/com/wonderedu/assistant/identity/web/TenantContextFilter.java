package com.wonderedu.assistant.identity.web;

import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Profile("!dev")
@Order(Ordered.LOWEST_PRECEDENCE - 10)
public class TenantContextFilter extends OncePerRequestFilter {

    private final IdentityProperties properties;

    public TenantContextFilter(IdentityProperties properties) {
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            if (authentication.getPrincipal() instanceof com.wonderedu.assistant.identity.api.AuthPrincipal principal) {
                TenantContext.set(principal.organizationId());
                ActorContext.set(principal.userId(), principal.username());
            } else {
                TenantContext.set(properties.organizationId());
                ActorContext.set(
                        java.util.UUID.nameUUIDFromBytes(authentication.getName().getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                        authentication.getName());
            }
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            ActorContext.clear();
            TenantContext.clear();
        }
    }
}
