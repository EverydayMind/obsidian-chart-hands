'use strict';
// Run: node --test test/agent-skills.test.js
// The plugin ships its Skills through describeAssets()/readAsset() (host-capabilities-v1).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadHarness } = require('./helpers/locale-harness');
const buildPlugin = require('./helpers/build-plugin');

const root = path.join(__dirname, '..');
const generated = JSON.parse(fs.readFileSync(path.join(root, 'src', 'agent-assets.generated.json'), 'utf8'));
const pluginManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const directories = dir => fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);

function sources() {
    const skills = path.join(root, 'agent-skills');
    const result = {};
    for (const id of directories(skills)) for (const locale of directories(path.join(skills, id))) {
        result[`${id}/${locale}`] = fs.readFileSync(path.join(skills, id, locale, 'SKILL.md'));
    }
    return result;
}

const harness = locale => loadHarness(buildPlugin(), locale);
const makeProvider = (h = harness('ko')) => h.exports.createAgentProvider({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: {} }, 'ko');

test('host-capabilities-v1 contract copy matches its manifest and lists every file', () => {
    const dir = path.join(root, 'contracts', 'agentinterop', 'host-capabilities-v1');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    for (const file of manifest.files) {
        const text = fs.readFileSync(path.join(dir, file.path), 'utf8').replace(/\r\n/g, '\n');
        assert.deepEqual({ path: file.path, sha256: sha(Buffer.from(text, 'utf8')) }, { path: file.path, sha256: file.sha256 });
    }
    assert.deepEqual(manifest.files.map(file => file.path).sort(), fs.readdirSync(dir).filter(name => name !== 'manifest.json').sort());
});

test('generated agent assets are fresh against the agent-skills sources', () => {
    const files = sources();
    assert.equal(generated.generator, 'verbex-plugin-skills@1');
    assert.equal(generated.pluginId, pluginManifest.id);
    assert.deepEqual(Object.keys(generated.sources).sort(), Object.keys(files).sort());
    assert.deepEqual(Object.keys(generated.bodies).sort(), Object.keys(files).sort());
    for (const [key, data] of Object.entries(files)) {
        assert.ok(!data.includes(13), `${key}: CR in source`);
        assert.equal(generated.sources[key], sha(data), key);
        const text = data.toString('utf8');
        const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(text);
        assert.ok(match, key);
        const body = text.slice(match[0].length);
        assert.equal(generated.bodies[key], body, key);
        const [id, locale] = key.split('/');
        const entry = generated.assets.skills.find(skill => skill.id === id && skill.locale === locale);
        assert.equal(entry?.bodySha256, sha(body), key);
    }
    assert.equal(generated.assets.skills.length, Object.keys(files).length);
    assert.deepEqual(Object.keys(files).sort(), ['data-insight-chart/en', 'data-insight-chart/ko']);
});

test('provider host members are own data properties holding functions', () => {
    const provider = makeProvider();
    for (const name of ['describeAssets', 'readAsset']) {
        const d = Object.getOwnPropertyDescriptor(provider, name);
        assert.equal(typeof d?.value, 'function', name);
        assert.ok(!d.get && !d.set, name);
    }
});

test('describeAssets returns equal but independent plain copies', () => {
    const provider = makeProvider();
    const first = provider.describeAssets();
    assert.deepEqual(JSON.parse(JSON.stringify(first)), generated.assets);
    assert.equal(JSON.stringify(first), JSON.stringify(generated.assets));
    first.skills[0].frontmatter.name = 'changed';
    first.skills.length = 0;
    assert.deepEqual(JSON.parse(JSON.stringify(provider.describeAssets())), generated.assets);
    assert.notEqual(provider.describeAssets(), provider.describeAssets());
});

