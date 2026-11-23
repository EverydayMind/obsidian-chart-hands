import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCells, splitLines, findTables, tableDataset } from '../src/markdown-table.js';
import { analyze, profile } from '../src/eda.js';

test('structural pipe scanner handles escapes, spans and links', () => {
    assert.deepEqual(splitCells('| **a** 와 **b** | **합계** | __a__ 와 __b__ |'), ['**a** 와 **b**', '합계', '__a__ 와 __b__']);
    const examples = [
        ['| a | b |', ['a', 'b']], ['a | b', ['a', 'b']], ['|', ['']],
        ['| [[노트|별칭]] | 3 |', ['[[노트|별칭]]', '3']], ['| [[노트 | 3 |', ['[[노트', '3']],
        ['| `a|b` | 3 |', ['`a|b`', '3']], ['| ``a`b`` | 3 |', ['``a`b``', '3']],
        ['| `a | 3 |', ['`a', '3']], [String.raw`| a\|b | c |`, ['a|b', 'c']],
        [String.raw`| a\\| b |`, [String.raw`a\\`, 'b']], [String.raw`| a\\\|b | c |`, [String.raw`a\\|b`, 'c']]
    ];
    for (const [line, expected] of examples) assert.deepEqual(splitCells(line), expected, line);
});
test('tables skip frontmatter, fences and unsupported lines and retain source lines', () => {
    const text = '\uFEFF---\rtitle: x\r---\r제목\r---\r\r| **이름** | 값 |\r|---|---|\r| A<br />B | 1 |\r| 합계 | 2 |\r> | ignored |\r| C | D |\r|---|---|\r| short |\r- item | end\r~~~ info `x`\r| hidden | x |\r|---|---|\r~~~\r```\r| hidden | x |\r|---|---|';
    assert.equal(splitLines(text)[6].line, 7);
    const tables = findTables(text);
    assert.equal(tables.length, 2);
    assert.deepEqual(tables[0].headers, ['이름', '값']);
    assert.equal(tables[0].rows[0].cells[0], 'A B');
    assert.equal(tables[1].irregularRows, 1);
    const dataset = tableDataset(text, 1);
    const result = analyze(dataset, { type: 'rows', columns: ['이름'], filter: [{ column: '이름', op: 'eq', value: '합계' }] });
    assert.equal(result.rows[0].rowNumber, 2);
    assert.equal(result.rows[0].line, 10);
    assert.equal(profile(dataset).summaryRowCandidates[0].line, 10);
});
test('selection validates only the selected table and enforces bounds', () => {
    const text = '| x | x |\n|---|---|\n\n| n | name |\n|---|---|\n| 1원 | 합계 |\n| 2명 | A |';
    assert.throws(() => tableDataset(text, 1), /Table 1.*line 1/);
    const ds = tableDataset(text, 2);
    assert.equal(profile(ds).summaryRowCandidates[0].column, 'name');
    assert.throws(() => tableDataset(text, 3), /2 tables/);
    assert.throws(() => tableDataset('title\r\n---'), /no pipe tables/);
    assert.throws(() => findTables('| x |\n|---|\n\n'.repeat(1001)), /1,000/);
});
