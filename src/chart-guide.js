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
- Write titles as objects: title: {text: "Monthly sales"}, also for axes (xaxis: {title: {text: "Month"}}) and colour bars. This Plotly version does not show a title given as a plain string.
- Quote single letters used as values, such as overlaying: "y", so no YAML parser reads them as booleans.
- Write arrays as YAML lists or flow lists ([1, 2, 3]). Convert JSON examples into YAML indentation instead of pasting them.
- Use only static values: no JavaScript functions, callbacks, variables, template expressions or undefined.

Choosing a chart type. Pick by the question the chart answers, not by habit; [name] is the build_chart type, (topic) is the get_chart_guide topic with a hand-written example.
- Trend over time: line [line]. Volume or part-to-whole over time: stacked area [area]. Long daily or price series: add range_slider, or candlestick/ohlc (timeseries).
- Compare categories: bar [bar]; long labels or more than about 8 items: horizontal bar [barh], sorted by value. Two measures with different units: bars plus a line on a secondary y axis [combo].
- Share of a whole: pie or donut [pie, donut], only with up to 6 parts; otherwise a sorted bar. Nested shares: treemap or sunburst [treemap, sunburst], icicle (hierarchy).
- How a total builds up from gains and losses: waterfall [waterfall]. Drop-off through stages: funnel [funnel]. Flows between groups or stages: sankey (hierarchy).
- Distribution of raw values: histogram [histogram]. Compare distributions across groups: box or violin [box, violin]. Two-variable density: histogram2dcontour (statistical).
- Relationship between two measures: scatter [scatter]; a third measure as point size: bubble [bubble]; many variables at once: splom or parcoords (statistical, scientific). Uncertainty: error bars or a confidence band (statistical).
- Values on a grid such as weekday by hour, or a correlation matrix: heatmap [heatmap]. A function of two variables: contour or surface (scientific).
- Profile of items across several criteria: radar [radar]. Direction and magnitude: barpolar wind rose (scientific). Three parts that sum to a constant: scatterternary (scientific).
- One headline number with its change: indicator [indicator]; a gauge or a KPI row (timeseries, layout).
- Places: scattergeo or choropleth, tile maps with scattermap (maps).
- Several panels, a secondary axis, buttons, sliders, reference lines or rich hover text: (layout).

Prefer the simplest chart that answers the question. Use an advanced type when the data really has that shape (hierarchy, flow, distribution, matrix), not for decoration, and say in one line why you chose it.

Keep the user's units and order. If a unit is unclear, do not convert it; show the original unit in an axis title.

Workflow: write the block, call check_chart with the block content (without the fence lines), fix every problem it reports, then insert the block into the note with the host's note-editing tools. These tools never change notes themselves. build_chart produces a checked block for every [name] type above; write the other types by hand from the topic examples.`;

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
  title:
    text: "Monthly sales"
  xaxis:
    title:
      text: "Month"
  yaxis:
    title:
      text: "Sales (10k KRW)"
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
  title:
    text: "Quarterly results"
  barmode: group
  yaxis:
    title:
      text: "Amount (10k KRW)"
\`\`\`

Pie chart:
\`\`\`plotly
data:
  - type: pie
    labels: ["A", "B", "C", "D"]
    values: [40, 25, 20, 15]
layout:
  title:
    text: "Share by item"
\`\`\``;

