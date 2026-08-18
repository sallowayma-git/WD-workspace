package com.wonderedu.assistant.search.api;

import java.util.List;
import java.util.UUID;

public final class SearchViews {

    private SearchViews() {}

    public record SearchResponse(String query, List<SearchResultGroup> groups, String parsedDateHint) {}

    public record SearchResultGroup(String type, List<SearchResultItem> items) {}

    public record SearchResultItem(
            UUID id,
            String type,
            String title,
            String subtitle,
            String status,
            String payload) {}
}
