'use strict';
// Bundles src/main.js with Plotly, D3 and Obsidian left external, so tests can run the plugin
// outside Obsidian with stubs for all three.
const esbuild = require('esbuild');
const path = require('node:path');

module.exports = function buildPlugin() {
    const result = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'src', 'main.js')],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
        target: 'es2021',
        external: ['obsidian', 'plotly.js-dist-min', 'd3'],
        logLevel: 'silent'
    });
    // esbuild keeps import() of external packages; a vm context has no dynamic import callback.
    return result.outputFiles[0].text.replace(/import\((["'][^"']+["'])\)/g, 'Promise.resolve().then(() => require($1))');
};
