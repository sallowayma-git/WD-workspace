package com.wonderedu.assistant.shared;

/**
 * Normalizes domain codes (template codes, item codes, etc.) into a stable
 * upper-underscore form so that manually created and imported entities share
 * the same canonical representation.
 *
 * <p>Normalization rules:
 * <ul>
 *   <li>Replace any run of non alphanumeric characters with a single underscore
 *   <li>Convert to upper case
 *   <li>Collapse adjacent underscores
 *   <li>Trim leading and trailing underscores
 * </ul>
 */
public final class CodeNormalizer {

    private CodeNormalizer() {}

    public static String normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            return raw;
        }
        return raw.replaceAll("[^A-Za-z0-9]", "_").toUpperCase()
                .replaceAll("_+", "_").replaceAll("^_|_$", "");
    }
}
