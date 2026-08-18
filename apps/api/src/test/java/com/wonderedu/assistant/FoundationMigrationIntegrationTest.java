package com.wonderedu.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Tag("postgres")
@Testcontainers
class FoundationMigrationIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:18")
                    .withDatabaseName("assistant_workbench_test")
                    .withUsername("assistant_test")
                    .withPassword("integration-test-only");

    @Test
    void migratesEmptyPostgresAndCreatesFoundationAndCoreTables() throws Exception {
        Flyway flyway =
                Flyway.configure()
                        .dataSource(
                                POSTGRES.getJdbcUrl(),
                                POSTGRES.getUsername(),
                                POSTGRES.getPassword())
                        .locations("classpath:db/migration")
                        .load();

        assertThat(flyway.migrate().success).isTrue();

        try (Connection connection = POSTGRES.createConnection("")) {
            assertThat(
                            queryInt(
                                    connection,
                                    "SELECT count(*) FROM information_schema.tables "
                                            + "WHERE table_schema = 'public' AND table_name IN "
                                            + "('organization', 'user_account', 'user_role_assignment', 'audit_event', "
                                            + "'idempotency_record', 'student', 'student_week_plan', 'task_template', "
                                            + "'task_template_version', 'task_template_item', 'student_task_track')"))
                    .isEqualTo(11);
            assertThat(
                            queryInt(
                                    connection,
                                    "SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm'"))
                    .isEqualTo(1);
            assertThat(
                            queryInt(
                                    connection,
                                    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' "
                                            + "AND indexname IN ('uq_student_active_weekly_pattern', 'uq_task_template_one_draft')"))
                    .isEqualTo(2);
            assertThat(
                            queryInt(
                                    connection,
                                    "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND "
                                            + "((table_name = 'audit_event' AND column_name = 'occurred_at' AND data_type = 'timestamp with time zone') "
                                            + "OR (table_name = 'student' AND column_name = 'enrollment_date' AND data_type = 'date') "
                                            + "OR (table_name = 'task_template' AND column_name = 'tags' AND data_type = 'jsonb'))"))
                    .isEqualTo(3);
        }
    }

    private static int queryInt(Connection connection, String sql) throws Exception {
        try (Statement statement = connection.createStatement();
                ResultSet resultSet = statement.executeQuery(sql)) {
            resultSet.next();
            return resultSet.getInt(1);
        }
    }
}