test('readAsset returns the body and rejects everything else', () => {
    const provider = makeProvider();
    for (const locale of ['ko', 'en']) {
        assert.deepEqual(JSON.parse(JSON.stringify(provider.readAsset({ kind: 'skill', id: 'data-insight-chart', locale }))), { body: generated.bodies[`data-insight-chart/${locale}`] });
    }
    for (const bad of [
        { kind: 'skill', id: 'nope', locale: 'ko' }, { kind: 'skill', id: 'data-insight-chart', locale: 'fr' },
        { kind: 'tool', id: 'data-insight-chart', locale: 'ko' }, { kind: 'skill', id: 'data-insight-chart', locale: 'ko', extra: 1 },
        { kind: 'skill', id: 'data-insight-chart' }, { kind: 'skill', id: 'toString', locale: 'ko' },
        { kind: 'skill', id: '__proto__', locale: 'ko' }, null, 'x', []
    ]) assert.throws(() => provider.readAsset(bad), JSON.stringify(bad));
});

test('describe() is unchanged, and host members throw after dispose', async () => {
    const provider = makeProvider();
    const descriptor = await provider.describe();
    assert.ok(!('assets' in descriptor) && !('skills' in descriptor));
    assert.ok(descriptor.tools.every(tool => !('assets' in tool) && !('skills' in tool)));
    provider.dispose();
    assert.throws(() => provider.describeAssets());
    assert.throws(() => provider.readAsset({ kind: 'skill', id: 'data-insight-chart', locale: 'ko' }));
});

test('the plugin publishes the host members on the registered provider', async () => {
    const h = harness('ko');
    const Plugin = h.exports.default;
    const plugin = new Plugin();
    plugin.app = { workspace: { on: () => ({}), trigger() {}, onLayoutReady() {} }, vault: {} };
    plugin.manifest = { id: 'chart-hands', name: 'Chart Hands', version: 'test' };
    await plugin.onload();
    const provider = plugin[Symbol.for('dev.agentinterop.capability-provider')];
    assert.equal(typeof Object.getOwnPropertyDescriptor(provider, 'describeAssets')?.value, 'function');
    assert.deepEqual(JSON.parse(JSON.stringify(provider.describeAssets())), generated.assets);
});

test('host advertisement detection feeds the settings status line', () => {
    const { hostSkillStatusLine } = harness('en').exports;
    const advertise = ad => ({ plugins: { plugins: { host: Object.defineProperty({}, Symbol.for('dev.agentinterop.host'), { value: ad }) } } });
    const line = (app, locale = 'en', names) => hostSkillStatusLine(app, locale, names);
    assert.match(line(advertise({ protocol: 'agentinterop', contracts: ['host-capabilities-v1'], hostVersion: '1' })), /^An AI host can read this plugin's Skills \(Data insights and charts\)\.$/);
    assert.match(line(advertise({ protocol: 'agentinterop', contracts: ['host-capabilities-v1'] }), 'ko'), /^AI 호스트가 이 플러그인의 Skill\(데이터 인사이트와 차트\)을 읽을 수 있습니다\.$/);
    let ran = false;
    const getterHost = { plugins: { plugins: { host: Object.defineProperty({}, Symbol.for('dev.agentinterop.host'), { get() { ran = true; return { protocol: 'agentinterop', contracts: ['host-capabilities-v1'] }; } }) } } };
    assert.match(line(getterHost), /^No enabled AI host reads plugin Skills/);
    assert.equal(ran, false);
    assert.match(line(advertise({ protocol: 'agentinterop', contracts: ['other'] })), /^No enabled AI host/);
    assert.match(line({ plugins: { plugins: { host: {} } } }), /^No enabled AI host/);
    assert.equal(line({}), 'Could not check whether an AI host supports plugin Skills.');
    assert.equal(line(undefined, 'ko'), 'AI 호스트의 플러그인 Skill 지원 여부를 확인할 수 없습니다.');
    assert.equal(line(advertise({ protocol: 'agentinterop', contracts: ['host-capabilities-v1'] }), 'en', []), "An AI host can read this plugin's Skills.");
});
