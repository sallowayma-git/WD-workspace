package com.wonderedu.assistant.identity.web;

import com.wonderedu.assistant.identity.api.ContextView;
import com.wonderedu.assistant.identity.application.ContextService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ContextController {

    private final ContextService contextService;

    public ContextController(ContextService contextService) {
        this.contextService = contextService;
    }

    @GetMapping("/context")
    public ContextView getContext(Authentication authentication) {
        return contextService.getContext(authentication);
    }
}
