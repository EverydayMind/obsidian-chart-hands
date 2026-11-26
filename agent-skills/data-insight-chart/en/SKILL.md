---
name: Data insights and charts
description: Aggregates and compares numbers from Excel (.xlsx), CSV or tables in notes with tools, then writes evidence-based insights and report-ready Chart Hands charts. Calculation, chart choice, number formatting and fact sentences come from tool results, not from the model.
trigger_keywords: [analyze the data, analyse the data, data analysis, numeric data, excel data, analyze the excel, analyze this spreadsheet, csv file, csv data, analyze the csv, derive insights, data insights, insights from the data, execution rate, achievement rate, year over year, versus target, versus plan, against the plan, report chart, chart for the report, compare performance, share chart, chart from the table]
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

## Steps

1. **Find the data**: if you do not know the file, use `list_files` to find .xlsx, .csv files and notes. Read a table in a note with the note path and the table number (`table`, starting at 1). For Excel, use `list_workbooks` to see the sheet names.
2. **Check the structure**: for a CSV or a note table, run `eda_profile` to see column types, units (`%`, `$` and so on), missing cells and summary-row candidates. If there is a summary row such as "Total", exclude it with a filter `{"column": …, "op": "ne", "value": "Total"}` so it is not counted with the other rows. A column that mixes units is refused; ask the user to pick one unit or fix the data. For Excel, read the header and first rows with `read_range` (`values: raw`).
3. **Pick the chart**: give `suggest_chart` the user's request (`request`) or a goal (`goal`). If the result has `confirm` or `needs`, ask the user only for those items and call it again with the answer. If a candidate has `build`, pass it to `build_chart` as it is. When there are several candidates, use the first and mention the others in one line each.
4. **Calculate**: use `eda_analyze` with `aggregate` (one value per group) or `compare` (two periods, or a value against its plan or target). For Excel, use `aggregate_range`. To chart a result, do not copy the numbers: give `build_chart` the same analysis in `source.analysis`.
5. **Build the chart**: for a report or approval document use `style: "report"`, for black-and-white printing `"print"`, for slides `"slides"`. Add `target` when there is a goal and `highlight` only for the items the request names. Units, axis titles and the source line come from the data.
6. **Check**: `build_chart` checks the blocks it builds against Plotly's schema; fix every problem in its result. If you write or edit a block yourself, run `check_chart` on it and fix every problem it reports. Advice items are optional notes for the user; do not rebuild just to clear them.
7. **Write into the note**: for the title, use the result's `titleDraft` (a title made from the facts) with `title_from: "facts"`, or give a title that states the same facts. Insert the result's `reportSnippet` (chart, fact list and source line) as it is, then add two or three sentences of interpretation, kept in three parts:
   - what the data shows (quote the numbers from the fact list as they are)
   - possible causes (only when the notes or data give evidence; say where)
   - what still needs checking
   Write to the note through the editing tools and their approval step. Showing a block in the chat is not the same as writing it into the note.

## Rules

- Do not use judgement words (excellent, poor, improved) that the data does not support.
- Call a ratio to a plan or reference "achieved" only when it is the target; otherwise say "of the reference".
- A difference between two percentages is in %p; a rate of change is in %.
- If the result lists items left out of the comparison (a department present in one period only, excluded rows), mention them.
- Say that correlation is not causation.
- If a tool is missing (not reserved or switched off) and you cannot follow these steps, say what is missing instead of calculating by hand.