const STATISTICAL = `Distributions, uncertainty and relationships. Replace the sample numbers with the user's data.

Overlaid histograms (raw values, Plotly does the binning; barmode overlay plus opacity keeps both visible; histnorm "percent" compares groups of different size):
\`\`\`plotly
data:
  - {type: histogram, x: [52, 61, 58, 70, 66, 59, 73, 64, 68, 55], name: "Class A", nbinsx: 8, opacity: 0.6, marker: {color: "#2563EB"}}
  - {type: histogram, x: [48, 57, 62, 51, 60, 54, 49, 63, 58, 50], name: "Class B", nbinsx: 8, opacity: 0.6, marker: {color: "#C2410C"}}
layout:
  title: {text: "Score distribution"}
  barmode: overlay
  xaxis: {title: {text: "Score"}}
  yaxis: {title: {text: "Students"}}
\`\`\`

Box or violin by group: one trace per series; for groups inside each series give x as a category per point and set layout.boxmode (violinmode) to group. boxpoints "all" with jitter 0.3 shows every point when there are few. Violin: box: {visible: true}, meanline: {visible: true}, side "positive" for half violins.
\`\`\`plotly
data:
  - {type: box, name: "Plant 1", y: [4.1, 4.5, 3.9, 5.2, 4.8, 6.9], boxmean: sd, boxpoints: all, jitter: 0.3}
  - {type: violin, name: "Plant 2", y: [5.0, 5.4, 4.7, 5.9, 5.1, 5.6], box: {visible: true}, meanline: {visible: true}}
layout:
  title: {text: "Cycle time by plant"}
  yaxis: {title: {text: "Minutes"}}
  showlegend: false
\`\`\`

Correlation matrix heatmap: fixed zmin -1, zmax 1 and a diverging scale centred on 0 (reversescale puts positive values in blue); texttemplate prints the value in each cell; autorange reversed keeps the first row on top.
\`\`\`plotly
data:
  - type: heatmap
    x: ["Price", "Ads", "Visits", "Sales"]
    y: ["Price", "Ads", "Visits", "Sales"]
    z: [[1, -0.2, -0.4, -0.5], [-0.2, 1, 0.7, 0.6], [-0.4, 0.7, 1, 0.8], [-0.5, 0.6, 0.8, 1]]
    zmin: -1
    zmax: 1
    colorscale: RdBu
    reversescale: true
    texttemplate: "%{z:.2f}"
    xgap: 2
    ygap: 2
layout:
  title: {text: "Correlation"}
  yaxis: {autorange: reversed}
\`\`\`

Density of many points: histogram2dcontour (or histogram2d) with x and y arrays, ncontours 15, colorscale Blues, optionally under a scatter trace with small translucent markers.

Scatter matrix (splom) for 3 to 6 numeric variables:
\`\`\`plotly
data:
  - type: splom
    dimensions:
      - {label: "Height (cm)", values: [160, 172, 181, 168, 175]}
      - {label: "Weight (kg)", values: [55, 70, 82, 63, 74]}
      - {label: "Age", values: [23, 35, 41, 29, 38]}
    text: ["A", "B", "C", "D", "E"]
    marker: {size: 7, color: "#2563EB", line: {color: "#FFFFFF", width: 0.5}}
    diagonal: {visible: false}
    showupperhalf: false
layout:
  title: {text: "Body measures"}
\`\`\`

Uncertainty:
- Error bars: error_y: {type: data, array: [0.4, 0.3, 0.5], visible: true}; asymmetric with symmetric: false and arrayminus. error_x works the same way.
- Confidence band: an upper trace with line width 0, then a lower trace with fill tonexty and fillcolor "rgba(37, 99, 235, 0.15)", then the mean line. Set showlegend: false on the band traces.

Trend lines and moving averages: Plotly does not fit them. Compute the fitted or averaged values from the user's data yourself, add them as an extra line trace (dash "dash") and say how they were computed.`;

