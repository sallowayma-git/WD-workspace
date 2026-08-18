package com.wonderedu.assistant.identity.web;

import com.wonderedu.assistant.identity.api.AuthCommands;
import com.wonderedu.assistant.identity.api.AuthView;
import com.wonderedu.assistant.identity.application.AuthSessionStore;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthSessionStore sessions;

    public AuthController(AuthSessionStore sessions) {
        this.sessions = sessions;
    }

    @PostMapping("/login")
    public AuthView login(@RequestBody AuthCommands.Login command) {
        return sessions.login(command);
    }

    @PostMapping("/refresh")
    public AuthView refresh(@RequestBody AuthCommands.Refresh command) {
        return sessions.refresh(command);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            HttpServletRequest request, @RequestBody(required = false) AuthCommands.Logout command) {
        String authorization = request.getHeader("Authorization");
        String accessToken =
                authorization != null && authorization.startsWith("Bearer ")
                        ? authorization.substring(7).trim()
                        : null;
        sessions.logout(accessToken, command);
        return ResponseEntity.noContent().build();
    }
}
