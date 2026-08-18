package com.wonderedu.assistant.identity.web;

import com.wonderedu.assistant.identity.application.AuthSessionStore;
import com.wonderedu.assistant.identity.api.AuthPrincipal;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Profile("!dev")
public class BearerTokenFilter extends OncePerRequestFilter {

    private final ObjectProvider<AuthSessionStore> sessions;

    public BearerTokenFilter(ObjectProvider<AuthSessionStore> sessions) {
        this.sessions = sessions;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.startsWith("Bearer ")) {
            AuthSessionStore sessionStore = sessions.getIfAvailable();
            Authentication authentication =
                    sessionStore == null
                            ? null
                            : sessionStore.authenticateAccessToken(authorization.substring(7).trim());
            if (authentication != null) {
                SecurityContextHolder.getContext().setAuthentication(authentication);
                if (authentication.getPrincipal() instanceof AuthPrincipal principal) {
                    TenantContext.set(principal.organizationId());
                    ActorContext.set(principal.userId(), principal.username());
                }
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
