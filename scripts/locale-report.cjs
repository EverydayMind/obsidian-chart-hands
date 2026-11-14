'use strict';
// Optional measurement command: node scripts/locale-report.cjs [directory with js-tiktoken].
// Measures the entire compact descriptor JSON with cl100k_base, including metadata.
const path = require('node:path');
const paths = [process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..')];
const { Tiktoken } = require(require.resolve('js-tiktoken/lite', { paths }));
const ranks = require(require.resolve('js-tiktoken/ranks/cl100k_base', { paths }));
const encoding = new Tiktoken(ranks);
const { loadHarness } = require('../test/helpers/locale-harness');
const h = loadHarness(require('../test/helpers/build-plugin')(), 'ko');
(async () => {
    const descriptors = {};
    for (const locale of ['ko', 'en']) descriptors[locale] = await h.exports.createAgentProvider({
        manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: {}
    }, locale).describe();
    const tokens = Object.fromEntries(Object.entries(descriptors).map(([locale, value]) => [locale, encoding.encode(JSON.stringify(value)).length]));
    const en = descriptors.en;
    const report = { encoding: 'cl100k_base', tokens, budget: 8000,
        maxToolDescriptionChars: Math.max(...en.tools.map(t => t.description.length)),
        instructionsChars: en.instructions.length,
        translatedKeywordLiterals: new Set(descriptors.ko.tools.flatMap(t => t._meta['dev.agentinterop/keywords']).filter(s => /[가-힣]/u.test(s))).size };
    console.log(JSON.stringify(report, null, 2));
    if (tokens.en > 8000 || report.maxToolDescriptionChars > 1024 || report.instructionsChars > 2000) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
