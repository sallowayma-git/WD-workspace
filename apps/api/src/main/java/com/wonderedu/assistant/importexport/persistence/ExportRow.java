package com.wonderedu.assistant.importexport.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;

/**
 * Denormalized projection used by {@link
 * com.wonderedu.assistant.importexport.application.ExportService} to render the vocabulary CSV.
 *
 * <p>Lives in the importexport module so {@code ExportService} does not have to depend on the
 * vocabulary module — the export SQL is a read-only cross-table join over {@code vocabulary_entry},
 * {@code vocabulary_batch} and {@code student}, and is owned entirely by the export feature.
 */
public record ExportRow(
        LocalDate occurredDate,
        String studentName,
        String subjectCode,
        String termOriginal,
        String note) {

    /** Map a JDBC row to an {@link ExportRow}. */
    public static ExportRow map(ResultSet rs, int rowNum) throws SQLException {
        return new ExportRow(
                rs.getObject("occurred_date", LocalDate.class),
                rs.getString("student_name"),
                rs.getString("subject_code"),
                rs.getString("term_original"),
                rs.getString("note"));
    }
}
