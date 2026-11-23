export const splitLines = text => text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).map((text, i) => ({ text, line: i + 1 }));

export function fenceOpen(line) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match || (match[1][0] === '`' && match[2].includes('`'))) return null;
    return { fence: match[1], info: match[2].trim() };
}
export function fenceClose(line, fence) {
    const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    return !!match && match[1][0] === fence[0] && match[1].length >= fence.length;
}
function structuralPipes(line) {
    const pipes = [];
    for (let i = 0; i < line.length; i++) {
        let slashes = 0;
        for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
        if (line[i] === '`' && slashes % 2 === 0) {
            let end = i + 1;
            while (line[end] === '`') end++;
            const length = end - i;
            let close = end;
            while (close < line.length) {
                if (line[close] !== '`') { close++; continue; }
                let next = close + 1;
                while (line[next] === '`') next++;
                if (next - close === length) break;
                close = next;
            }
            if (close < line.length) { i = close + length - 1; continue; }
            i = end - 1; continue;
        }
        if (line.startsWith('[[', i)) {
            const end = line.indexOf(']]', i + 2);
            if (end !== -1) { i = end + 1; continue; }
        }
        if (line[i] === '|' && slashes % 2 === 0) pipes.push(i);
    }
    return pipes;
}
function cleanCell(cell) {
    cell = cell.trim().replace(/<br\s*\/?\s*>/gi, ' ');
    const bold = /^(?:\*\*([\s\S]*)\*\*|__([\s\S]*)__)$/.exec(cell);
    if (bold) cell = bold[1] ?? bold[2];
    return cell.replace(/(\\+)\|/g, (all, slashes) => slashes.length % 2 ? slashes.slice(1) + '|' : all).trim();
}
export function splitCells(line, pipes = structuralPipes(line)) {
    let start = 0, end = line.length;
    const first = line.search(/\S/), last = line.trimEnd().length - 1;
    if (pipes[0] === first) { start = first + 1; pipes = pipes.slice(1); }
    if (pipes.at(-1) === last) { end = last; pipes = pipes.slice(0, -1); }
    const cells = [];
    for (const pos of pipes) { cells.push(cleanCell(line.slice(start, pos))); start = pos + 1; }
    cells.push(cleanCell(line.slice(start, end)));
    return cells;
}
const excluded = line => /^ {4}|^\s*(?:>|(?:[-*+]|\d+[.)])\s)/.test(line) || !!fenceOpen(line);
export function findTables(text, locale = 'ko') {
    const lines = splitLines(text), tables = [];
    let i = 0, fence = null;
    if (lines[0]?.text === '---') { i = 1; while (i < lines.length && lines[i].text !== '---') i++; i++; }
    while (i < lines.length) {
        const line = lines[i].text;
        if (fence) { if (fenceClose(line, fence)) fence = null; i++; continue; }
        const open = fenceOpen(line);
        if (open) { fence = open.fence; i++; continue; }
        const pipes = structuralPipes(line), next = lines[i + 1]?.text;
        if (excluded(line) || !pipes.length || next === undefined || excluded(next)) { i++; continue; }
        const nextPipes = structuralPipes(next), headers = splitCells(line, pipes), separators = splitCells(next, nextPipes);
        if (!nextPipes.length || separators.length !== headers.length || !separators.every(s => /^:?-+:?$/.test(s))) { i++; continue; }
        const table = { index: tables.length + 1, startLine: lines[i].line, headers, rows: [], irregularRows: 0 };
        tables.push(table);
        if (tables.length > 1000) throw new Error(locale === 'ko' ? '표가 1,000개를 넘는 노트는 읽지 않습니다' : 'Notes with more than 1,000 tables cannot be read.');
        i += 2;
        while (i < lines.length) {
            const body = lines[i].text, bodyPipes = structuralPipes(body);
            if (!body.trim() || excluded(body) || !bodyPipes.length) break;
            const cells = splitCells(body, bodyPipes);
            if (cells.length !== headers.length) table.irregularRows++;
            table.rows.push({ cells: Array.from({ length: headers.length }, (_, n) => cells[n] ?? ''), line: lines[i].line });
            i++;
        }
    }
    return tables;
}
export function tableDataset(text, table = 1, locale = 'en') {
    const tables = findTables(text, locale);
    if (!tables.length) throw new Error(locale === 'ko' ? '이 노트에는 파이프 표가 없습니다. CSV나 표가 있는 노트를 주세요.' : 'This note has no pipe tables. Provide a CSV or a note containing a table.');
    if (!Number.isInteger(table) || table < 1 || table > tables.length || table > 1000) {
        const examples = tables.slice(0, 10).map(t => locale === 'ko' ? `표 ${t.index}: ${t.startLine}줄, 머리글 ${t.headers.slice(0, 3).join(', ')}` : `Table ${t.index}: line ${t.startLine}, headers ${t.headers.slice(0, 3).join(', ')}`).join('; ');
        throw new Error(locale === 'ko' ? `표 ${tables.length}개: ${examples}. table로 다시 호출하세요.` : `${tables.length} tables: ${examples}. Call again with table.`);
    }
    const selected = tables[table - 1], headers = selected.headers;
    if (!headers.length || headers.length > 100 || headers.some(h => !h || h.length > 100 || [...h].some(c => c.charCodeAt(0) < 32)) || new Set(headers).size !== headers.length) throw new Error(locale === 'ko' ? `표 ${table}의 ${selected.startLine}줄 머리글이 유효하지 않습니다: ${headers.join(', ')}. 머리글은 1~100개이며 비지 않고 서로 달라야 합니다.` : `Table ${table} has invalid headers at line ${selected.startLine}: ${headers.join(', ')}. Headers must be 1–100 unique, nonempty names of at most 100 characters.`);
    if (selected.rows.length > 100000) throw new Error(locale === 'ko' ? '표가 자료 행 100000개를 넘습니다.' : 'Table exceeds 100000 data rows.');
    return { headers, rows: selected.rows.map(r => r.cells), lines: selected.rows.map(r => r.line), table: { index: table, startLine: selected.startLine }, irregularRows: selected.irregularRows };
}