const HIERARCHY = `Hierarchies, flows and step-by-step totals.

Treemap, sunburst and icicle take the same data: labels (unique; use ids when two nodes share a name), parents ("" for a top-level node) and values. branchvalues "total" means a parent's value is the sum of its children; it draws nothing when a parent is smaller than its children, so leave branchvalues out (remainder: a parent's value is added to its children) unless the parent values are exact sums. Use maxdepth 2 for deep trees, and textinfo "label+value+percent parent". Change type to sunburst or icicle without changing the data; icicle takes tiling: {orientation: v} for a top-down layout.
\`\`\`plotly
data:
  - type: treemap
    labels: ["Total", "Hardware", "Software", "Services", "Laptops", "Phones", "Licences", "Cloud"]
    parents: ["", "Total", "Total", "Total", "Hardware", "Hardware", "Software", "Software"]
    values: [100, 45, 35, 20, 25, 20, 15, 20]
    branchvalues: total
    textinfo: "label+value+percent parent"
    marker: {line: {color: "#FFFFFF", width: 2}}
layout:
  title: {text: "Revenue by segment (100M KRW)"}
  margin: {l: 10, r: 10, t: 60, b: 10}
\`\`\`

Sankey for flows between groups or stages: node.label lists every node once; link.source and link.target are 0-based indexes into node.label; link.value is the size of each flow. All three link arrays must have the same length. Give node colours and translucent link colours; arrangement snap lets the user drag nodes.
\`\`\`plotly
data:
  - type: sankey
    arrangement: snap
    node:
      label: ["Visitors", "Sign-up", "Bounce", "Paid", "Free"]
      color: ["#64748B", "#2563EB", "#C2410C", "#0F766E", "#7C3AED"]
      pad: 18
      thickness: 16
    link:
      source: [0, 0, 1, 1]
      target: [1, 2, 3, 4]
      value: [620, 380, 140, 480]
      color: ["rgba(37, 99, 235, 0.3)", "rgba(194, 65, 12, 0.3)", "rgba(15, 118, 110, 0.3)", "rgba(124, 58, 237, 0.3)"]
layout:
  title: {text: "Visitor flow"}
\`\`\`

Waterfall for how a starting value becomes an ending value: measure lists relative (a change), total (draws the running total; its y is ignored, use 0) or absolute (resets the level) for each x.
\`\`\`plotly
data:
  - type: waterfall
    x: ["Revenue", "Cost of sales", "Gross profit", "Opex", "Tax", "Net profit"]
    measure: [absolute, relative, total, relative, relative, total]
    y: [500, -210, 0, -150, -35, 0]
    texttemplate: "%{delta:,.0f}"
    textposition: outside
    increasing: {marker: {color: "#0F766E"}}
    decreasing: {marker: {color: "#C2410C"}}
    totals: {marker: {color: "#2563EB"}}
    connector: {line: {color: "#64748B", dash: dot}}
layout:
  title: {text: "Profit bridge (M KRW)"}
  showlegend: false
\`\`\`

Funnel for drop-off through ordered stages: y holds the stages top to bottom, x the counts; textinfo "value+percent initial" (or "percent previous"). Several funnel traces with layout.funnelmode group compare segments side by side. funnelarea draws a proportional funnel from labels and values, like a pie.

Parallel categories (parcats) shows how records split across several categorical dimensions: dimensions: [{label: "Plan", values: [...]}, {label: "Region", values: [...]}], one value per record in every dimension; colour by a number with line: {color: [...], colorscale: Blues}.

Prefer a sorted bar chart when there is only one level, and a sankey only when the flows really connect stages.`;

const TIMESERIES = `Dates, prices, events and KPI numbers.

Date axes: quote ISO dates ("2026-03-01" or "2026-03-01 09:30"). Plotly detects a date axis; set xaxis.type date only if it does not. Format ticks with tickformat "%b %Y" and hover with hoverformat "%Y-%m-%d". Hide weekends or closed hours with rangebreaks: [{pattern: "day of week", bounds: [6, 1]}, {pattern: hour, bounds: [18, 9]}] (6 to 1 skips Saturday and Sunday).

Range slider and range buttons for long series:
\`\`\`plotly
data:
  - {type: scatter, mode: lines, name: "Visits", x: ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"], y: [1200, 1350, 1280, 1610, 1720, 1690], line: {color: "#2563EB", width: 2}}
layout:
  title: {text: "Monthly visits"}
  xaxis:
    rangeslider: {visible: true}
    rangeselector:
      buttons:
        - {count: 3, label: "3M", step: month, stepmode: backward}
        - {count: 1, label: "YTD", step: year, stepmode: todate}
        - {step: all, label: "All"}
  yaxis: {title: {text: "Visits"}}
\`\`\`

Candlestick (or ohlc) for prices: x, open, high, low and close arrays of the same length. The range slider is on by default; turn it off with xaxis.rangeslider.visible false when there are few points.
\`\`\`plotly
data:
  - type: candlestick
    name: "ABC"
    x: ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]
    open: [101, 104, 103, 107, 106]
    high: [105, 106, 108, 109, 108]
    low: [99, 102, 101, 104, 102]
    close: [104, 103, 107, 106, 103]
    increasing: {line: {color: "#0F766E"}}
    decreasing: {line: {color: "#C2410C"}}
layout:
  title: {text: "ABC daily price"}
  xaxis: {rangeslider: {visible: false}, rangebreaks: [{pattern: "day of week", bounds: [6, 1]}]}
  yaxis: {title: {text: "Price (USD)"}}
\`\`\`
Add volume as a bar trace on yaxis y2 with layout.yaxis.domain [0.3, 1] and layout.yaxis2.domain [0, 0.25] (see layout for subplots).

Event periods and reference dates: layout.shapes with xref x and yref paper span the full height.
  shapes:
    - {type: rect, xref: x, yref: paper, x0: "2026-02-01", x1: "2026-03-01", y0: 0, y1: 1, fillcolor: "rgba(100, 116, 139, 0.12)", line: {width: 0}, layer: below}
    - {type: line, xref: x, yref: paper, x0: "2026-04-01", x1: "2026-04-01", y0: 0, y1: 1, line: {color: "#C2410C", dash: dot}}
Label them with an annotation (xref x, yref paper, y 1, showarrow false) and base the label on the user's material.

KPI indicator with change and gauge:
\`\`\`plotly
data:
  - type: indicator
    mode: "number+delta+gauge"
    value: 87
    title: {text: "Satisfaction (%)"}
    delta: {reference: 82, increasing: {color: "#0F766E"}, decreasing: {color: "#C2410C"}}
    gauge:
      axis: {range: [0, 100]}
      bar: {color: "#2563EB"}
      threshold: {value: 90, line: {color: "#C2410C", width: 3}, thickness: 0.8}
layout:
  margin: {l: 30, r: 30, t: 60, b: 20}
  height: 260
\`\`\`
mode "number+delta" alone gives a plain KPI tile; delta.relative true with valueformat ".1%" shows the change in percent. Several indicators in one chart: give each trace domain: {row: 0, column: 0} and set layout.grid: {rows: 1, columns: 3}.`;

