'use strict';
// Run: node --test test/new-chart-command.test.js
// Parses with the yaml package, which rejects tab indentation with the same error Obsidian's
// parseYaml gives. Plotly is stubbed to record what it is asked to draw.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const YAML = require('yaml');
const buildPlugin = require('./helpers/build-plugin');

const code = buildPlugin();
// What the New Plotly chart command inserted up to 0.9.6.
const OLD_TEMPLATE = 'data:\n\t- x: [0,1,2]\n\t  y: [0,1,0]\n';

async function setup(options = {}) {
    const commands = {}, drawn = [], notices = [], events = {}, settingTabs = [];
    let processor;
    const makeContainer = () => {
        const created = [];
        const node = (tag) => ({
            tag,
            children: [],
            empty() { created.length = 0; },
            createEl(childTag, opts) {
                const text = typeof opts === 'string' ? opts : opts?.text;
                const entry = { tag: childTag, cls: opts?.cls, text };
                created.push(entry);
                return node(childTag);
            },
            createDiv(opts) {
                const text = typeof opts === 'string' ? opts : opts?.text;
                const entry = { tag: 'div', cls: opts?.cls, text };
                created.push(entry);
                return node('div');
            },
            created
        });
        return node('div');
    };
    const obsidian = {
        Plugin: class {
            async loadData() { return {}; }
            registerMarkdownCodeBlockProcessor(name, fn) { processor = fn; }
            addCommand(command) { commands[command.name] = command; }
            addSettingTab(tab) { settingTabs.push(tab); }
            registerEvent() {}
        },
        PluginSettingTab: class { constructor() { this.containerEl = makeContainer(); } },
        Setting: class {
            setName() { return this; }
            setDesc() { return this; }
            addDropdown() { return this; }
            addToggle() { return this; }
        },
        MarkdownRenderChild: class {},
        Notice: class { constructor(message) { notices.push(message); } hide() {} },
        getIcon: id => (options.icons ? options.icons.includes(id) : id === 'bar-chart-3') ? {} : null,
        parseYaml: YAML.parse,
        stringifyYaml: YAML.stringify
    };
    const Plotly = {
        newPlot(gd, data) { drawn.push(data); gd.on = () => {}; return gd; },
        validate() { return []; },
        purge() {}
    };
    const stubs = { obsidian, d3: {}, 'plotly.js-dist-min': Plotly };
    const module = { exports: {} };
    const context = vm.createContext({ window: { setTimeout: fn => fn(), clearTimeout() {} },
        document: { createElement: () => ({}) }, console, module, exports: module.exports,
        require: name => stubs[name], WeakRef, structuredClone, Promise,
        ResizeObserver: class { observe() {} disconnect() {} } });
    vm.runInContext('Array.prototype.contains = Array.prototype.includes;', context);
    vm.runInContext(code, context);
    module.exports.setLocaleForTests(options.locale ?? 'en');
    const plugin = new module.exports.default();
    plugin.manifest = { id: 'chart-hands', name: 'Chart Hands', version: '0' };
    plugin.app = {
        workspace: {
            onLayoutReady(fn) { fn(); },
            trigger() {},
            on(name, fn) { (events[name] ??= []).push(fn); return { name, fn }; }
        },
        ...(options.plugins !== undefined ? { plugins: options.plugins } : {})
    };
    await plugin.onload();
    // Draws a block the way Obsidian calls the processor and returns what was drawn or shown.
    const render = async (content) => {
        const el = { children: [], appendChild(child) { this.children.push(child); return child; },
            ownerDocument: { createElement: () => ({ clientWidth: 0, style: {} }) } };
        const before = drawn.length;
        await processor(content, el, { addChild() {} });
        return { data: drawn.slice(before)[0], errors: el.children.map(child => child.textContent).filter(Boolean) };
    };
    const insert = (name) => {
        let inserted;
        commands[name].editorCallback({ getDoc: () => ({ getCursor: () => 0, replaceRange: text => { inserted = text; } }) });
        return inserted;
    };
    const createEditor = (docLines, pos) => {
        const lines = [...docLines];
        let cursor = { ...pos };
        let inserted;
        return {
            getDoc() { return this; },
            getLine: n => lines[n],
            lineCount: () => lines.length,
            getCursor: () => cursor,
            replaceRange(text, from) {
                inserted = text;
                const before = lines[from.line].slice(0, from.ch);
                const after = lines[from.line].slice(from.ch);
                const replaced = (before + text + after).split('\n');
                lines.splice(from.line, 1, ...replaced);
            },
            setCursor(next) { cursor = next; },
            result: () => ({ inserted, text: lines.join('\n'), lines, cursor })
        };
    };
    const insertAt = (name, docLines, pos) => {
        const editor = createEditor(docLines, pos);
        commands[name].editorCallback(editor);
        return editor.result();
    };
    return {
        plugin, render, insert, insertAt, createEditor,
        notices, events, settingTabs, exports: module.exports,
        setLocale: module.exports.setLocaleForTests
    };
}

