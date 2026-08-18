package com.wonderedu.assistant.importexport.application;

import com.wonderedu.assistant.importexport.api.ImportViews;
import com.wonderedu.assistant.importexport.api.ImportViews.ColumnPreview;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.stereotype.Component;

@Component
public class ExcelTemplateParser {

    private static final int MAX_COLUMNS = 50;
    private static final int MAX_ROWS = 5000;
    private static final int SAMPLE_LIMIT = 3;

    public ParsedFile parse(byte[] content) {
        String sha256 = sha256(content);
        try (Workbook workbook = WorkbookFactory.create(new ByteArrayInputStream(content))) {
            Sheet sheet = workbook.getSheetAt(0);
            if (sheet == null) {
                throw new IllegalArgumentException("Excel 文件中没有工作表");
            }
            Row headerRow = sheet.getRow(0);
            if (headerRow == null) {
                throw new IllegalArgumentException("Excel 第一行必须为任务类别列名");
            }
            Row metadataRow = sheet.getRow(1);
            int lastCol = headerRow.getLastCellNum();
            List<ColumnPreview> columns = new ArrayList<>();
            for (int colIndex = 0; colIndex < lastCol && colIndex < MAX_COLUMNS; colIndex++) {
                Cell headerCell = headerRow.getCell(colIndex);
                if (headerCell == null || headerCell.getCellType() == CellType.BLANK) {
                    continue;
                }
                String header = getCellText(headerCell);
                if (header == null || header.isBlank()) {
                    continue;
                }
                String metadata = "";
                if (metadataRow != null) {
                    Cell metaCell = metadataRow.getCell(colIndex);
                    metadata = metaCell != null ? getCellText(metaCell) : "";
                }
                List<String> titles = extractTitles(sheet, colIndex);
                ParsedMetadata parsed = parseMetadata(metadata);
                int nonEmpty = titles.size();
                ColumnPreview preview = new ColumnPreview(
                        header,
                        metadata,
                        parsed.unit,
                        parsed.total,
                        parsed.durationMinutes,
                        nonEmpty,
                        titles.subList(0, Math.min(titles.size(), SAMPLE_LIMIT)),
                        titles,
                        parsed.error);
                columns.add(preview);
            }
            int valid = (int) columns.stream().filter(c -> c.nonEmptyCount() > 0).count();
            return new ParsedFile(sha256, new ImportViews.ImportPreview(
                    "uploaded.xlsx", sha256, columns, columns.size(), valid));
        } catch (IOException e) {
            throw new IllegalArgumentException("无法解析 Excel 文件: " + e.getMessage(), e);
        }
    }

    private List<String> extractTitles(Sheet sheet, int colIndex) {
        List<String> titles = new ArrayList<>();
        int rowCount = 0;
        for (int rowIndex = 2; rowIndex <= sheet.getLastRowNum() && rowCount < MAX_ROWS; rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (row == null) continue;
            Cell cell = row.getCell(colIndex);
            String text = cell != null ? getCellText(cell) : null;
            if (text != null && !text.isBlank()) {
                titles.add(text.trim());
            }
            rowCount++;
        }
        return titles;
    }

    private ParsedMetadata parseMetadata(String metadata) {
        if (metadata == null || metadata.isBlank()) {
            return new ParsedMetadata(null, null, null, null);
        }
        String trimmed = metadata.trim();
        try {
            String unit = null;
            Integer total = null;
            Integer duration = null;

            // Pattern: 1P/30/1hour or 1Day/30/30mins or 1个场景/26/5页1hour
            java.util.regex.Matcher matcher = java.util.regex.Pattern
                    .compile("^(\\d+)\\s*([^/\\d]+?)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)\\s*(分钟|mins|minutes|小时|hour|hours)")
                    .matcher(trimmed);
            if (matcher.matches()) {
                unit = matcher.group(2).trim();
                total = Integer.parseInt(matcher.group(3));
                int dur = Integer.parseInt(matcher.group(4));
                String durUnit = matcher.group(5);
                duration = "小时".equals(durUnit) || "hour".equals(durUnit) || "hours".equals(durUnit)
                        ? dur * 60 : dur;
                return new ParsedMetadata(unit, total, duration, null);
            }

            // Pattern: 每篇20分钟 or 每节30分钟
            matcher = java.util.regex.Pattern
                    .compile("^每(.+?)(\\d+)\\s*(分钟|mins|minutes)")
                    .matcher(trimmed);
            if (matcher.matches()) {
                unit = matcher.group(1);
                duration = Integer.parseInt(matcher.group(2));
                return new ParsedMetadata(unit, total, duration, null);
            }

            // Pattern: 1P/30/1hour variations
            matcher = java.util.regex.Pattern
                    .compile("^(\\d+)\\s*([^/\\d]+?)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)\\s*(h|hr)", java.util.regex.Pattern.CASE_INSENSITIVE)
                    .matcher(trimmed);
            if (matcher.matches()) {
                unit = matcher.group(2).trim();
                total = Integer.parseInt(matcher.group(3));
                duration = Integer.parseInt(matcher.group(4)) * 60;
                return new ParsedMetadata(unit, total, duration, null);
            }

            return new ParsedMetadata(null, null, null, "无法解析元数据: " + trimmed);
        } catch (Exception e) {
            return new ParsedMetadata(null, null, null, "元数据解析异常: " + e.getMessage());
        }
    }

    private static String getCellText(Cell cell) {
        if (cell == null) return null;
        return switch (cell.getCellType()) {
            case STRING -> cell.getStringCellValue().trim();
            case NUMERIC -> String.valueOf((int) cell.getNumericCellValue());
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            case FORMULA -> {
                try {
                    yield cell.getStringCellValue().trim();
                } catch (Exception e) {
                    yield String.valueOf(cell.getNumericCellValue());
                }
            }
            default -> null;
        };
    }

    private static String sha256(byte[] content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private record ParsedMetadata(String unit, Integer total, Integer durationMinutes, String error) {}

    public record ParsedFile(String sha256, ImportViews.ImportPreview preview) {}
}