const SCIENTIFIC = `3D, contour, polar, ternary and multivariate charts.

Surface or contour from a grid: z is a list of rows (one list per y value); x and y give the grid coordinates. contour takes contours: {coloring: heatmap, showlabels: true}; a surface sits in layout.scene with xaxis, yaxis and zaxis titles.
\`\`\`plotly
data:
  - type: contour
    x: [0, 1, 2, 3, 4]
    y: [0, 1, 2, 3]
    z: [[1, 2, 3, 2, 1], [2, 4, 6, 4, 2], [3, 6, 9, 6, 3], [2, 4, 6, 4, 2]]
    colorscale: Viridis
    contours: {coloring: heatmap, showlabels: true}
    colorbar: {title: {text: "Yield"}}
layout:
  title: {text: "Yield by temperature and pressure"}
  xaxis: {title: {text: "Temperature step"}}
  yaxis: {title: {text: "Pressure step"}}
\`\`\`
For 3D change type to surface and use layout.scene: {xaxis: {title: {text: "..."}}, yaxis: {...}, zaxis: {...}, camera: {eye: {x: 1.6, y: 1.6, z: 0.9}}}. scatter3d takes x, y, z arrays with mode markers or lines; mesh3d takes vertex arrays. Use 3D only when the third dimension matters: a heatmap or contour is easier to read.

Wind rose or cyclic categories with barpolar (several traces stack by direction):
\`\`\`plotly
data:
  - {type: barpolar, name: "0-5 m/s", r: [8, 5, 4, 6, 9, 7, 5, 6], theta: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], marker: {color: "#93C5FD"}}
  - {type: barpolar, name: "5-10 m/s", r: [4, 3, 2, 3, 6, 5, 3, 2], theta: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], marker: {color: "#2563EB"}}
layout:
  title: {text: "Wind direction (%)"}
  polar:
    angularaxis: {direction: clockwise, rotation: 90}
    radialaxis: {ticksuffix: "%"}
\`\`\`
scatterpolar with fill toself makes a radar chart (build_chart type radar); repeat the first point at the end to close the outline.

Ternary for three parts that sum to a constant (soil, mixtures, budget splits):
\`\`\`plotly
data:
  - type: scatterternary
    mode: "markers+text"
    a: [40, 20, 60]
    b: [30, 50, 10]
    c: [30, 30, 30]
    text: ["S1", "S2", "S3"]
    textposition: "top center"
    marker: {size: 10, color: "#2563EB"}
layout:
  title: {text: "Mixture composition (%)"}
  ternary:
    sum: 100
    aaxis: {title: {text: "Sand"}}
    baxis: {title: {text: "Silt"}}
    caxis: {title: {text: "Clay"}}
\`\`\`

Parallel coordinates for many numeric columns of the same records:
\`\`\`plotly
data:
  - type: parcoords
    line: {color: [1, 2, 3, 4], colorscale: Viridis, showscale: true}
    dimensions:
      - {label: "Price", values: [12, 18, 9, 15]}
      - {label: "Rating", values: [4.2, 4.6, 3.8, 4.4], range: [1, 5]}
      - {label: "Delivery (days)", values: [3, 5, 2, 4]}
layout:
  title: {text: "Supplier comparison"}
\`\`\`

A table trace shows exact numbers next to a chart: header: {values: ["Item", "Qty"]}, cells: {values: [["A", "B"], [3, 5]]} (cells.values holds columns, not rows).

WebGL traces (scattergl, scatter3d, surface, mesh3d, splom, parcoords) need WebGL; browsers allow only a limited number of WebGL charts on one page, so keep them few in a note. Use scattergl instead of scatter only above roughly 10,000 points.`;

