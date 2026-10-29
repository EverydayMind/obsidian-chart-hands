# Chart Hands

Chart Hands draws interactive [Plotly](https://plotly.com/javascript/) charts in your Obsidian notes from short `plotly` code blocks, with no JavaScript needed. You can hover over a chart to read values and drag to zoom. Charts fit the note width, and they fit the page when you export a note to PDF.

Chart Hands also gives LLM agents a pair of "hands": tools that build and check chart blocks before an agent writes them into a note. You don't need an agent to use the plugin.

It is a fork of [obsidian-plotly](https://github.com/Dmitriy-Shulha/obsidian-plotly) by Dmitriy Shulha (MIT), updated to Plotly.js 4 and D3 7. It adds width fitting, PDF export support and the agent tools. It works on desktop and mobile.

**Contents:** [Quick start](#quick-start) · [Writing a plotly block](#writing-a-plotly-block) · [Using examples from plotly.com](#using-examples-from-plotlycom) · [Charts from vault data (DataviewJS)](#charts-from-vault-data-dataviewjs) · [When a chart doesn't show](#when-a-chart-doesnt-show) · [Settings](#settings) · [Examples](#examples) · [Tools for LLM agents](#tools-for-llm-agents) · [Installation](#installation)

## Quick start

1. Install and enable Chart Hands (see [Installation](#installation)).
2. Open a note, press `Ctrl+P` (`Cmd+P` on macOS) and run **Chart Hands: New Plotly chart**, or paste this block:

   ````
   ```plotly
   data:
     - x: [0, 1, 2]
       y: [0, 1, 0]
   ```
   ````

3. Move the cursor out of the block in Live Preview, or switch to Reading view, and a line chart appears. The first chart can take a moment, because Plotly loads the first time a chart is drawn. A "loading Plotly and D3…" notice shows while that happens.

Next, try a bar chart with a title and axis labels:

````
```plotly
data:
  - type: bar
    x: ["Mon", "Tue", "Wed", "Thu", "Fri"]
    y: [3, 5, 2, 6, 4]
layout:
  title: {text: "Hours of focus"}
  xaxis: {title: {text: "Day"}}
  yaxis: {title: {text: "Hours"}}
```
````

Change `type: bar` to `type: scatter` to draw a line instead. When that works, copy any chart from [Examples](#examples) and replace the numbers with your own.

## Writing a `plotly` block

The block is YAML or JSON (both are read the same way) with up to four top-level keys:

| Key | What it holds |
| --- | --- |
| `data` | A list of traces. Each trace is one series: its `type` (`bar`, `scatter`, `pie`, `heatmap`, …) and its values (`x`, `y`, `labels`, `values`, …). Without a `type`, a trace is drawn as `scatter`. |
| `layout` | Optional. The title, axes, legend, size, margins, reference lines (`shapes`) and notes (`annotations`). |
| `config` | Optional. Interaction options such as `displaylogo: false`, `displayModeBar: false` or `scrollZoom: true`. |
| `fit` | Optional. `off`, `shrink` or `fill`, to override the **Fit chart width** setting for this chart only. |

These are the objects that Plotly.js takes in `Plotly.newPlot(div, data, layout, config)`. Every option is listed in the [Plotly.js reference](https://plotly.com/javascript/reference/).

A few YAML rules cause most of the problems:

- **Quote colours**: write `color: "#2563EB"`. Without quotes, `#` starts a YAML comment and the colour is lost.
- **Quote dates**: write `x: ["2026-01-05", "2026-01-12"]`, so the values stay as text and Plotly reads them as dates.
- **Write titles as objects**: write `title: {text: "Sales"}`. Plotly.js 4 doesn't show a title written as a plain string.
- **Indent with spaces**, never tabs, and start each trace with `- `.
- **No JavaScript**: a `plotly` block holds values only, so functions, variables and `new Date()` don't work. For computed data, use [DataviewJS](#charts-from-vault-data-dataviewjs).

## Using examples from plotly.com

The [Plotly.js examples](https://plotly.com/javascript/) are written in JavaScript. When an example only builds objects from plain values, copy those objects into a `plotly` block. This example:

```js
var trace1 = {x: [1, 2, 3, 4], y: [10, 15, 13, 17], type: 'scatter'};
var trace2 = {x: [1, 2, 3, 4], y: [16, 5, 11, 9], type: 'scatter'};
var layout = {title: {text: 'Two lines'}};
Plotly.newPlot('myDiv', [trace1, trace2], layout);
```

becomes:

````
```plotly
data:
  - {x: [1, 2, 3, 4], y: [10, 15, 13, 17], type: scatter}
  - {x: [1, 2, 3, 4], y: [16, 5, 11, 9], type: scatter}
layout:
  title: {text: "Two lines"}
```
````

If the example computes its values (loops, `Math.random()`, `d3.csv(...)`), run it in a DataviewJS block instead.

## Charts from vault data (DataviewJS)

For a chart computed from your notes, or a plotly.com example that runs code, use a `dataviewjs` block. This needs the [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugin with **Enable JavaScript queries** turned on in its settings.

Run **Chart Hands: New Plotly chart (Dataviewjs)** to insert a starter block. When you paste a plotly.com example, replace `Plotly.newPlot` with `window.renderPlotly` and draw into `this.container`:

```js
// plotly.com
Plotly.newPlot('myDiv', data, layout, config);
// DataviewJS in Obsidian
window.renderPlotly(this.container, data, layout, config);
```

This block counts the notes created in each month:

````
```dataviewjs
const counts = {};
for (const page of dv.pages()) {
  const month = page.file.ctime.toFormat('yyyy-MM');
  counts[month] = (counts[month] || 0) + 1;
}
const months = Object.keys(counts).sort();
window.renderPlotly(this.container,
  [{type: 'bar', x: months, y: months.map(m => counts[m]), marker: {color: '#2563EB'}}],
  {title: {text: 'Notes created per month'}});
```
````

`window.renderPlotly` waits for Plotly to load by itself. An optional fifth argument (`'off'`, `'shrink'` or `'fill'`) sets the width fitting for that chart. Plotly.js and D3 are bundled, so unlike obsidian-plotly you don't need to download D3 into your vault. Code that calls `Plotly` or `d3` directly must load them first:

```js
const { Plotly, d3 } = await window.loadPlotlyLibraries();
```

## When a chart doesn't show

| What you see | What to check |
| --- | --- |
| The block stays as code | The plugin is enabled, and the fence language is exactly `plotly` in lowercase. In Live Preview, move the cursor outside the block. |
| `Couldn't render plot:` followed by a YAML error | Indentation (spaces, not tabs), a missing `- ` before a trace, or an unclosed quote or bracket. The message shows the line. |
| `The only valid keys are data, layout, config and fit.` | A key such as `title` or `type` is at the top level. Move it under `layout` or into a trace. |
| `There should be a valid JSON in this block.` | The block is empty, or it holds only comments. |
| The chart is drawn but a colour or title is missing | Quote `#` colours, and write titles as `title: {text: "..."}`. |
| A "could not load Plotly" notice | Reopen the note. Chart Hands tries to load Plotly again the next time a chart is drawn. |
| A DataviewJS block draws nothing | Dataview is installed with JavaScript queries enabled, and the code calls `window.renderPlotly(this.container, ...)` rather than `Plotly.newPlot`. |

## Settings

Open *Settings → Chart Hands*:

- **Fit chart width**: *Shrink only when wider* (the default) narrows charts that are wider than the note. *Always fill the width* stretches every chart to the note width. *Off* keeps the original size (`layout.width`, or Plotly's 700 px). To change one chart, add `fit: off`, `fit: shrink` or `fit: fill` to its block.
- **Keep aspect ratio when shrinking** (on by default): scales the height along with the width.
- **Fit the page width when exporting to PDF** (on by default): shrinks charts that are wider than the page, so they aren't cut off when you export to PDF or print.

## Examples

Copy any block below into a note. All of them are YAML except the last, which shows the same format in JSON. The colours come from the Chart Hands palette, so you only need to replace the sample numbers and labels with your own.

| To show | Example |
| --- | --- |
| A trend over time | [Line chart with a target line](#line-chart-with-a-target-line), [Time series with a range slider](#time-series-with-a-range-slider-and-an-event-band) |
| A comparison between categories | [Grouped bars](#grouped-bars-with-value-labels), [Stacked bars](#stacked-bars), [Bars and a line on a secondary axis](#bars-and-a-line-on-a-secondary-axis) |
| Parts of a whole | [Donut chart](#donut-chart), [Sunburst](#sunburst) |
| How values are spread | [Box plots](#box-plots) |
| A relationship between measures | [Bubble chart](#bubble-chart) |
| A grid of values | [Heatmap habit tracker](#heatmap-habit-tracker) |
| Flows and running totals | [Sankey diagram](#sankey-diagram), [Waterfall](#waterfall) |
| Key numbers | [KPI row with a gauge](#kpi-row-with-a-gauge) |
| Items rated on several criteria | [Radar chart](#radar-chart) |
| Switching views | [Buttons that switch views](#buttons-that-switch-views) |
| The JSON format | [JSON and the fit key](#json-and-the-fit-key) |

### Line chart with a target line

Two series, a dashed line for last year, and a reference line drawn with `shapes`.

````
```plotly
data:
  - type: scatter
    mode: lines+markers
    name: "2025"
    x: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    y: [32, 35, 31, 40, 43, 47]
    line: {color: "#64748B", dash: dash}
  - type: scatter
    mode: lines+markers
    name: "2026"
    x: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    y: [38, 41, 44, 46, 52, 55]
    line: {color: "#2563EB", width: 3}
layout:
  title: {text: "Monthly active users"}
  hovermode: "x unified"
  yaxis: {title: {text: "Users (thousands)"}, rangemode: tozero}
  shapes:
    - {type: line, xref: paper, x0: 0, x1: 1, y0: 50, y1: 50, line: {color: "#C2410C", dash: dot}}
  annotations:
    - {xref: paper, x: 0, y: 50, text: "Target", showarrow: false, xanchor: left, yanchor: bottom}
config:
  responsive: true
  displaylogo: false
```
````

### Grouped bars with value labels

````
```plotly
data:
  - {type: bar, name: "Plan", x: ["Q1", "Q2", "Q3", "Q4"], y: [120, 140, 160, 180], marker: {color: "#64748B"}}
  - type: bar
    name: "Actual"
    x: ["Q1", "Q2", "Q3", "Q4"]
    y: [115, 152, 171, 168]
    marker: {color: "#2563EB"}
    texttemplate: "%{y}"
    textposition: outside
    cliponaxis: false
layout:
  title: {text: "Plan vs actual"}
  barmode: group
  yaxis: {title: {text: "Amount (M KRW)"}}
```
````

### Stacked bars

`barmode: stack` piles the categories of each month on top of each other.

````
```plotly
data:
  - {type: bar, name: "Housing", x: ["Jul", "Aug", "Sep", "Oct"], y: [900, 900, 900, 900], marker: {color: "#2563EB"}}
  - {type: bar, name: "Food", x: ["Jul", "Aug", "Sep", "Oct"], y: [420, 465, 390, 440], marker: {color: "#0F766E"}}
  - {type: bar, name: "Transport", x: ["Jul", "Aug", "Sep", "Oct"], y: [150, 180, 140, 160], marker: {color: "#7C3AED"}}
  - {type: bar, name: "Other", x: ["Jul", "Aug", "Sep", "Oct"], y: [230, 310, 205, 260], marker: {color: "#64748B"}}
layout:
  title: {text: "Monthly spending by category"}
  barmode: stack
  yaxis: {title: {text: "Amount (1,000 KRW)"}}
```
````

### Bars and a line on a secondary axis

Use a second y axis only when the two series have different units.

````
```plotly
data:
  - {type: bar, name: "Orders", x: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], y: [320, 340, 390, 410, 460, 480], marker: {color: "#2563EB"}}
  - type: scatter
    mode: lines+markers
    name: "Return rate"
    x: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    y: [4.2, 3.9, 4.5, 3.6, 3.1, 2.8]
    yaxis: y2
    line: {color: "#C2410C"}
layout:
  title: {text: "Orders and return rate"}
  yaxis: {title: {text: "Orders"}}
  yaxis2: {title: {text: "Return rate (%)"}, overlaying: "y", side: right, showgrid: false, tickmode: auto, rangemode: tozero}
  legend: {orientation: "h", x: 0, y: -0.15}
```
````

### Donut chart

````
```plotly
data:
  - type: pie
    hole: 0.55
    labels: ["Deep work", "Meetings", "Email", "Admin", "Learning"]
    values: [18, 9, 6, 4, 3]
    sort: false
    textinfo: "label+percent"
    marker:
      colors: ["#2563EB", "#C2410C", "#64748B", "#7C3AED", "#0F766E"]
      line: {color: "#FFFFFF", width: 2}
layout:
  title: {text: "Where the week went"}
  showlegend: false
  annotations:
    - {text: "40 h", showarrow: false, font: {size: 22}, xref: paper, yref: paper, x: 0.5, y: 0.5}
```
````

### Bubble chart

Marker size carries a third measure; `hovertemplate` shows all three.

````
```plotly
data:
  - type: scatter
    mode: markers+text
    x: [12, 25, 8, 30, 18]
    y: [4.1, 3.6, 4.6, 3.2, 4.3]
    text: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]
    customdata: [120, 340, 80, 510, 220]
    textposition: "top center"
    marker: {size: [16, 30, 12, 40, 22], color: "#2563EB", opacity: 0.6, line: {color: "#FFFFFF", width: 1}}
    hovertemplate: "%{text}<br>Price %{x} USD<br>Rating %{y}<br>Sold %{customdata}<extra></extra>"
layout:
  title: {text: "Price, rating and units sold"}
  xaxis: {title: {text: "Price (USD)"}}
  yaxis: {title: {text: "Rating"}}
```
````

### Box plots

Compare distributions; `boxpoints: all` also shows every value.

````
```plotly
data:
  - {type: box, name: "Weekdays", y: [6.1, 6.5, 6.8, 7.0, 6.2, 5.9, 6.6, 7.1, 6.4, 6.0], boxmean: true, boxpoints: all, jitter: 0.3, marker: {color: "#2563EB"}}
  - {type: box, name: "Weekends", y: [7.5, 8.2, 7.8, 8.6, 9.0, 7.2], boxmean: true, boxpoints: all, jitter: 0.3, marker: {color: "#0F766E"}}
layout:
  title: {text: "Hours of sleep"}
  yaxis: {title: {text: "Hours"}}
  showlegend: false
```
````

### Heatmap habit tracker

`z` is a list of rows, one per `y` value. `autorange: reversed` keeps week 1 on top.

````
```plotly
data:
  - type: heatmap
    x: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    y: ["Week 1", "Week 2", "Week 3", "Week 4"]
    z:
      - [30, 45, 0, 60, 20, 90, 0]
      - [40, 30, 50, 0, 35, 120, 60]
      - [0, 55, 45, 50, 40, 0, 75]
      - [60, 50, 40, 70, 0, 100, 90]
    colorscale: Blues
    texttemplate: "%{z}"
    xgap: 3
    ygap: 3
    colorbar: {title: {text: "Minutes"}}
layout:
  title: {text: "Reading minutes per day"}
  yaxis: {autorange: reversed}
```
````

### Sunburst

`parents` links each label to its parent (`""` for the root). With `branchvalues: total` each parent's value is the sum of its children. Change `type` to `treemap` or `icicle` to draw the same data another way.

````
```plotly
data:
  - type: sunburst
    labels: ["Projects", "Work", "Personal", "Report", "Website", "Garden", "Language"]
    parents: ["", "Projects", "Projects", "Work", "Work", "Personal", "Personal"]
    values: [60, 40, 20, 24, 16, 8, 12]
    branchvalues: total
    textinfo: "label+value"
layout:
  title: {text: "Hours by project this month"}
  margin: {l: 10, r: 10, t: 60, b: 10}
```
````

### Sankey diagram

`link.source` and `link.target` are 0-based indexes into `node.label`.

````
```plotly
data:
  - type: sankey
    node:
      label: ["Salary", "Side income", "Budget", "Housing", "Living", "Savings", "Investing"]
      color: ["#2563EB", "#7C3AED", "#64748B", "#C2410C", "#C2410C", "#0F766E", "#0F766E"]
      pad: 18
      thickness: 16
    link:
      source: [0, 1, 2, 2, 2, 2]
      target: [2, 2, 3, 4, 5, 6]
      value: [3000, 500, 1000, 1200, 800, 500]
      color: "rgba(100, 116, 139, 0.25)"
layout:
  title: {text: "Where the money goes (1,000 KRW)"}
```
````

### Waterfall

`measure` marks each step as `absolute` (a starting level), `relative` (a change) or `total` (the running total; its `y` is ignored).

````
```plotly
data:
  - type: waterfall
    x: ["Opening", "Salary", "Rent", "Living", "Savings", "Closing"]
    measure: [absolute, relative, relative, relative, relative, total]
    y: [1200, 3000, -1000, -1200, -800, 0]
    texttemplate: "%{delta:,.0f}"
    textposition: outside
    increasing: {marker: {color: "#0F766E"}}
    decreasing: {marker: {color: "#C2410C"}}
    totals: {marker: {color: "#2563EB"}}
    connector: {line: {color: "#64748B", dash: dot}}
layout:
  title: {text: "Cash this month (1,000 KRW)"}
  showlegend: false
```
````

### Time series with a range slider and an event band

Quote the dates so they stay strings. The grey band marks a period; the buttons above the chart zoom to the last month or three.

````
```plotly
data:
  - type: scatter
    mode: lines+markers
    name: "Distance"
    x: ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23", "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"]
    y: [18, 22, 25, 21, 27, 8, 5, 12, 20, 26, 30, 28]
    line: {color: "#2563EB", width: 2}
layout:
  title: {text: "Weekly running distance"}
  xaxis:
    rangeslider: {visible: true}
    rangeselector:
      buttons:
        - {count: 1, label: "1M", step: month, stepmode: backward}
        - {count: 3, label: "3M", step: month, stepmode: backward}
        - {step: all, label: "All"}
  yaxis: {title: {text: "km"}}
  shapes:
    - {type: rect, xref: x, yref: paper, x0: "2026-02-06", x1: "2026-02-20", y0: 0, y1: 1, fillcolor: "rgba(100, 116, 139, 0.15)", line: {width: 0}, layer: below}
  annotations:
    - {xref: x, yref: paper, x: "2026-02-13", y: 1, text: "Knee injury", showarrow: false, yanchor: bottom}
```
````

### KPI row with a gauge

Indicators are placed in a `grid` with `domain`.

````
```plotly
data:
  - type: indicator
    mode: number+delta
    value: 1284
    title: {text: "Visitors"}
    delta: {reference: 1130}
    domain: {row: 0, column: 0}
  - type: indicator
    mode: number+delta
    value: 0.042
    number: {valueformat: ".1%"}
    title: {text: "Conversion"}
    delta: {reference: 0.038, valueformat: ".1%"}
    domain: {row: 0, column: 1}
  - type: indicator
    mode: gauge+number
    value: 87
    title: {text: "Satisfaction"}
    gauge:
      axis: {range: [0, 100]}
      bar: {color: "#2563EB"}
      threshold: {value: 90, line: {color: "#C2410C", width: 3}, thickness: 0.8}
    domain: {row: 0, column: 2}
layout:
  grid: {rows: 1, columns: 3, pattern: independent}
  height: 260
  margin: {l: 30, r: 30, t: 50, b: 20}
```
````

### Radar chart

Repeat the first point at the end to close each outline.

````
```plotly
data:
  - type: scatterpolar
    name: "Laptop A"
    r: [4, 3, 5, 4, 2, 4]
    theta: ["Speed", "Battery", "Screen", "Keyboard", "Weight", "Speed"]
    fill: toself
    line: {color: "#2563EB"}
  - type: scatterpolar
    name: "Laptop B"
    r: [3, 5, 3, 4, 4, 3]
    theta: ["Speed", "Battery", "Screen", "Keyboard", "Weight", "Speed"]
    fill: toself
    line: {color: "#C2410C", dash: dash}
layout:
  title: {text: "Laptop comparison (1 to 5)"}
  polar: {radialaxis: {range: [0, 5]}}
```
````

### Buttons that switch views

`updatemenus` change the chart without code: `method: restyle` shows or hides traces, `method: relayout` changes the layout.

````
```plotly
data:
  - {type: bar, name: "2025", x: ["North", "South", "East", "West"], y: [380, 290, 340, 300], marker: {color: "#64748B"}}
  - {type: bar, name: "2026", x: ["North", "South", "East", "West"], y: [420, 310, 380, 290], marker: {color: "#2563EB"}}
layout:
  title: {text: "Revenue by region (M KRW)", x: 0, xanchor: left}
  margin: {t: 100}
  updatemenus:
    - type: buttons
      direction: right
      x: 0
      y: 1.12
      xanchor: left
      yanchor: bottom
      buttons:
        - {label: "Both", method: restyle, args: [{visible: [true, true]}]}
        - {label: "2025", method: restyle, args: [{visible: [true, false]}]}
        - {label: "2026", method: restyle, args: [{visible: [false, true]}]}
    - type: buttons
      direction: right
      x: 1
      y: 1.12
      xanchor: right
      yanchor: bottom
      buttons:
        - {label: "Grouped", method: relayout, args: [{barmode: group}]}
        - {label: "Stacked", method: relayout, args: [{barmode: stack}]}
```
````

### JSON and the `fit` key

The block can also be JSON. `fit: fill` stretches this chart to the note width, whatever the plugin setting.

````
```plotly
{
  "data": [{"type": "bar", "x": ["A", "B", "C"], "y": [3, 5, 2], "marker": {"color": "#2563EB"}}],
  "layout": {"title": {"text": "Written in JSON"}},
  "fit": "fill"
}
```
````

## Tools for LLM agents

You can skip this section if you don't use an AI agent in Obsidian.

Chart Hands exposes an agentinterop v1 capability provider on the plugin instance. A compatible agent host can read the tool definitions and call them, once you approve them in the host:

- `get_chart_guide`: returns writing guidance by topic, so the agent reads only what it needs. `basics` maps the question a chart answers (trend, comparison, share, distribution, relationship, matrix, hierarchy, flow, stages, profile, KPI) to a chart type; `statistical`, `hierarchy`, `timeseries`, `scientific`, `maps` and `layout` give checked examples of Plotly's advanced charts (box and violin, correlation heatmaps, splom, treemap and sunburst, sankey, waterfall, candlestick with range buttons, gauges, contour and 3D, polar, ternary, parallel coordinates, maps, subplots, buttons and sliders). `style`, `examples`, `dataviewjs` and `errors` cover the look, basic examples, DataviewJS and fixes.
- `build_chart`: builds a ready-to-insert `plotly` block from plain data (labels and series), with the Chart Hands palette, and checks it. Types: line, area, bar, barh, combo (bars and lines with an optional secondary axis), scatter, bubble, pie, donut, treemap, sunburst, waterfall, funnel, histogram, box, violin, heatmap, radar and indicator. Line, area, bar and scatter charts can add a range slider.

  Compatible compact inputs also return `staticBlock` for HWPX export. The `chart-hands-static` block previews in Chart Hands; a compatible HWPX Exporter renders it to PNG from its data. It accepts JSON data only. Text including `<`, `>`, `&` and `$` is displayed literally, not interpreted as HTML or math. Control characters and external sources are unsupported. If the block is absent, this path is unavailable. Saving still requires the export tool's approval flow.
- `check_chart`: validates the content of a `plotly` block: YAML/JSON syntax, top-level keys, the `fit` value, common mistakes (unquoted `#` colours, dates, plain-string titles, JavaScript-like values, mismatched array lengths), the data shapes of advanced traces (treemap parents, sankey links, candlestick prices, waterfall measures, grid `z`, removed mapbox types) and Plotly's own attribute check.
- `read_charts`: finds the `plotly` blocks in a note and reports line ranges, traces, titles and problems, 20 charts at a time.

None of the tools edits a note or draws a chart. The agent inserts the returned block with the host's own note-editing tools. The plugin works the same without an agent host.

### About the agentinterop v1 provider

agentinterop v1 is the author's own convention, not an official or widely recognized standard. It lets an Obsidian plugin that runs an AI agent discover tools offered by other plugins through an MCP-like API, without those plugins knowing about any particular agent host.

How Chart Hands implements it:

- The plugin instance holds the provider under the key `Symbol.for('dev.agentinterop.capability-provider')`. The provider has `protocol: 'agentinterop'`, `protocolVersion: 1`, `describe()` (returns the provider info, instructions and tool definitions with JSON Schema inputs) and `callTool(name, args)` (returns `content` plus `structuredContent`, or an error with a code).
- Tool definitions carry `_meta` hints under the `dev.agentinterop/` prefix: `effect` (`pure` or `read`), `group`, `keywords`, `resourceTypes` and `maxResultChars`. A host shows these tools to the model only when a request matches a keyword such as "plotly", "chart" or "graph".
- The plugin triggers the `agentinterop:providers-changed` workspace event on load and unload so a host can refresh its tool list.
- All tools are read-only: they never modify notes or draw charts.

## Installation

**From the community plugins list** (once Chart Hands is listed): open *Settings → Community plugins*, turn off Restricted mode if it is on, select **Browse**, search for **Chart Hands**, then select **Install** and **Enable**.

**Manually**:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/EverydayMind/obsidian-chart-hands/releases/latest).
2. Create the folder `<Vault>/.obsidian/plugins/chart-hands/` and put the three files in it. The `.obsidian` folder is hidden on some systems.
3. Restart Obsidian, or reload the community plugins list, then enable **Chart Hands** in *Settings → Community plugins*.

## Development

```
npm ci
npm run build   # bundles src/main.js with Plotly.js and D3 into main.js
npm test
npm run lint
```

## License

MIT. Copyright (c) 2021 Dmitriy Shulha, (c) 2026 everydaymind. Plotly.js and D3 are bundled under their own MIT and ISC licenses.
