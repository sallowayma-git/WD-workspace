@org.springframework.modulith.ApplicationModule(
        displayName = "Execution",
        allowedDependencies = {"shared", "identity", "student::studentServices", "planning::trackApi", "planning::trackServices", "planning::trackPersistence", "audit::api", "audit::services"})
package com.wonderedu.assistant.execution;