const MAPS = `Maps need an internet connection: geo traces download country outlines and tile maps download map tiles. Say so when you add one, and offer a bar chart of the same values for offline use.

Choropleth or bubble map of countries (geo): locations are ISO-3 codes with locationmode ISO-3.
\`\`\`plotly
data:
  - type: choropleth
    locationmode: ISO-3
    locations: ["KOR", "JPN", "USA", "DEU", "FRA"]
    z: [52, 41, 77, 63, 58]
    text: ["Korea", "Japan", "United States", "Germany", "France"]
    colorscale: Blues
    colorbar: {title: {text: "Index"}}
    marker: {line: {color: "#FFFFFF", width: 0.5}}
layout:
  title: {text: "Index by country"}
  geo: {projection: {type: "natural earth"}, showframe: false, showcoastlines: false, showland: true, landcolor: "#F1F5F9"}
\`\`\`
scattergeo takes lat and lon (or locations) and marker.size for bubbles; layout.geo.scope (asia, europe, usa, ...) zooms to a region, and fitbounds locations zooms to the data.

Tile maps (MapLibre): scattermap, densitymap and choroplethmap with layout.map. The free styles open-street-map, carto-positron and carto-darkmatter need no token.
\`\`\`plotly
data:
  - type: scattermap
    lat: [37.5665, 35.1796, 35.8714]
    lon: [126.978, 129.0756, 128.6014]
    text: ["Seoul", "Busan", "Daegu"]
    mode: "markers+text"
    textposition: "top right"
    marker: {size: [18, 12, 10], color: "#2563EB"}
layout:
  title: {text: "Offices"}
  map: {style: carto-positron, center: {lat: 36.3, lon: 127.8}, zoom: 5.5}
  margin: {l: 0, r: 0, t: 50, b: 0}
\`\`\`
choroplethmap needs geojson: a URL string to a GeoJSON file, with featureidkey matching locations. The mapbox traces (scattermapbox, choroplethmapbox, densitymapbox) and layout.mapbox no longer exist in this Plotly version; use the map ones.`;

