# Chart Hands

Chart Hands renders [Plotly](https://plotly.com/javascript/) charts from code blocks in your Obsidian notes, and gives LLM agents a pair of "hands" — tools to check chart definitions before they are written into a note.

It is a fork of [obsidian-plotly](https://github.com/Dmitriy-Shulha/obsidian-plotly) by Dmitriy Shulha (MIT), updated to Plotly.js 4 and D3 7 and extended with width fitting, PDF export support and agent tools.

## Usage

Write a `plotly` code block. The content is YAML or JSON with the top-level keys `data`, `layout`, `config` and `fit`:

````
```plotly
data:
  - x: [0, 1, 2]
    y: [0, 1, 0]
```
````

Run **New Plotly chart** from the command palette to insert a starter block. Charts can also be drawn from DataviewJS:

```js
await window.loadPlotlyLibraries();
window.renderPlotly(this.container, data, layout, config);
```

Plotly.js and D3 are bundled in the plugin and loaded the first time a chart is drawn, so they do not slow down opening your vault.

## Settings

- **Fit chart width**: shrink only when wider than the note (default), always fill the width, or keep the original size. Override per chart with `fit: off`, `fit: shrink` or `fit: fill` in the block.
- **Keep aspect ratio when shrinking**.
- **Fit the page width when exporting to PDF**.

## Tools for LLM agents

Chart Hands exposes an agentinterop v1 capability provider on the plugin instance. A compatible agent host can read the tool definitions and call them, once you approve them in the host:

- `check_chart` — validates the content of a `plotly` block: YAML/JSON syntax, top-level keys, the `fit` value and Plotly's own attribute check. Does not change any note.
- `read_charts` — finds the `plotly` blocks in a note and reports line ranges, traces, titles and problems, 20 charts at a time.

Neither tool edits notes or draws charts. The plugin works the same without an agent host.

## Installation

Once listed, install **Chart Hands** from *Settings → Community plugins*. To install manually, copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<Vault>/.obsidian/plugins/chart-hands/`.

## Development

```
npm ci
npm run build   # bundles src/main.js with Plotly.js and D3 into main.js
npm test
npm run lint
```

## License

MIT. Copyright (c) 2021 Dmitriy Shulha, (c) 2026 everydaymind. Plotly.js and D3 are bundled under their own MIT and ISC licenses.