test('Korean chart validation errors are shown in Korean', async () => {
    const h = await setup();
    h.setLocale('ko');
    assert.match((await h.render('null')).errors[0], /이 블록에 유효한 JSON이 있어야 합니다/);
    assert.match((await h.render('other: 1')).errors[0], /사용할 수 있는 키는 data, layout, config, fit뿐입니다/);
    h.plugin.onunload();
});

test('New Plotly chart inserts a block that parses and draws', async () => {
    const h = await setup();
    const inserted = h.insert('New Plotly chart');
    const [, body] = inserted.match(/^```plotly\n([\s\S]*?)^```/m);
    assert.doesNotMatch(body, /^ *\t/m);
    assert.deepEqual(YAML.parse(body), { data: [{ x: [0, 1, 2], y: [0, 1, 0] }] });
    const result = await h.render(body);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, [{ x: [0, 1, 2], y: [0, 1, 0] }]);
    h.plugin.onunload();
});

test('a block indented with tabs by an earlier template still draws', async () => {
    const h = await setup();
    assert.throws(() => YAML.parse(OLD_TEMPLATE), /Tabs are not allowed as indentation/);
    const result = await h.render(OLD_TEMPLATE);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, [{ x: [0, 1, 2], y: [0, 1, 0] }]);
    const provider = h.plugin[Symbol.for('dev.agentinterop.capability-provider')];
    const checked = await provider.callTool('check_chart', { source: OLD_TEMPLATE });
    assert.equal(checked.structuredContent.valid, true, checked.content[0].text);
    h.plugin.onunload();
});

test('a tab-indented block with another mistake still shows the error', async () => {
    const h = await setup();
    const result = await h.render('data:\n\t- x: [0, 1\n');
    assert.equal(result.data, undefined);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^Couldn't render plot:/);
    h.plugin.onunload();
});

test('blockInsertion separates code blocks cleanly across cursor and line contexts', async () => {
    const h = await setup();
    const { blockInsertion } = h.exports;
    const sample = '```plotly\ndata:\n  - x: [0, 1, 2]\n    y: [0, 1, 0]\n```';
    const cases = [
        { name: 'empty line', lineText: '', ch: 0, nextLineText: undefined, expectedPrefix: '', expectedSuffix: '\n' },
        { name: 'line start with trailing text', lineText: '뒤에 글자', ch: 0, nextLineText: undefined, expectedPrefix: '', expectedSuffix: '\n\n' },
        { name: 'middle of line', lineText: '첫 문단입니다. 뒷글', ch: 8, nextLineText: undefined, expectedPrefix: '\n\n', expectedSuffix: '\n\n' },
        { name: 'end of line', lineText: '첫 문단입니다.', ch: 8, nextLineText: undefined, expectedPrefix: '\n\n', expectedSuffix: '\n' },
        { name: 'next line is heading', lineText: '', ch: 0, nextLineText: '# 제목', expectedPrefix: '', expectedSuffix: '\n\n' },
        { name: 'end of line before heading', lineText: '첫 문단입니다.', ch: 8, nextLineText: '# 제목', expectedPrefix: '\n\n', expectedSuffix: '\n\n' },
        { name: 'last line of document', lineText: '마지막 문단', ch: 6, nextLineText: undefined, expectedPrefix: '\n\n', expectedSuffix: '\n' },
        { name: 'empty line before blank line', lineText: '', ch: 0, nextLineText: '   ', expectedPrefix: '', expectedSuffix: '\n' }
    ];
    for (const c of cases) {
        const out = blockInsertion(sample, c.lineText, c.ch, c.nextLineText);
        assert.equal(out, `${c.expectedPrefix}${sample}${c.expectedSuffix}`, c.name);
        const doc = c.lineText.slice(0, c.ch) + out + c.lineText.slice(c.ch);
        assert.match(doc, /^```plotly$/m, `${c.name}: opening fence at line start`);
        assert.match(doc, /^```\n/m, `${c.name}: closing fence followed by newline`);
    }
    h.plugin.onunload();
});

test('insert commands isolate blocks and move cursor to the first data line', async () => {
    const h = await setup({ plugins: { enabledPlugins: new Set(['dataview']) } });
    const cases = [
        { name: 'empty line', lines: [''], pos: { line: 0, ch: 0 } },
        { name: 'line start with text', lines: ['trailing text'], pos: { line: 0, ch: 0 } },
        { name: 'middle of line', lines: ['첫 문단입니다. 뒷글'], pos: { line: 0, ch: 8 } },
        { name: 'end of line', lines: ['첫 문단입니다.'], pos: { line: 0, ch: 8 } },
        { name: 'next line is heading', lines: ['', '# 제목'], pos: { line: 0, ch: 0 } },
        { name: 'last line of document', lines: ['끝 줄'], pos: { line: 0, ch: 3 } }
    ];
    for (const c of cases) {
        const plotlyRes = h.insertAt('New Plotly chart', c.lines, c.pos);
        assert.match(plotlyRes.text, /^```plotly$/m, `plotly ${c.name}: opening fence`);
        assert.match(plotlyRes.text, /^```\n/m, `plotly ${c.name}: closing fence`);
        assert.equal(plotlyRes.lines[plotlyRes.cursor.line], '  - x: [0, 1, 2]');
        assert.equal(plotlyRes.cursor.ch, '  - x: [0, 1, 2]'.length);

        const dvRes = h.insertAt('New Plotly chart (Dataviewjs)', c.lines, c.pos);
        assert.match(dvRes.text, /^```dataviewjs$/m, `dataviewjs ${c.name}: opening fence`);
        assert.match(dvRes.text, /^```\n/m, `dataviewjs ${c.name}: closing fence`);
        const firstData = '{x:[0,1,2,3,4,5,6,7,8,9],y:[4,4,2,2,3,3,2,2,4,4]},';
        assert.equal(dvRes.lines[dvRes.cursor.line], firstData);
        assert.equal(dvRes.cursor.ch, firstData.length);
    }
    assert.equal(h.notices.length, 0);
    h.plugin.onunload();
});

