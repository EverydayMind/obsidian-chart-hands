// Guidance returned by the get_chart_guide agent tool. Each topic is kept short enough to fit
// one tool result, so an agent reads only the part it needs.

export const PALETTE = {
    primary: '#2563EB',
    highlight: '#C2410C',
    neutral: '#64748B',
    grid: '#E2E8F0',
    text: '#334155',
    title: '#0F172A',
    series2: '#0F766E',
    series3: '#7C3AED'
};

const BASICS = `Chart Hands renders a fenced code block whose language is "plotly". The block content is YAML (or JSON) with these top-level keys only: data, layout, config, fit. Any other key stops the chart from drawing.

- data: list of Plotly traces. Give every trace a "type" and its value arrays.
- layout: title, axis titles, legend, barmode, margins and other static display settings.
- config: static UI settings such as responsive: true and displaylogo: false.
- fit: off, shrink or fill. Controls width fitting for this chart. Leave it out unless asked.

YAML rules that matter:
- Quote every colour: color: "#2563EB". An unquoted # starts a YAML comment and the value becomes null.
- Quote date-like strings ("2026-01-01") so they stay strings.
- Quote strings that contain a colon.
- Write arrays as YAML lists or flow lists ([1, 2, 3]). Convert JSON examples into YAML indentation instead of pasting them.
- Use only static values: no JavaScript functions, callbacks, variables, template expressions or undefined.

Choosing a chart type:
- Trend over time: type scatter with mode lines+markers.
- Category comparison: type bar; several series use layout.barmode group or stack.
- Share of a whole: type pie with labels and values.
- Correlation or distribution: type scatter with mode markers.

Keep the user's units and order. If a unit is unclear, do not convert it; show the original unit in an axis title.

Workflow: write the block, call check_chart with the block content (without the fence lines), fix every problem it reports, then insert the block into the note with the host's note-editing tools. These tools never change notes themselves. build_chart can produce a checked block for the common chart types.`;

const STYLE = `Apply this only when the user asks for a polished, clean or report-ready look. These are structure hints, not a finished chart: rewrite the real data, units, titles, hover text and annotations every time.

Palette (always quoted in YAML): primary "${PALETTE.primary}", highlight "${PALETTE.highlight}", neutral "${PALETTE.neutral}", grid "${PALETTE.grid}", text "${PALETTE.text}", title "${PALETTE.title}", series 2 "${PALETTE.series2}", series 3 "${PALETTE.series3}". Do not tell series apart by colour alone: also vary the line dash, marker symbol or labels.

layout:
  margin: {l: 50, r: 30, t: 90, b: 50, autoexpand: true}
  xaxis: {automargin: true, showgrid: false, showline: false, zeroline: false}
  yaxis: {automargin: true, showgrid: true, gridcolor: "${PALETTE.grid}", griddash: "dot", showline: false, zeroline: false}
config:
  responsive: true
  displaylogo: false

Notes:
- Automatic margins belong on axes and titles (automargin) and in margin.autoexpand, not at the top level of layout.
- Skip a fixed height and a horizontal legend for long titles or narrow panes.
- hovermode "x unified" suits series that share an x axis.
- Bar value labels: texttemplate "%{y:,.0f}" for vertical bars, "%{x:,.0f}" for horizontal bars. With textposition "outside" and cliponaxis false, check the top and bottom margins and negative values.
- Annotations: use only when needed (1 to 3), set xref and yref, and base causes or events on the user's material, never on the data alone.
- Plotly.js draws a white background and does not inherit the Obsidian theme. State a white background only for report or print requests; for a dark look set explicit colours for paper_bgcolor, plot_bgcolor, font and grid.
- When editing an existing chart, keep its data, layout, config, colours, axis ranges and uirevision and merge only the style properties you need.`;

const EXAMPLES = `Line chart:
\`\`\`plotly
data:
  - x: ["Jan", "Feb", "Mar", "Apr"]
    y: [120, 150, 135, 180]
    type: scatter
    mode: lines+markers
    name: "Sales"
    line:
      color: "#2563EB"
layout:
  title: "Monthly sales"
  xaxis:
    title: "Month"
  yaxis:
    title: "Sales (10k KRW)"
config:
  responsive: true
\`\`\`

Bar chart:
\`\`\`plotly
data:
  - x: ["Q1", "Q2", "Q3", "Q4"]
    y: [120, 200, 150, 180]
    type: bar
    name: "Result"
layout:
  title: "Quarterly results"
  barmode: group
  yaxis:
    title: "Amount (10k KRW)"
\`\`\`

Pie chart:
\`\`\`plotly
data:
  - type: pie
    labels: ["A", "B", "C", "D"]
    values: [40, 25, 20, 15]
layout:
  title: "Share by item"
\`\`\``;

const DATAVIEWJS = `Use DataviewJS only when the user explicitly wants a chart computed from dynamic vault data and the Dataview plugin is enabled. Present the block for the user to run; never promise that you executed JavaScript. Do not convert an existing dataviewjs chart into static YAML. When the user explicitly asks to change one, edit only its static layout and config literals.

\`\`\`dataviewjs
// Compute data, layout and config yourself, then call:
await window.renderPlotly(this.container, data, layout, config);
\`\`\`

Code that reads window.Plotly or window.d3 directly must first run: const { Plotly, d3 } = await window.loadPlotlyLibraries();
window.renderPlotly waits for the libraries by itself. Plotly.newPlot does not work inside DataviewJS; use window.renderPlotly. The read_charts tool counts dataviewjs chart blocks but does not check them.`;

const ERRORS = `- The block shows as plain code: the Chart Hands plugin is disabled, or the code fence language is not exactly "plotly".
- "Couldn't render plot": check that the top-level keys are only data, layout, config and fit, and that YAML indentation, quotes and list syntax are valid. Run check_chart on the block content.
- A colour is ignored or null: it was written without quotes. Write color: "#2563EB".
- A date axis shows odd values: quote the date strings.
- Nothing is drawn and no error is shown: the code fence may be unclosed; read_charts reports blocks without a closing fence.
- The chart is clipped in PDF export: the plugin setting "Fit the page width when exporting to PDF" can be turned on.
- After inserting, ask the user to confirm the block renders as a chart in reading view, or use read_charts to confirm it is found with no problems.`;

export const GUIDE_TOPICS = {
    basics: BASICS,
    style: STYLE,
    examples: EXAMPLES,
    dataviewjs: DATAVIEWJS,
    errors: ERRORS
};