const LAYOUT = `Combining views, interaction and annotation in one chart.

Subplots: layout.grid places axes in rows and columns; each trace picks its axes with xaxis x2 and yaxis y2 (x3/y3, ...), and each axis is styled as xaxis2, yaxis2. Pie, indicator, sunburst and other non-axis traces use domain: {row: 0, column: 1} instead.
\`\`\`plotly
data:
  - {type: bar, x: ["Q1", "Q2", "Q3", "Q4"], y: [120, 150, 170, 160], name: "Revenue", marker: {color: "#2563EB"}}
  - {type: scatter, mode: "lines+markers", x: ["Q1", "Q2", "Q3", "Q4"], y: [8.1, 9.4, 10.2, 9.8], name: "Margin", xaxis: x2, yaxis: y2, line: {color: "#C2410C"}}
layout:
  title: {text: "Revenue and margin"}
  grid: {rows: 1, columns: 2, pattern: independent}
  yaxis: {title: {text: "Revenue (M KRW)"}}
  yaxis2: {title: {text: "Margin (%)"}}
  showlegend: false
\`\`\`
For panels that share an x axis use grid pattern coupled, or set yaxis.domain and yaxis2.domain by hand (e.g. [0.35, 1] and [0, 0.3]) with both traces on x.

Secondary y axis (two units on one plot): put the second trace on yaxis y2 and set
  yaxis2: {title: {text: "Rate (%)"}, overlaying: "y", side: right, showgrid: false, tickmode: auto}
tickmode auto keeps round tick values; without it the second axis aligns its ticks to the first axis grid.
Use it for two different units only, never to make two series of the same unit look alike.

Rich hover: hovertemplate "%{x}<br>Sales %{y:,.0f} KRW<extra></extra>" (<extra></extra> hides the trace name box). Pass extra columns with customdata (a list of lists, one per point) and refer to them as %{customdata[0]}. hovermode "x unified" compares series at one x.

Reference lines and bands: layout.shapes with type line or rect. xref paper with x0 0 and x1 1 spans the full width:
  shapes:
    - {type: line, xref: paper, x0: 0, x1: 1, y0: 100, y1: 100, line: {color: "#C2410C", dash: dash, width: 1.5}}
    - {type: rect, xref: paper, x0: 0, x1: 1, y0: 80, y1: 120, fillcolor: "rgba(15, 118, 110, 0.08)", line: {width: 0}, layer: below}
  annotations:
    - {xref: paper, x: 1, y: 100, text: "Target", showarrow: false, xanchor: right, yanchor: bottom}

Buttons (updatemenus) switch series or settings without code: method restyle changes traces, relayout changes the layout, update does both. args are static values.
\`\`\`plotly
data:
  - {type: bar, name: "2025", x: ["A", "B", "C"], y: [3, 5, 2], marker: {color: "#64748B"}}
  - {type: bar, name: "2026", x: ["A", "B", "C"], y: [4, 6, 3], marker: {color: "#2563EB"}}
layout:
  title: {text: "Sales by item"}
  updatemenus:
    - type: buttons
      direction: right
      x: 0
      y: 1.15
      xanchor: left
      buttons:
        - {label: "Both", method: restyle, args: [{visible: [true, true]}]}
        - {label: "2025", method: restyle, args: [{visible: [true, false]}]}
        - {label: "2026", method: restyle, args: [{visible: [false, true]}]}
    - type: buttons
      direction: right
      x: 1
      y: 1.15
      xanchor: right
      buttons:
        - {label: "Linear", method: relayout, args: [{"yaxis.type": linear}]}
        - {label: "Log", method: relayout, args: [{"yaxis.type": log}]}
\`\`\`
type dropdown gives a menu instead of buttons. Quote keys that contain a dot ("yaxis.type").

Sliders step through views (a year, a scenario): layout.sliders: [{active: 0, currentvalue: {prefix: "Year: "}, steps: [{label: "2025", method: restyle, args: [{visible: [true, false]}]}, {label: "2026", method: restyle, args: [{visible: [false, true]}]}]}], with one trace per step.

Animations are not available: the block allows only data, layout, config and fit, so there are no frames. Use a slider or buttons instead.

Legends: legendgroup ties traces that toggle together; legend.groupclick togglegroup; showlegend false hides helper traces such as bands. Put a horizontal legend above the plot with legend: {orientation: h, y: 1.02, yanchor: bottom, x: 0}.`;

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
- A treemap, sunburst or icicle is empty: every parent must be one of the labels (or ""), labels must be unique (or use ids), and with branchvalues total a parent must not be smaller than the sum of its children. Remove branchvalues to fall back to remainder.
- A sankey shows no links: link.source and link.target are 0-based indexes into node.label, and source, target and value need the same length.
- A heatmap, contour or surface is blank: z must be a list of rows (a list of lists), with one entry per x in each row.
- A map stays empty: maps need an internet connection; mapbox trace types do not exist in this Plotly version (use scattermap, choroplethmap, densitymap with layout.map).
- A 3D or WebGL chart is blank: WebGL may be unavailable, or the note has too many WebGL charts.
- check_chart reports a title "must be linked to an object container": write title: {text: "..."} instead of a plain string.
- "frames" is reported as an unsupported key: animations are not available; use layout.sliders or updatemenus.
- After inserting, ask the user to confirm the block renders as a chart in reading view, or use read_charts to confirm it is found with no problems.`;

export const GUIDE_TOPICS = {
    basics: BASICS,
    style: STYLE,
    examples: EXAMPLES,
    statistical: STATISTICAL,
    hierarchy: HIERARCHY,
    timeseries: TIMESERIES,
    scientific: SCIENTIFIC,
    maps: MAPS,
    layout: LAYOUT,
    dataviewjs: DATAVIEWJS,
    errors: ERRORS
};
