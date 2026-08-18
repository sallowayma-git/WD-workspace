package com.wonderedu.assistant;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ArchitectureTest {

    @Test
    void moduleBoundariesAreValid() {
        ApplicationModules.of(AssistantApplication.class).verify();
    }
}
