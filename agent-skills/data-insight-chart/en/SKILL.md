---
name: Data insights and charts
description: Aggregates and compares numbers from Excel, CSV or note tables with tools, then writes evidence-based insights and report-ready Chart Hands charts. Also checks, refreshes and restyles charts already in a note. Numbers, chart choice and fact sentences come from tools.
trigger_keywords: [analyze the data, analyse the data, data analysis, numeric data, excel data, analyze the excel, analyze this spreadsheet, csv file, csv data, analyze the csv, derive insights, data insights, insights from the data, execution rate, achievement rate, year over year, versus target, versus plan, against the plan, report chart, chart for the report, compare performance, share chart, chart from the table, fix the chart, numbers in the chart, update the chart]
cross_document: true
tools: [list_files]
preferred-tools:
  - plg__excel-hands__list_workbooks
  - plg__excel-hands__read_range
  - plg__excel-hands__aggregate_range
  - plg__chart-hands__eda_profile
  - plg__chart-hands__eda_analyze
  - plg__chart-hands__suggest_chart
  - plg__chart-hands__build_chart
  - plg__chart-hands__check_chart
  - plg__chart-hands__get_chart_guide
required-plugins: [chart-hands]
---

# Data insights and charts

Use only values that a tool calculated for totals, averages, shares, ranks, changes and comparisons with a target. Do not add up cells yourself, and do not copy numbers into a chart.

If the request gives the values, or they are fixed facts such as the number of days in a month, build the chart from them without looking for a file, and say where the values came from. If you do not know the numbers, do not chart placeholder values; ask for the data.

## First, sort the request

- **Recommendations only** ("suggest", "don't make it yet"): report the `suggest_chart` candidates and stop. Do not call `build_chart`.
- **A chart already in a note** (explain it, check its numbers, refresh it, restyle it, add a target line or a series): see "Existing charts".
- **Counting notes in the vault** (notes per status, per month): see "Charts of vault notes".
- **A chart that updates when notes change**: see "Live charts".
- Anything else (a new chart from a CSV, a table or Excel): follow "Steps".

## Steps

1. **Find the data**: if you do not know the file, use `list_files` to find .xlsx, .csv files and notes. Read a table in a note with the note path and the table number (`table`, starting at 1). For Excel, use `list_workbooks` to see the sheet names.
2. **Check the structure**: for a CSV or a note table, run `eda_profile` to see column types, units (`%`, `$` and so on), missing cells and summary-row candidates. If there is a summary row such as "Total", exclude it with a filter `{"column": …, "op": "ne", "value": "Total"}` so it is not counted with the other rows. Do not stack a total column with its parts. A column that mixes units is refused; ask the user to pick one unit or fix the data. For Excel, read the header and first rows with `read_range` (`values: raw`).
3. **Pick the chart**: give `suggest_chart` the user's request (`request`) or a goal (`goal`). If the result has `confirm` or `needs`, ask the user only for those items and call it again with the answer. If a candidate has `build`, pass it to `build_chart` as it is. When there are several candidates, use the first and mention the others in one line each. `overview` means the candidates were picked from the shape of the data because the goal was unclear; say so.
4. **Calculate**: use `eda_analyze` with `aggregate` (one value per group), `compare` (two periods, or a value against its plan or target), `summary` (one value per column, such as totals or shares of country columns in a wide table) or `pivot` (a long table turned into rows × columns, for a heatmap or bars per series). For Excel, use `aggregate_range`. To chart a result, do not copy the numbers: pass the result's `chartArgs` to `build_chart` as they are.
5. **Build the chart**: for a report or approval document use `style: "report"`, for black-and-white printing `"print"`, for slides `"slides"`. Add `target` when there is a goal and `highlight` only for the items the request names. A single key figure is an `indicator` (`gauge: true` for a gauge). Units, axis titles and the source line come from the data.
6. **Check**: `build_chart` checks the blocks it builds against Plotly's schema; fix every problem in its result. If you write or edit a block yourself, run `check_chart` on it and fix every problem it reports. A block has only `data`, `layout`, `config` and `fit` at the top level; never put `build_chart` arguments such as `style` into a block. Advice items are optional notes for the user; do not rebuild just to clear them.
7. **Write into the note**: for the title, use the result's `titleDraft` (a title made from the facts) with `title_from: "facts"`, or give a title that states the same facts. Insert the result's `reportSnippet` (chart, fact list and source line) as it is, then add two or three sentences of interpretation, kept in three parts:
   - what the data shows (quote the numbers from the fact list as they are)
   - possible causes (only when the notes or data give evidence; say where)
   - what still needs checking
   For a document that will be exported to HWPX, insert the result's `staticBlock` instead of `reportSnippet` (a plotly block in the same note can block the export). Use the note name and folder the user asked for, and end the file name with `.md`. Write to the note through the editing tools and their approval step. Showing a block in the chat is not the same as writing it into the note.

## Existing charts

- Use `read_charts` to see each chart's number, line range, `snippet` and `rebuild`.
- **Are the numbers right?** Call `read_charts` with `chart` (its number) and `compare` (the source path, label column and value columns), and report only the differing values and missing labels. Do not compare by eye.
- **Refresh from the data**: if there is `rebuild`, pass it to `build_chart` as it is and replace the whole `snippet` range (chart and fact lines) with the new `reportSnippet`. Without `rebuild`, call `build_chart` with the same periods and series as the original chart.
- **Restyle or add a target line only**: call `build_chart` with `from_chart` (note path and chart number) and `style`, `target`, `title` or `caption`, then replace only the `replaces` range. The data stays as it is.
- **Add a series or change the type**: call `build_chart` again from the source data and replace only that chart's range.
- When you change a chart, edit only that range and leave the rest of the note as it is.

## Charts of vault notes

Put the note counts per group that the host's note-counting tool returned into `labels` and `series[].values` as they are, and state the basis (folder, conditions) in `caption`. Do not count from a list of notes yourself. If two keys must be counted together (such as month × kind), use the counting tool's cross-tab; if it has none, say so.

## Live charts

Read `get_chart_guide` with `dataviewjs`. Its first line gives the current state of Dataview and JavaScript queries. Only when both are on, adapt its example and insert a `dataviewjs` block. If either is off or cannot be checked, tell the user and offer a fixed chart instead.

## Rules

- Do not use judgement words (excellent, poor, improved) that the data does not support.
- Call a ratio to a plan or reference "achieved" only when it is the target; otherwise say "of the reference".
- A difference between two percentages is in %p; a rate of change is in %.
- If the result lists items left out of the comparison (a department present in one period only, excluded rows), mention them.
- Say that correlation is not causation.
- If a tool is missing (not reserved or switched off) and you cannot follow these steps, say what is missing instead of calculating by hand.
