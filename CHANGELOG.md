# Changelog

## 0.11.0

- Parse formatted numbers with units, currency symbols and negative notations (`12%`, `3억원`, `△5`, `(1,234)`), and refuse columns or comparisons that mix units.
- Read pipe tables from Markdown notes (`.md` with 1-based `table`) in `eda_profile`, `eda_analyze`, `build_chart` and `suggest_chart`, and flag summary-row candidates.
- Add `compare` analysis to `eda_analyze` for two-period comparisons and value-against-plan comparisons with common-group totals and unit checks.
- Add report-ready charting to `build_chart`: `report`, `print` and `slides` styles, `target`, `highlight`, `unit`, `caption`, `source.analysis`, `title_from`, provenance comments (`# chart-hands source:`), and deterministic `facts`, `titleDraft`, `factLines` and `reportSnippet` outputs.
- Add non-blocking presentation `advice` to `check_chart` and `build_chart`, report provenance and advice counts in `read_charts`, and add the `report` topic to `get_chart_guide`.
- Add the `suggest_chart` tool to recommend chart types and ready-to-run `build_chart` arguments from a dataset's shape and user request, and raise data tool result limits to 16,000 characters (returning `RESULT_TOO_LARGE` instead of truncating oversized chart outputs).
- The tool descriptor changes (new suggest_chart tool, new arguments and result limits), so hosts must reapprove the provider.

## 0.10.16

- The "New Plotly chart" commands keep the code fence on its own lines, so inserting mid-sentence or above a heading no longer breaks the chart.
- The Dataviewjs command tells you when Dataview is not enabled.
- Add "Insert Plotly chart" to the editor right-click menu.
- The settings tab starts with how to add a chart.

## 0.10.14

- Build charts directly from vault CSV columns with shared EDA filters, numeric validation and frozen values for HWPX export.
- Return EDA JSON once, report matched filter ranges and unlisted numeric columns, and cap row pages at 100 with continuation guidance.
- Suggest CSV paths and column names on errors; profile ten columns per page.
- The updated tool descriptor declares CSV reads and changes its digest, so hosts must reapprove the provider.

## 0.10.9

- Clarify when to use summary and return overall values for non-additive grouped aggregates.
- The updated tool descriptor changes its digest, so hosts must reapprove the provider.

## 0.10.8

- Clarify multi-column summary shares and remind agents to check notes for column meanings and units.
- The updated tool descriptor changes its digest, so hosts must reapprove the provider.

## 0.10.7

- Clarify row sorting errors and show the sort direction in results.

## 0.10.6

- Support summaries of multiple columns and sorted row inspection.
- The updated tool descriptor changes its digest, so hosts must reapprove the provider.

## 0.10.5

- Add filtered CSV analysis, summary sums, and paginated row inspection.
- The updated tool descriptor changes its digest, so hosts must reapprove the provider.

## 0.10.4

- Raise the aggregate default limit to 60 and explain truncated results and their limits.
- The updated tool descriptor changes its digest, so hosts must reapprove the provider.
