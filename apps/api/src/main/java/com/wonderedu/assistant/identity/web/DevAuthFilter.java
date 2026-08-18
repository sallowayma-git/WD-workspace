package com.wonderedu.assistant.identity.web;

import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.identity.api.AuthPrincipal;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Dev-only authentication shim. Authenticates every request as the seeded local
 * administrator ({@code admin}) with the {@code ADMIN} role and the local
 * organization, so method security ({@code @PreAuthorize}) and the tenant context
 * are populated without requiring a bearer token.
 *
 * <p>Active only under the {@code dev} profile; never loaded in production.
 */
@Component
@Profile("dev")
public class DevAuthFilter extends OncePerRequestFilter {

    private static final UUID ADMIN_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000010");
    private static final String USERNAME = "admin";
    private static final String DISPLAY_NAME = "开发管理员";
    private static final List<SimpleGrantedAuthority> AUTHORITIES =
            List.of(
                    new SimpleGrantedAuthority("ROLE_ADMIN"),
                    new SimpleGrantedAuthority("ROLE_LEAD_TEACHER"),
                    new SimpleGrantedAuthority("ROLE_ASSISTANT"),
                    new SimpleGrantedAuthority("ROLE_VIEWER"));

    private final IdentityProperties properties;

    public DevAuthFilter(IdentityProperties properties) {
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            AuthPrincipal principal =
                    new AuthPrincipal(
                            ADMIN_ID,
                            properties.organizationId(),
                            properties.organizationCode(),
                            properties.organizationName(),
                            properties.businessTimezone(),
                            properties.dayCloseTime(),
                            USERNAME,
                            DISPLAY_NAME);
            Authentication authentication =
                    new UsernamePasswordAuthenticationToken(principal, null, AUTHORITIES);
            SecurityContextHolder.getContext().setAuthentication(authentication);
            TenantContext.set(principal.organizationId());
            ActorContext.set(principal.userId(), principal.username());
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
            ActorContext.clear();
            TenantContext.clear();
        }
    }
}
