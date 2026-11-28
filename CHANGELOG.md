# Changelog

## 0.12.0

- Add `summary` (one value or share per column) and `pivot` (long table to a heatmap grid or one series per category) to `eda_analyze` and to `build_chart` `source.analysis`. A `count` pivot fills combinations without rows with 0; other functions keep `null`. Pivot blocks are written as YAML and fall back to one-line JSON only when the result would exceed the result size limit.
- Draw `indicator` as a gauge (`gauge: true`) with `target` as the threshold and delta reference; percentage gaps are shown in %p.
- `read_charts`: `chart` plus `compare` lists the values that differ from the source data; charts built by `build_chart` carry a `# chart-hands build v1:` recipe line, so `read_charts` returns `rebuild` arguments and the `snippet` line range (block plus fact lines).
- `build_chart` `from_chart` restyles an existing block (style, target line, title, caption) without changing its data, including hand-written blocks.
- `check_chart` adds line hints for blocks that do not parse (unquoted colours, unknown top-level keys, tabs); an empty `fit: {}` no longer stops rendering.
- `suggest_chart` reads chart forms, column names, order words and a single filter value from the request, and returns up to three overview candidates when no goal is given. ISO weeks (`2026-W45`, `주차`, `week`) are period columns by default.
- Name scatter and bubble points from `source.labels`. With a source, `series[].text` must have one label per point; a mismatched length is an error that points to `source.labels`.
- Chronological sort for period columns, ranked `barh` with the first item on top, raw decimals from the data, `normalizedArgs` for repaired arguments, errors with the file's own column names, `source.x` read as the category column on category charts, and folderless file names resolved when unique.
- `get_chart_guide` `dataviewjs` starts with the Dataview state line and adds a note-count example. The `data-insight-chart` Skill (ko, en) covers existing charts, vault note counts, live charts and HWPX export.
- README and README.ko: request examples for wide and long tables, gauges, existing charts, vault counts and live charts.

## 0.11.5

- Ship the `data-insight-chart` Skill (Korean and English) with the plugin. An AI host that supports `host-capabilities-v1` (Verbex, latest version) reads it through the new `describeAssets()` and `readAsset()` provider members. The tool descriptor is unchanged, so older hosts keep working.
- Show on the settings tab whether an enabled AI host can read the plugin's Skills.

## 0.11.4

- Sort ties and labels with one fixed collation instead of the machine locale, so `eda_profile` top values and aggregate group order are the same on every computer (an en-US machine used to order Latin before Hangul).
- First published release of the 0.11.3 changes below (the 0.11.3 tag never got a release because its CI failed on this ordering).

## 0.11.3

- Match English requests in `suggest_chart` at parity with Korean: English negation (`except`, `without`, `not`, `n't`, …), direction phrases (`compared with/to`, `against`, `relative to`, `from A to B`, `as the base/baseline`), prior-period comparison phrases (`year over year`, `YoY`, `MoM`, `QoQ`, …), highlight/display/table wording, English number words (`one`–`ten`), rank and delta quantities, target values (`target of N`, `90% target`, …), and expanded goal keywords.
- Parse English numeric units and currency codes (`K`, `k`, `M`, `B`, `bn`, `mn`, `thousand`, `million`, `billion`, `USD`, `EUR`, `KRW`, `JPY`, `GBP`, `pp`, `pcs`, `units`, `people`, `cases`, `items`, including prefix currency codes and parenthesized negatives) in EDA and charts, with consistent unit spacing (`3 million`, `1,200 USD`, `12 pp` vs `1.2K`, `10kg`) shared between `chart-facts` and `chart-builder`.
- Recognize English month names (`Jan 2025`, `January 2025`, `Jan. 2025`, `Jan-2025`, `2025 Jan`, and standalone month names in period columns) and half-years (`H1 2025`, `2025 H1`, `2025-H1`, `H1`, `H2`) in `periodKey`, column role classification, and `suggest_chart` requests.
- Read a currency symbol with a scale suffix (`$120K`, `€2.5M`, `$3 million`, `($1.2K)`) as one additive unit, shown as `$120K` / `$3 million`.
- Separate the unit in automatic English axis titles (`Change ($K)`); Korean titles are unchanged (`증감(억원)`).
- README and README.ko: new "Better with Verbex" section with plain-language requests and a real `suggest_chart` → `build_chart` output.
- Add side-by-side period comparison candidates to `suggest_chart` when `goal` is `compare` on repeated categories with a period column (and warn when no period is specified so the aggregate combines periods).

## 0.11.2

- Keep each series' own colour on `highlight.labels` categories in multi-series bar charts and pale it elsewhere, instead of painting every series the same highlight colour (series were indistinguishable).
- When `highlight.labels` is given beside `top`, `bottom`, `below_target` or `above_target`, use the labels and report the other selector in `ignoredArgs`; two rank selectors now fail with the received selector names.
- On a chart type without bars, the highlight error now names the type and says to change it to `bar` or `barh` or omit `highlight`.
- End the `build_chart` text result with an explicit next step: when the user asked for the chart in a note, insert `reportSnippet` (or `block`) with an edit tool, because a chart shown only in the reply is not saved. The `staticBlock` line now only says it is for HWPX/PPTX export.

## 0.11.1

- Run full `Plotly.validate` schema checks directly inside `build_chart` when Plotly is available, update `build_chart` and provider instructions accordingly, and let `check_chart` strip surrounding ` ```plotly ` / ` ~~~plotly ` fences.
- Allow `table: 1` on CSV paths (ignoring it) while still rejecting `table` ≥ 2, and treat `title` + `title_from` as using `title` with `title_from` reported in `ignoredArgs`.
- Return ready-to-run `chartArgs` from `eda_analyze` aggregate and compare results (preserved through result-size trimming), and mark `build_chart` `staticBlock` outputs as HWPX/PPTX export only (`staticBlockUse`).
- Omit empty `filter` arrays from provenance comments and automatic captions, format fact scopes with ` · ` instead of nested parentheses, remove inner parentheses in trend title drafts, and add a `Highlighted:` / `강조:` title draft template for `highlight.labels`.
- Report `referenceCandidates` and `needs: ["reference"]` for `suggest_chart` target goals when same-unit numeric columns exist, name actual conflicting keys with a concrete example on `source.analysis` errors, allow `highlight.labels` on multi-series `bar`, `barh` and `combo` charts (including static blocks), and accept prior-period comparison phrases (`전년 대비`, `전년 동기 대비`, `작년 대비`, `전월 대비`, `전기 대비`) with two explicit periods as chronological in `suggest_chart`.
- The tool descriptor changes (build_chart and check_chart wording, provider instructions), so hosts must reapprove the provider.

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
