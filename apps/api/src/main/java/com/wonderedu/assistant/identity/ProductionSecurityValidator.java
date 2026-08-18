package com.wonderedu.assistant.identity;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("prod")
public class ProductionSecurityValidator implements InitializingBean {

    private final String databasePassword;

    public ProductionSecurityValidator(@Value("${ASSISTANT_DB_PASSWORD:}") String databasePassword) {
        this.databasePassword = databasePassword;
    }

    @Override
    public void afterPropertiesSet() {
        if (databasePassword.isBlank()) {
            throw new IllegalStateException("ASSISTANT_DB_PASSWORD is required in prod");
        }
    }
}