test('Dataviewjs command warns once when Dataview is not enabled and still inserts block', async () => {
    const en = await setup({ locale: 'en' });
    assert.equal(en.exports.isDataviewEnabled(undefined), false);
    assert.equal(en.exports.isDataviewEnabled({ plugins: { enabledPlugins: new Set() } }), false);
    assert.equal(en.exports.isDataviewEnabled({ plugins: { enabledPlugins: new Set(['dataview']) } }), true);
    assert.equal(en.exports.isDataviewEnabled({ plugins: { plugins: { dataview: {} } } }), true);
    assert.equal(en.exports.isDataviewEnabled({ plugins: { get enabledPlugins() { throw new Error('blocked'); }, plugins: { dataview: {} } } }), true);

    const enRes = en.insertAt('New Plotly chart (Dataviewjs)', [''], { line: 0, ch: 0 });
    assert.match(enRes.text, /^```dataviewjs$/m);
    assert.deepEqual(en.notices, ['This block renders only when the Dataview plugin is enabled. For now it shows as code.']);
    en.plugin.onunload();

    const ko = await setup({ locale: 'ko' });
    const koRes = ko.insertAt('새 Plotly 차트 (Dataviewjs)', [''], { line: 0, ch: 0 });
    assert.match(koRes.text, /^```dataviewjs$/m);
    assert.deepEqual(ko.notices, ['이 블록은 Dataview 플러그인이 켜져 있어야 그려집니다. 지금은 코드만 보입니다.']);
    ko.plugin.onunload();
});

test('editor-menu adds localized Plotly insertion item with icon fallback', async () => {
    const en = await setup({ locale: 'en', icons: ['bar-chart-3'] });
    const editor = en.createEditor([''], { line: 0, ch: 0 });
    const items = [];
    const menu = {
        addItem(fn) {
            const item = {
                setTitle(title) { this.title = title; return this; },
                setIcon(icon) { this.icon = icon; return this; },
                onClick(cb) { this.cb = cb; return this; }
            };
            fn(item);
            items.push(item);
            return this;
        }
    };
    assert.equal(en.events['editor-menu'].length, 1);
    en.events['editor-menu'][0](menu, editor);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Insert Plotly chart');
    assert.equal(items[0].icon, 'bar-chart-3');
    items[0].cb();
    assert.match(editor.result().text, /^```plotly$/m);
    en.plugin.onunload();

    const ko = await setup({ locale: 'ko', icons: ['bar-chart'] });
    const koItems = [];
    ko.events['editor-menu'][0]({
        addItem(fn) {
            const item = {
                setTitle(title) { this.title = title; return this; },
                setIcon(icon) { this.icon = icon; return this; },
                onClick(cb) { this.cb = cb; return this; }
            };
            fn(item);
            koItems.push(item);
            return this;
        }
    }, ko.createEditor([''], { line: 0, ch: 0 }));
    assert.equal(koItems[0].title, 'Plotly 차트 삽입');
    assert.equal(koItems[0].icon, 'bar-chart');
    ko.plugin.onunload();
});

test('settings tab shows localized two-line guidance at the top', async () => {
    const en = await setup({ locale: 'en' });
    en.settingTabs[0].display();
    const enTexts = en.settingTabs[0].containerEl.created.map(entry => entry.text).filter(Boolean);
    assert.deepEqual(enTexts, [
        'To add a chart, run "New Plotly chart" from the command palette in a note, or right-click in the editor and choose "Insert Plotly chart".',
        'Edit data and layout inside the plotly code block and the chart redraws.'
    ]);
    en.plugin.onunload();

    const ko = await setup({ locale: 'ko' });
    ko.settingTabs[0].display();
    const koTexts = ko.settingTabs[0].containerEl.created.map(entry => entry.text).filter(Boolean);
    assert.deepEqual(koTexts, [
        '차트를 넣으려면 노트에서 명령 팔레트의 "새 Plotly 차트"를 실행하거나, 편집기에서 오른쪽 클릭 › "Plotly 차트 삽입"을 고르세요.',
        'plotly 코드 블록 안의 data·layout을 고치면 바로 다시 그려집니다.'
    ]);
    ko.plugin.onunload();
});
