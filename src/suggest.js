import { analyze, parseCell, profile, selectRows } from './eda.js';
import { periodKey } from './period.js';
import { inspectColumn } from './column-roles.js';

export const SUGGEST_GOALS = ['trend', 'compare', 'rank', 'share', 'distribution', 'relationship', 'target', 'change', 'matrix'];

const ADDITIVE_UNITS = new Set(['원', '천원', '만원', '백만원', '억원', '조원', '달러', '₩', '$', '€', '£', '¥', '건', '개', '회', '곳', '개소', '톤', 'kg']);
const KOREAN_NUMERALS = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const NEGATION_RE = /(?:말|빼고|제외|않|없이)/;
const METRIC_MASK_RE = /(?:집행률|달성률|비율|증가율|감소율)/g;
const DIRECTION_WORD_RE = /(?:기준|대비|비해|보다|앞|뒤|이전|이후|전년|작년|올해|금년)/;
const RELATIVE_PERIOD_RE = /(?:전년|작년|올해|금년)/;
const LIST_OR_TABLE_RE = /(?:표로|목록|따로)/;
const HIGHLIGHT_WORD_RE = /(?:강조|색|칠|눈에\s*띄게)/;
const DISPLAY_WORD_RE = /(?:차트|그래프|보여|표시)/;

const GOAL_KEYWORDS = [
    ['target', [/계획 대비/, /예산 대비/, /목표/, /(?<![A-Za-z])target(?![A-Za-z])/i, /(?<![A-Za-z])plan(?![A-Za-z])/i]],
    ['change', [/전년 대비/, /전년 동기/, /(?<![A-Za-z])year over year(?![A-Za-z])/i, /변화량/, /늘어난/, /줄어든/, /증감/, /증가/, /감소/, /(?<![A-Za-z])change(?![A-Za-z])/i]],
    ['rank', [/순위/, /랭킹/, /(?<![A-Za-z])rank(?![A-Za-z])/i]],
    ['share', [/구성비/, /비중/, /점유/, /차지/, /(?<![A-Za-z])composition(?![A-Za-z])/i, /(?<![A-Za-z])share(?![A-Za-z])/i]],
    ['trend', [/(?<![A-Za-z])over time(?![A-Za-z])/i, /분기별/, /연도별/, /월별/, /추이/, /추세/, /흐름/, /(?<![A-Za-z])trend(?![A-Za-z])/i]],
    ['distribution', [/분포/, /편차/, /(?<![A-Za-z])distribution(?![A-Za-z])/i]],
    ['relationship', [/상관/, /관계/, /(?<![A-Za-z])correlation(?![A-Za-z])/i, /(?<![A-Za-z])relationship(?![A-Za-z])/i]],
    ['matrix', [/히트맵/, /매트릭스/, /(?<![A-Za-z])heatmap(?![A-Za-z])/i, /(?<![A-Za-z])matrix(?![A-Za-z])/i]],
    ['compare', [/비교/, /(?<![A-Za-z])compare(?![A-Za-z])/i, /(?<![A-Za-z])vs(?![A-Za-z])/i]]
];

const PERIOD_TOKEN_BODY = [
    /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/,
    /\d{4}[-./]\d{1,2}[-./]\d{1,2}/,
    /\d{4}년\s*\d{1,2}월/,
    /\d{4}[-./]\d{1,2}/,
    /\d{4}년\s*[1-4]분기/,
    /\d{4}\s*-?\s*Q[1-4]/,
    /Q[1-4]\s+\d{4}/,
    /\d{4}(?:년)?\s*(?:상반기|하반기)/,
    /\d{4}(?:년도|년)?/,
    /[1-4]분기/,
    /Q[1-4]/,
    /\d{1,2}월/,
    /상반기/,
    /하반기/
].map(re => re.source).join('|');

const RIGHT_BOUNDARY = /(?=$|[\s.,;:!?()[\]{}·/~]|으로|은|는|이|가|을|를|의|에|만|로|과|와|및)/.source;
const PERIOD_TOKEN_RE = new RegExp(`(^|[\\s.,;:!?()\\[\\]{}·/~])(${PERIOD_TOKEN_BODY})${RIGHT_BOUNDARY}`, 'gi');

const UNIT_PAT = /(?:%p|%|백만원|천원|만원|억원|조원|원|달러|개소|건|명|개|회|곳|톤|kg|km)/.source;
const TARGET_PREFIX_PAT = /(?:목표(?:값)?|계획(?:값)?|target)\s*(?:은|는|이|가|is|:|=)?\s*/.source;
const TARGET_NUM_PAT = /[+\-−△]?[₩$€¥£]?\s*(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d*)?|\.\d+)/.source;
const TARGET_VALUE_RE = new RegExp(`${TARGET_PREFIX_PAT}(${TARGET_NUM_PAT}(?:\\s*${UNIT_PAT})?)`, 'gi');

const NUM_TOKEN = /(?:\d+(?:\.\d+)?%?|다섯|여섯|일곱|여덟|아홉|[한두세네열])/.source;
const QTY_TAIL = /(?=$|[\s.,;:!?()[\]{}·/]|곳|개소|개|명|건|부서|기관|항목|은|는|이|가|을|를|의|에|만|로|으로|과|와|및)/.source;
const DELTA_HIGHLIGHT_RE = new RegExp(`${/(감소|증가)\s*(?:폭이\s*)?(?:가장\s*)?큰\s*/.source}(${NUM_TOKEN})${QTY_TAIL}`);
const RANK_QTY_RE = new RegExp(`${/(상위|하위|많은|적은|큰|작은|top|bottom)\s?/.source}(${NUM_TOKEN})${QTY_TAIL}`, 'i');
const DIR_COMPARE_PAT = /(?:\s+대비\s+|에\s*비해\s+|보다\s+)/.source;
const DIR_BASE_PAT = /(?:를|을|는|은)?\s*기준으로\s+.*/.source;

const t = (locale, ko, en) => (locale === 'ko' ? ko : en);

function parseQuantity(token) {
    if (Object.hasOwn(KOREAN_NUMERALS, token)) return KOREAN_NUMERALS[token];
    if (/[.%]/.test(token)) return null;
    const n = Number(token);
    return Number.isInteger(n) ? n : null;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchGoalKeywords(request) {
    const masked = request.replace(METRIC_MASK_RE, m => ' '.repeat(m.length));
    const hits = new Map();
    for (const [goal, patterns] of GOAL_KEYWORDS) {
        const matched = [];
        for (const re of patterns) {
            const m = masked.match(re);
            if (m) matched.push(m[0]);
        }
        if (matched.length) hits.set(goal, matched);
    }
    return hits;
}

function extractPeriodTokens(request) {
    const found = [];
    PERIOD_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = PERIOD_TOKEN_RE.exec(request)) !== null) {
        const raw = m[2];
        const key = periodKey(raw, { compact: false });
        if (key.startsWith('S:')) continue;
        const start = m.index + m[1].length;
        found.push({ raw, key, start, end: start + raw.length });
    }
    // Deduplicate by key preserving order of first appearance.
    const unique = [];
    const seen = new Set();
    for (const item of found) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        unique.push(item);
    }
    return { all: found, unique };
}

function matchDirectionInClause(request, tokA, tokB) {
    const clauses = request.split(/[,.;!?]/);
    for (const clause of clauses) {
        const a = escapeRegExp(tokA.raw);
        const b = escapeRegExp(tokB.raw);
        const checkPair = (x, y, xTok, yTok) => {
            const p1 = new RegExp(`${x}${DIR_COMPARE_PAT}${y}`);
            if (p1.test(clause)) return { base: xTok, target: yTok };
            const p2 = new RegExp(`${x}${DIR_BASE_PAT}${y}`);
            if (p2.test(clause)) return { base: xTok, target: yTok };
            return null;
        };
        const fwd = checkPair(a, b, tokA, tokB);
        if (fwd) return fwd;
        const rev = checkPair(b, a, tokB, tokA);
        if (rev) return rev;
    }
    return null;
}

export function parseRequest(request, cols, args, locale = 'ko') {
    const overridden = {
        goal: args.goal !== undefined,
        period: args.period !== undefined,
        'target.value': args.target_value !== undefined,
        highlight: args.highlight !== undefined
    };

    const entries = {
        goal: { field: 'goal', status: overridden.goal ? 'overridden' : 'unmatched', matched: [], ...(overridden.goal ? { value: args.goal } : {}) },
        period: { field: 'period', status: overridden.period ? 'overridden' : 'unmatched', matched: [], ...(overridden.period ? { value: args.period } : {}) },
        'target.value': { field: 'target.value', status: overridden['target.value'] ? 'overridden' : 'unmatched', matched: [], ...(overridden['target.value'] ? { value: args.target_value } : {}) },
        highlight: { field: 'highlight', status: overridden.highlight ? 'overridden' : 'unmatched', matched: [], ...(overridden.highlight ? { value: args.highlight } : {}) }
    };
    const confirm = [];
    const cautions = [];
    let rankOverride = null;

    if (!request) {
        return { readFromRequest: [], confirm, cautions, rankOverride, entries };
    }

    // R1: Negation anywhere makes all non-overridden fields ambiguous.
    const negMatch = request.match(NEGATION_RE);
    if (negMatch) {
        for (const key of ['goal', 'period', 'target.value', 'highlight']) {
            if (overridden[key]) continue;
            entries[key].status = 'ambiguous';
            entries[key].matched = [negMatch[0]];
            confirm.push({ field: key, candidates: key === 'goal' ? SUGGEST_GOALS : [] });
        }
        return {
            readFromRequest: Object.values(entries),
            confirm,
            cautions,
            rankOverride,
            entries
        };
    }

    // 1. Period parsing (S4 + S4' + R2).
    const periodCols = cols.filter(c => c.role === 'period');
    const { unique: periodTokens } = extractPeriodTokens(request);
    if (!overridden.period) {
        if (periodTokens.length > 0) {
            const matchedCols = periodCols.filter(c => periodTokens.every(tok => c.period.keyToRaws.has(tok.key)));
            if (matchedCols.length > 1) {
                entries.period.status = 'ambiguous';
                entries.period.matched = periodTokens.map(tok => tok.raw);
                confirm.push({ field: 'period', candidates: matchedCols.map(c => c.name) });
            } else if (periodCols.length === 0) {
                entries.period.status = 'unmatched';
                entries.period.matched = periodTokens.map(tok => tok.raw);
            } else {
                const col = matchedCols[0] || periodCols[0];
                const allInCol = periodTokens.every(tok => col.period.keyToRaws.has(tok.key));
                if (!allInCol || periodTokens.length >= 3) {
                    entries.period.status = 'ambiguous';
                    entries.period.matched = periodTokens.map(tok => tok.raw);
                    confirm.push({ field: 'period', candidates: col.distinctValues.slice(0, 20) });
                } else if (periodTokens.length === 2) {
                    const [t1, t2] = periodTokens;
                    const hasDir = DIRECTION_WORD_RE.test(request);
                    if (!hasDir) {
                        const [early, late] = t1.key < t2.key ? [t1, t2] : [t2, t1];
                        const base = col.period.keyToRaws.get(early.key)[0];
                        const target = col.period.keyToRaws.get(late.key)[0];
                        entries.period.status = 'applied';
                        entries.period.matched = [t1.raw, t2.raw];
                        entries.period.value = { column: col.name, base, target };
                    } else {
                        const dir = matchDirectionInClause(request, t1, t2);
                        if (dir) {
                            const base = col.period.keyToRaws.get(dir.base.key)[0];
                            const target = col.period.keyToRaws.get(dir.target.key)[0];
                            entries.period.status = 'applied';
                            entries.period.matched = [dir.base.raw, dir.target.raw];
                            entries.period.value = { column: col.name, base, target };
                        } else {
                            entries.period.status = 'ambiguous';
                            entries.period.matched = [t1.raw, t2.raw];
                            confirm.push({
                                field: 'period',
                                candidates: [
                                    `${col.period.keyToRaws.get(t1.key)[0]}→${col.period.keyToRaws.get(t2.key)[0]}`,
                                    `${col.period.keyToRaws.get(t2.key)[0]}→${col.period.keyToRaws.get(t1.key)[0]}`
                                ]
                            });
                        }
                    }
                } else {
                    // Only 1 period token matched: unmatched (need two periods).
                    entries.period.status = 'unmatched';
                    entries.period.matched = [periodTokens[0].raw];
                }
            }
        } else if (RELATIVE_PERIOD_RE.test(request)) {
            const rel = request.match(RELATIVE_PERIOD_RE);
            entries.period.status = 'unmatched';
            entries.period.matched = rel ? [rel[0]] : [];
        }
    }

    // 2. Highlight & R3 rank-only parsing.
    const hasListOrTable = LIST_OR_TABLE_RE.test(request);
    const hasHighlightWord = HIGHLIGHT_WORD_RE.test(request);
    const hasDisplayWord = DISPLAY_WORD_RE.test(request);
    const deltaMatch = request.match(DELTA_HIGHLIGHT_RE);
    const qtyMatch = !deltaMatch ? request.match(RANK_QTY_RE) : null;

    if (!overridden.highlight) {
        if (deltaMatch) {
            const n = parseQuantity(deltaMatch[2]);
            const after = request.slice(deltaMatch.index + deltaMatch[0].length);
            const hasMan = /^\s*(?:곳|개소|개|명|건|부서|기관|항목)?\s*만/.test(after);
            if (n !== null) {
                if (n < 1 || n > 50 || hasListOrTable || (hasHighlightWord && hasMan)) {
                    entries.highlight.status = 'ambiguous';
                    entries.highlight.matched = [deltaMatch[0]];
                    confirm.push({ field: 'highlight', candidates: [] });
                } else if (hasHighlightWord) {
                    entries.highlight.status = 'applied';
                    entries.highlight.matched = [deltaMatch[0]];
                    entries.highlight.value = { kind: /^감소$/.test(deltaMatch[1]) ? 'decrease' : 'increase', count: n };
                }
            }
        } else if (qtyMatch) {
            const dirWord = qtyMatch[1].toLowerCase();
            const n = parseQuantity(qtyMatch[2]);
            const after = request.slice(qtyMatch.index + qtyMatch[0].length);
            const hasMan = /^\s*(?:곳|개소|개|명|건|부서|기관|항목)?\s*만/.test(after);
            if (n !== null) {
                if (n < 1 || n > 50 || hasListOrTable || (hasHighlightWord && hasMan)) {
                    entries.highlight.status = 'ambiguous';
                    entries.highlight.matched = [qtyMatch[0]];
                    confirm.push({ field: 'highlight', candidates: [] });
                } else if (hasMan && hasDisplayWord && !hasHighlightWord && (dirWord === '상위' || dirWord === '하위')) {
                    rankOverride = { top: n, order: dirWord === '하위' ? 'asc' : 'desc', matched: qtyMatch[0] };
                } else if (hasHighlightWord) {
                    const isBottom = /^(?:하위|적은|작은|bottom)$/.test(dirWord);
                    entries.highlight.status = 'applied';
                    entries.highlight.matched = [qtyMatch[0]];
                    entries.highlight.value = isBottom ? { bottom: n } : { top: n };
                }
            }
        }
    }

    // 3. Goal parsing (S4 + S4' + R3).
    if (!overridden.goal) {
        const hits = matchGoalKeywords(request);
        if (rankOverride) {
            if (!hits.has('rank')) hits.set('rank', [rankOverride.matched]);
            else hits.get('rank').push(rankOverride.matched);
        }
        const goals = [...hits.keys()];
        if (goals.length === 1) {
            entries.goal.status = 'applied';
            entries.goal.matched = hits.get(goals[0]);
            entries.goal.value = goals[0];
        } else if (goals.length > 1) {
            const set = new Set(goals);
            const hasTwoPeriods = entries.period.status === 'applied' || (overridden.period && args.period);
            const labelCol = args.label ? cols.find(c => c.name === args.label) : periodCols[0];
            let resolved = null;
            if (set.size === 2 && set.has('change') && set.has('compare') && hasTwoPeriods) resolved = 'change';
            else if (set.size === 2 && set.has('rank') && set.has('compare')) resolved = 'rank';
            else if (set.size === 2 && set.has('trend') && set.has('compare') && labelCol?.role === 'period') resolved = 'trend';

            if (resolved) {
                entries.goal.status = 'applied';
                entries.goal.matched = [...hits.get(resolved), ...hits.get('compare')];
                entries.goal.value = resolved;
            } else {
                entries.goal.status = 'ambiguous';
                entries.goal.matched = goals.flatMap(g => hits.get(g));
                confirm.push({ field: 'goal', candidates: goals });
            }
        }
    }

    // 4. Target value parsing (S4 + S4').
    if (!overridden['target.value']) {
        const valueCol = args.values?.length
            ? cols.find(c => c.name === args.values[0])
            : cols.find(c => c.role === 'numeric');
        const valueUnit = valueCol?.unit || '';
        TARGET_VALUE_RE.lastIndex = 0;
        const matches = [];
        let m;
        while ((m = TARGET_VALUE_RE.exec(request)) !== null) {
            const parsed = parseCell(m[1]);
            if (!parsed) continue;
            const after = request.slice(m.index + m[0].length);
            const forbidden = /^\s*(?:이상|이하|초과|미만|곳|개소|기관|개|건|명)/.test(after);
            const allowedEnd = /^(?:$|[\s.,;:!?()[\]{}]|으로|로|에)/.test(after);
            if (!forbidden && !allowedEnd) continue;
            matches.push({ raw: m[0].trim(), parsed, forbidden });
        }
        if (matches.length > 1 || (matches.length === 1 && matches[0].forbidden)) {
            entries['target.value'].status = 'ambiguous';
            entries['target.value'].matched = matches.map(x => x.raw);
            confirm.push({ field: 'target.value', candidates: matches.map(x => x.parsed.value) });
        } else if (matches.length === 1) {
            const { raw, parsed } = matches[0];
            if (parsed.unit && valueUnit && parsed.unit !== valueUnit) {
                entries['target.value'].status = 'unmatched';
                entries['target.value'].matched = [raw];
                cautions.push(t(locale,
                    `요청의 목표값 단위(${parsed.unit})가 값 열 단위(${valueUnit})와 달라 목표값을 적용하지 않았습니다.`,
                    `Target value unit (${parsed.unit}) differs from value column unit (${valueUnit}); target value was not applied.`));
            } else {
                entries['target.value'].status = 'applied';
                entries['target.value'].matched = [raw];
                entries['target.value'].value = parsed.value;
            }
        }
    }

    return {
        readFromRequest: Object.values(entries),
        confirm,
        cautions,
        rankOverride,
        entries
    };
}

function validateExplicitArgs(dataset, args, cols, goal, locale) {
    const fail = (ko, en) => { throw new Error(t(locale, ko, en)); };
    const colByName = new Map(cols.map(c => [c.name, c]));

    if (args.goal !== undefined && !SUGGEST_GOALS.includes(args.goal)) {
        fail(`goal은 ${SUGGEST_GOALS.join(', ')} 중 하나여야 합니다.`, `goal must be one of: ${SUGGEST_GOALS.join(', ')}.`);
    }
    if (args.request !== undefined && (typeof args.request !== 'string' || args.request.length > 500)) {
        fail('request는 500자 이하 문자열이어야 합니다.', 'request must be a string of at most 500 characters.');
    }
    if (args.goal === undefined && (!args.request || !args.request.trim())) {
        fail('goal을 주거나 request에 목적을 적으세요.', 'Provide goal or describe the purpose in request.');
    }
    if (args.label !== undefined) {
        if (typeof args.label !== 'string' || !colByName.has(args.label)) {
            fail(`모르는 label 열: ${args.label}`, `Unknown label column: ${args.label}`);
        }
        if (goal === 'distribution' || goal === 'relationship') {
            fail(`${goal} 목적에는 label을 쓰지 않습니다.`, `label is not used for goal ${goal}.`);
        }
    }
    if (args.values !== undefined) {
        if (!Array.isArray(args.values) || !args.values.length || args.values.length > 12 || args.values.some(v => typeof v !== 'string')) {
            fail('values는 1~12개의 열 이름 배열이어야 합니다.', 'values must be an array of 1 to 12 column names.');
        }
        if (new Set(args.values).size !== args.values.length) {
            fail('values에 같은 열이 중복되었습니다.', 'values contains duplicate column names.');
        }
        for (const name of args.values) {
            const col = colByName.get(name);
            if (!col) fail(`모르는 values 열: ${name}`, `Unknown values column: ${name}`);
            if (args.label === name) fail(`values 열 ${name}이 label과 겹칩니다.`, `values column ${name} overlaps with label.`);
            if (!col.facts.strictNumeric) fail(`values 열 ${name}은 수치 열이어야 합니다.`, `values column ${name} must be numeric.`);
        }
    }
    if (args.reference !== undefined) {
        if (goal && goal !== 'target') fail('reference는 target 목적에만 씁니다.', 'reference is only for goal target.');
        const ref = colByName.get(args.reference);
        if (!ref) fail(`모르는 reference 열: ${args.reference}`, `Unknown reference column: ${args.reference}`);
        if (!ref.facts.strictNumeric) fail(`reference 열 ${args.reference}은 수치 열이어야 합니다.`, `reference column ${args.reference} must be numeric.`);
        if (args.label === args.reference || args.values?.includes(args.reference)) {
            fail(`reference 열 ${args.reference}이 다른 인자 열과 겹칩니다.`, `reference column ${args.reference} overlaps with another column.`);
        }
    }
    if (args.top !== undefined) {
        if (goal && goal !== 'rank') fail('top은 rank 목적에만 씁니다.', 'top is only for goal rank.');
        if (!Number.isInteger(args.top) || args.top < 1 || args.top > 50) {
            fail('top은 1~50 정수여야 합니다.', 'top must be an integer from 1 to 50.');
        }
    }
    if (args.period !== undefined) {
        if (goal && goal !== 'change') fail('period는 change 목적에만 씁니다.', 'period is only for goal change.');
        const p = args.period;
        if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['column', 'base', 'target'].includes(k)) || typeof p.base !== 'string' || !p.base.trim() || typeof p.target !== 'string' || !p.target.trim()) {
            fail('period에는 base, target 문자열(과 선택적 column)이 필요합니다.', 'period requires base and target strings (and optional column).');
        }
        if (p.column !== undefined && (typeof p.column !== 'string' || !colByName.has(p.column))) {
            fail(`모르는 period.column 열: ${p.column}`, `Unknown period.column: ${p.column}`);
        }
    }
    if (args.target_value !== undefined) {
        if (typeof args.target_value !== 'number' || !Number.isFinite(args.target_value)) {
            fail('target_value는 유한한 숫자여야 합니다.', 'target_value must be a finite number.');
        }
        if (goal && ['distribution', 'relationship', 'matrix', 'share'].includes(goal)) {
            fail(`${goal} 목적에는 target_value를 쓰지 않습니다.`, `target_value is not used for goal ${goal}.`);
        }
    }
    if (args.highlight !== undefined) {
        const h = args.highlight;
        const keys = h && typeof h === 'object' && !Array.isArray(h) ? Object.keys(h) : [];
        const k = keys[0];
        const valid = keys.length === 1 && ['labels', 'top', 'bottom', 'below_target', 'above_target'].includes(k)
            && (k === 'labels' ? Array.isArray(h[k]) && h[k].length >= 1 && h[k].length <= 50 && h[k].every(v => typeof v === 'string')
                : ['top', 'bottom'].includes(k) ? Number.isInteger(h[k]) && h[k] >= 1 && h[k] <= 50
                    : h[k] === true);
        if (!valid) fail('highlight 선택자가 잘못되었습니다.', 'Invalid highlight selector.');
    }
}

function aggregateFunctionForUnit(unit) {
    if (unit === '%' || unit === '%p' || unit === '') return 'mean';
    if (ADDITIVE_UNITS.has(unit)) return 'sum';
    return null;
}

function periodLabelsInChronologicalOrder(distinctValues, keyMap) {
    const sorted = [...distinctValues].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = 1; i < sorted.length; i++) {
        if (keyMap.get(sorted[i]) <= keyMap.get(sorted[i - 1])) return false;
    }
    return true;
}

export function suggestChart(dataset, args = {}, locale = 'ko') {
    const fail = (ko, en) => { throw new Error(t(locale, ko, en)); };

    // Apply optional filter first (S2').
    const selected = selectRows(dataset, args.filter, locale, 'filter');
    const filteredDataset = {
        headers: dataset.headers,
        rows: selected.map(item => item.row),
        ...(dataset.lines ? { lines: selected.map(item => item.line) } : {}),
        ...(dataset.table ? { table: dataset.table } : {})
    };
    const cols = filteredDataset.headers.map((_, i) => inspectColumn(filteredDataset, i));
    const colByName = new Map(cols.map(c => [c.name, c]));

    // Validate explicit args (before request parsing for basic shape, then again once goal is known).
    validateExplicitArgs(filteredDataset, args, cols, args.goal, locale);

    const parsed = parseRequest(args.request, cols, args, locale);
    const goal = args.goal ?? (parsed.entries.goal.status === 'applied' ? parsed.entries.goal.value : null);

    if (goal) {
        validateExplicitArgs(filteredDataset, args, cols, goal, locale);
    }

    const prof = profile(filteredDataset, 0, filteredDataset.headers.length);
    const summaryRowCandidates = prof.summaryRowCandidates ?? [];
    const baseCautions = [...parsed.cautions];
    const notes = [];

    if (summaryRowCandidates.length) {
        const names = summaryRowCandidates.slice(0, 3).map(c => c.label).join(', ');
        baseCautions.push(t(locale,
            `합계 행 후보가 있습니다(${names}). 포함하면 다른 행과 함께 더해질 수 있습니다.`,
            `Possible summary rows detected (${names}); including them may double-count totals.`));
    }

    const mixedYearCols = cols.filter(c => c.period?.mixedYear);
    const periodCols = cols.filter(c => c.role === 'period');
    const categoryCols = cols.filter(c => c.role === 'category');
    const numericCols = cols.filter(c => c.role === 'numeric');

    const baseSource = {
        path: args.path || 'data.csv',
        ...(args.table !== undefined ? { table: args.table } : {})
    };
    const rawSource = (extra = {}) => ({
        ...baseSource,
        ...(args.filter ? { filter: args.filter } : {}),
        ...extra
    });
    const analysisSource = (spec) => ({
        ...baseSource,
        analysis: {
            ...spec,
            ...(args.filter ? { filter: args.filter } : {})
        }
    });

    const hasAmbiguous = parsed.confirm.length > 0;
    const candidates = [];
    const topNeeds = [];

    // Resolve label & value columns according to goal.
    let labelCol = null;
    let valueCols = [];
    if (args.label) {
        labelCol = colByName.get(args.label);
    } else if (goal === 'trend') {
        labelCol = periodCols[0] ?? null;
    } else if (goal === 'target') {
        labelCol = categoryCols[0] ?? periodCols[0] ?? null;
    } else if (goal && !['distribution', 'relationship'].includes(goal)) {
        labelCol = categoryCols[0] ?? null;
    }

    if (args.values) {
        valueCols = args.values.map(name => colByName.get(name));
    } else if (goal === 'relationship') {
        valueCols = numericCols.slice(0, 2);
    } else if (goal === 'matrix') {
        // Pick largest group of same-unit numeric columns.
        const byUnit = new Map();
        for (const c of numericCols) {
            if (!byUnit.has(c.unit)) byUnit.set(c.unit, []);
            byUnit.get(c.unit).push(c);
        }
        let best = [];
        for (const group of byUnit.values()) {
            if (group.length > best.length) best = group;
        }
        valueCols = best;
    } else if (numericCols.length) {
        valueCols = [numericCols[0]];
    }

    if (labelCol?.facts.leadingZeros) {
        baseCautions.push(t(locale,
            `열 ${labelCol.name}에 앞자리 0이 있어 범주로 분류했습니다.`,
            `Column ${labelCol.name} has leading zeros and was classified as a category.`));
    }
    for (const vc of valueCols) {
        if (vc.missingRows > 0) {
            baseCautions.push(t(locale,
                `열 ${vc.name}에 결측이 ${vc.missingRows}행 있습니다.`,
                `Column ${vc.name} has ${vc.missingRows} missing row(s).`));
        }
    }

    const rowCount = filteredDataset.rows.length;
    const targetValue = args.target_value ?? (parsed.entries['target.value'].status === 'applied' ? parsed.entries['target.value'].value : undefined);
    const reqHighlight = args.highlight ?? (parsed.entries.highlight.status === 'applied' ? parsed.entries.highlight.value : undefined);
    const simpleHighlight = reqHighlight && !reqHighlight.kind ? reqHighlight : undefined;

    const addCandidate = (type, why, build, extra = {}) => {
        const cand = {
            type,
            why,
            cautions: [...baseCautions, ...(extra.cautions ?? [])],
            ...(build ? { build } : {}),
            ...(extra.needs?.length ? { needs: extra.needs } : {})
        };
        candidates.push(cand);
    };

    const canHighlightType = (type, seriesCount) => (type === 'bar' || type === 'barh') && seriesCount === 1 || type === 'combo';
    const attachExtras = (build, type, seriesCount, { includeTarget = true, highlight = simpleHighlight } = {}) => {
        if (includeTarget && targetValue !== undefined && ['line', 'area', 'bar', 'barh', 'combo'].includes(type)) {
            build.target = { value: targetValue, ...(build.series.some(s => s.secondary) ? { series: 0 } : {}) };
        }
        if (highlight && canHighlightType(type, seriesCount)) {
            if (['below_target', 'above_target'].some(k => Object.hasOwn(highlight, k)) && !build.target) return build;
            build.highlight = highlight;
        }
        return build;
    };

    if (!goal) {
        if (!hasAmbiguous) topNeeds.push('goal');
    } else if (rowCount === 0) {
        baseCautions.push(t(locale, '조건에 맞는 행이 없습니다.', 'No rows match the current filter.'));
    } else if (goal === 'trend') {
        if (!labelCol) {
            if (mixedYearCols.length) {
                baseCautions.push(t(locale,
                    `기간 열 ${mixedYearCols[0].name}에 연도가 있는 값과 없는 값이 섞여 있어 자동 후보에서 뺐습니다.`,
                    `Period column ${mixedYearCols[0].name} mixes values with and without a year and was excluded from automatic candidates.`));
            }
            topNeeds.push('label');
        } else if (!valueCols.length) {
            topNeeds.push('values');
        } else if (labelCol.period?.mixedNotation) {
            const [a, b] = labelCol.period.mixedNotation;
            baseCautions.push(t(locale,
                `같은 기간이 다른 표기로 적혀 있습니다(${a}, ${b}). 자료 표기를 맞추세요.`,
                `The same period is written in different formats (${a}, ${b}). Standardize the notation.`));
        } else {
            const hasDuplicates = rowCount > labelCol.distinct;
            if (hasDuplicates) {
                if (valueCols.length > 1) {
                    baseCautions.push(t(locale,
                        '기간이 중복된 자료는 단일 값 열만 자동 집계할 수 있습니다. values를 1개로 지정하거나 filter로 줄이세요.',
                        'Repeated periods can only be aggregated for one value column. Specify a single value column or filter rows.'));
                } else if (labelCol.distinct > 100) {
                    baseCautions.push(t(locale,
                        `고유 기간이 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다. filter로 범위를 줄이세요.`,
                        `${labelCol.distinct} distinct periods exceed the analysis.limit maximum (100). Filter the range.`));
                } else {
                    const fn = aggregateFunctionForUnit(valueCols[0].unit);
                    if (!fn) {
                        topNeeds.push('function');
                        baseCautions.push(t(locale,
                            `열 ${valueCols[0].name}(${valueCols[0].unit})의 집계 방식(sum/mean)을 자동으로 정할 수 없습니다.`,
                            `Cannot infer aggregate function (sum/mean) for column ${valueCols[0].name} (${valueCols[0].unit}).`));
                    } else if (labelCol.period && !periodLabelsInChronologicalOrder(labelCol.distinctValues, labelCol.period.keyMap)) {
                        baseCautions.push(t(locale,
                            '기간 표기가 섞여 순서를 맞출 수 없습니다.',
                            'Mixed period formats prevent chronological ordering.'));
                    } else {
                        const spec = {
                            type: 'aggregate',
                            columns: [labelCol.name, valueCols[0].name],
                            function: fn,
                            sort: 'label',
                            ...(labelCol.distinct > 60 ? { limit: labelCol.distinct } : {})
                        };
                        const makeBuild = type => attachExtras({
                            type,
                            source: analysisSource(spec),
                            series: [{ column: 'value' }],
                            ...(type === 'line' && labelCol.distinct > 24 ? { range_slider: true } : {}),
                            style: 'report'
                        }, type, 1);
                        if (labelCol.distinct >= 4) {
                            addCandidate('line', t(locale, `기간 ${labelCol.distinct}개를 집계(${fn})해 추이를 선으로 보여줍니다.`, `Aggregates (${fn}) ${labelCol.distinct} periods as a line trend.`), makeBuild('line'));
                            addCandidate('bar', t(locale, '기간별 집계 크기를 막대로 비교합니다.', 'Compares aggregated period values as bars.'), makeBuild('bar'));
                        } else {
                            addCandidate('bar', t(locale, `기간이 ${labelCol.distinct}개로 적어 막대가 읽기 쉽습니다.`, `With only ${labelCol.distinct} periods, bars are easy to compare.`), makeBuild('bar'));
                            addCandidate('line', t(locale, '기간 흐름을 선으로 연결합니다.', 'Connects the periods as a line.'), makeBuild('line'));
                        }
                    }
                }
            } else if (rowCount > 200) {
                baseCautions.push(t(locale,
                    `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                    `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                topNeeds.push('filter');
            } else {
                const twoDiffUnits = valueCols.length === 2 && valueCols[0].unit !== valueCols[1].unit;
                if (twoDiffUnits) {
                    const unitCaution = t(locale,
                        `두 값 열의 단위가 달라(${valueCols[0].unit || '단위 없음'}, ${valueCols[1].unit || '단위 없음'}) 보조축 combo를 추천합니다.`,
                        `Value columns have different units (${valueCols[0].unit || 'no unit'}, ${valueCols[1].unit || 'no unit'}); using a secondary-axis combo chart.`);
                    addCandidate('combo', t(locale, '단위가 다른 두 지표의 추이를 주축 막대와 보조축 선으로 함께 보여줍니다.', 'Shows two metrics with different units using bars and a secondary-axis line.'), attachExtras({
                        type: 'combo',
                        source: rawSource({ labels: labelCol.name }),
                        series: [
                            { column: valueCols[0].name, kind: 'bar' },
                            { column: valueCols[1].name, kind: 'line', secondary: true }
                        ],
                        ...(labelCol.distinct > 24 ? { range_slider: true } : {}),
                        style: 'report'
                    }, 'combo', 2), { cautions: [unitCaution] });
                } else {
                    const series = valueCols.map(c => ({ column: c.name }));
                    const makeBuild = type => attachExtras({
                        type,
                        source: rawSource({ labels: labelCol.name }),
                        series,
                        ...(type === 'line' && labelCol.distinct > 24 ? { range_slider: true } : {}),
                        style: 'report'
                    }, type, series.length);
                    if (labelCol.distinct >= 4) {
                        addCandidate('line', t(locale, `기간 ${labelCol.distinct}개의 변화를 선으로 보여줍니다.`, `Shows changes across ${labelCol.distinct} periods as a line.`), makeBuild('line'));
                        addCandidate('bar', t(locale, '기간별 값을 막대로 비교합니다.', 'Compares period values as bars.'), makeBuild('bar'));
                    } else {
                        addCandidate('bar', t(locale, `기간이 ${labelCol.distinct}개로 적어 막대가 읽기 쉽습니다.`, `With ${labelCol.distinct} periods, bars are easy to read.`), makeBuild('bar'));
                        addCandidate('line', t(locale, '기간 흐름을 선으로 연결합니다.', 'Connects the periods as a line.'), makeBuild('line'));
                    }
                }
            }
        }
    } else if (goal === 'compare') {
        if (!labelCol) topNeeds.push('label');
        else if (!valueCols.length) topNeeds.push('values');
        else {
            if (valueCols.length > 3) fail('compare의 values는 최대 3개입니다.', 'compare accepts at most 3 value columns.');
            if (new Set(valueCols.map(c => c.unit)).size > 1) fail('compare의 값 열들은 같은 단위여야 합니다.', 'compare value columns must share the same unit.');
            const hasDuplicates = rowCount > labelCol.distinct;
            const maxLen = Math.max(0, ...labelCol.distinctValues.map(v => [...v].length));
            const shortCats = labelCol.distinct <= 7 && maxLen <= 8;
            if (hasDuplicates) {
                if (valueCols.length > 1) {
                    baseCautions.push(t(locale, '중복 범주는 단일 값 열만 자동 집계할 수 있습니다.', 'Repeated categories can only be aggregated for one value column.'));
                } else if (labelCol.distinct > 100) {
                    baseCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
                } else {
                    const fn = aggregateFunctionForUnit(valueCols[0].unit);
                    if (!fn) {
                        topNeeds.push('function');
                    } else {
                        const makeBuild = (type, sort) => attachExtras({
                            type,
                            source: analysisSource({
                                type: 'aggregate',
                                columns: [labelCol.name, valueCols[0].name],
                                function: fn,
                                sort,
                                ...(labelCol.distinct > 60 ? { limit: labelCol.distinct } : {})
                            }),
                            series: [{ column: 'value' }],
                            style: 'report'
                        }, type, 1);
                        if (shortCats) {
                            addCandidate('bar', t(locale, `범주 ${labelCol.distinct}개를 집계(${fn})해 세로 막대로 비교합니다.`, `Compares ${labelCol.distinct} aggregated (${fn}) categories vertically.`), makeBuild('bar', 'original'));
                            addCandidate('barh', t(locale, '값 내림차순 가로 막대로 비교합니다.', 'Compares categories sorted descending horizontally.'), makeBuild('barh', 'desc'));
                        } else {
                            addCandidate('barh', t(locale, `범주 ${labelCol.distinct}개(최대 ${maxLen}자)를 값 내림차순 가로 막대로 비교합니다.`, `Horizontal bars fit ${labelCol.distinct} categories (up to ${maxLen} chars).`), makeBuild('barh', 'desc'));
                            addCandidate('bar', t(locale, '세로 막대로 비교합니다.', 'Compares categories vertically.'), makeBuild('bar', 'desc'));
                        }
                    }
                }
            } else if (rowCount > 200) {
                baseCautions.push(t(locale,
                    `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                    `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                topNeeds.push('filter');
            } else {
                const series = valueCols.map(c => ({ column: c.name }));
                const makeBar = () => attachExtras({ type: 'bar', source: rawSource({ labels: labelCol.name }), series, style: 'report' }, 'bar', series.length);
                const makeBarh = () => attachExtras({ type: 'barh', source: rawSource({ labels: labelCol.name, sort: { column: valueCols[0].name, order: 'desc' } }), series, style: 'report' }, 'barh', series.length);
                if (shortCats) {
                    addCandidate('bar', t(locale, `범주 ${labelCol.distinct}개, 이름 길이가 짧아 세로 막대가 읽기 쉽습니다.`, `${labelCol.distinct} short category names fit vertical bars well.`), makeBar());
                    addCandidate('barh', t(locale, '값 순으로 정렬한 가로 막대로 비교합니다.', 'Compares values sorted descending as horizontal bars.'), makeBarh());
                } else {
                    const catCaution = labelCol.distinct > 7 ? [t(locale, `고유 범주가 ${labelCol.distinct}개입니다.`, `There are ${labelCol.distinct} distinct categories.`)] : [];
                    addCandidate('barh', t(locale, `범주 수(${labelCol.distinct}개)나 이름 길이(${maxLen}자)가 커 가로 막대가 읽기 쉽습니다.`, `Horizontal bars are easier to read for ${labelCol.distinct} categories (max ${maxLen} chars).`), makeBarh(), { cautions: catCaution });
                    addCandidate('bar', t(locale, '세로 막대로 비교합니다.', 'Compares categories as vertical bars.'), makeBar(), { cautions: catCaution });
                }
            }
        }
    } else if (goal === 'rank') {
        if (!labelCol) topNeeds.push('label');
        else if (!valueCols.length) topNeeds.push('values');
        else {
            const top = args.top ?? parsed.rankOverride?.top ?? 10;
            const order = parsed.rankOverride?.order ?? 'desc';
            const hasDuplicates = rowCount > labelCol.distinct;
            if (rowCount <= 200 && hasDuplicates && labelCol.distinct <= 100) {
                const fn = aggregateFunctionForUnit(valueCols[0].unit) ?? 'sum';
                const build = attachExtras({
                    type: 'barh',
                    source: analysisSource({
                        type: 'aggregate',
                        columns: [labelCol.name, valueCols[0].name],
                        function: fn,
                        sort: order,
                        limit: top
                    }),
                    series: [{ column: 'value' }],
                    style: 'report'
                }, 'barh', 1);
                addCandidate('barh', t(locale,
                    `${order === 'asc' ? '하위' : '상위'} ${top}개 순위를 집계(${fn})해 가로 막대로 보여줍니다.`,
                    `Shows the ${order === 'asc' ? 'bottom' : 'top'} ${top} aggregated (${fn}) items as horizontal bars.`), build);
            } else {
                const build = attachExtras({
                    type: 'barh',
                    source: rawSource({ labels: labelCol.name, sort: { column: valueCols[0].name, order }, limit: top }),
                    series: [{ column: valueCols[0].name }],
                    style: 'report'
                }, 'barh', 1);
                addCandidate('barh', t(locale,
                    `${order === 'asc' ? '하위' : '상위'} ${top}개 순위를 가로 막대로 보여줍니다.`,
                    `Shows the ${order === 'asc' ? 'bottom' : 'top'} ${top} ranked items as horizontal bars.`), build);
            }
        }
    } else if (goal === 'share') {
        if (!labelCol) topNeeds.push('label');
        else if (!valueCols.length) topNeeds.push('values');
        else {
            const vc = valueCols[0];
            const hasDuplicates = rowCount > labelCol.distinct;
            let useAnalysis = false;
            let checkValues = vc.facts.parsed.filter(v => v !== null);
            let spec = null;
            if (hasDuplicates) {
                if (labelCol.distinct > 100) {
                    baseCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
                } else {
                    useAnalysis = true;
                    spec = {
                        type: 'aggregate',
                        columns: [labelCol.name, vc.name],
                        function: 'sum',
                        sort: 'desc',
                        ...(labelCol.distinct > 60 ? { limit: labelCol.distinct } : {})
                    };
                    const agg = analyze(filteredDataset, spec, locale);
                    checkValues = agg.groups.map(g => g.value).filter(v => v !== null);
                }
            } else if (rowCount > 200) {
                baseCautions.push(t(locale,
                    `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                    `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                topNeeds.push('filter');
            }

            if (!topNeeds.length && !(hasDuplicates && labelCol.distinct > 100)) {
                const allZero = !checkValues.length || checkValues.every(v => v === 0);
                const hasNeg = checkValues.some(v => v < 0);
                if (allZero) {
                    baseCautions.push(t(locale, '모든 값이 0이라 구성비를 그릴 수 없습니다.', 'All values are zero; cannot plot share.'));
                } else {
                    const makeBuild = type => ({
                        type,
                        source: useAnalysis ? analysisSource(spec) : rawSource({ labels: labelCol.name, ...(type === 'barh' ? { sort: { column: vc.name, order: 'desc' } } : {}) }),
                        series: [{ column: useAnalysis ? 'value' : vc.name }],
                        style: 'report'
                    });
                    if (hasNeg) {
                        const negCaution = t(locale, '음수가 있어 원형·도넛 차트를 제외하고 가로 막대만 추천합니다.', 'Negative values exclude donut/pie charts; recommending horizontal bars only.');
                        addCandidate('barh', t(locale, '음수가 포함된 구성은 가로 막대로 비교합니다.', 'Horizontal bars handle negative values in comparisons.'), makeBuild('barh'), { cautions: [negCaution] });
                    } else if (labelCol.distinct <= 5) {
                        addCandidate('donut', t(locale, `범주가 ${labelCol.distinct}개로 적어 도넛 차트로 비중을 한눈에 봅니다.`, `${labelCol.distinct} categories fit a donut chart cleanly.`), makeBuild('donut'));
                        addCandidate('barh', t(locale, '정확한 크기 비교는 가로 막대가 유리합니다.', 'Horizontal bars allow precise magnitude comparison.'), makeBuild('barh'));
                    } else {
                        const manyCaution = t(locale, `고유 범주가 ${labelCol.distinct}개라 원형 대신 가로 막대만 추천합니다.`, `${labelCol.distinct} categories exceed 5; recommending horizontal bars instead of donut.`);
                        addCandidate('barh', t(locale, `범주가 ${labelCol.distinct}개로 많아 정렬된 가로 막대로 비중을 비교합니다.`, `Sorted horizontal bars compare ${labelCol.distinct} categories clearly.`), makeBuild('barh'), { cautions: [manyCaution] });
                    }
                }
            }
        }
    } else if (goal === 'distribution') {
        if (!valueCols.length) topNeeds.push('values');
        else if (rowCount > 200) {
            baseCautions.push(t(locale,
                `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
            topNeeds.push('filter');
        } else {
            const vc = valueCols[0];
            const validCount = vc.facts.parsed.filter(v => v !== null).length;
            if (validCount === 0) {
                baseCautions.push(`Column ${vc.name} has no valid values.`);
            } else {
                const makeBuild = type => ({ type, source: rawSource(), series: [{ column: vc.name }], style: 'report' });
                if (validCount >= 20) {
                    addCandidate('histogram', t(locale, `유효 관측치가 ${validCount}개라 히스토그램으로 분포 모양을 봅니다.`, `${validCount} valid observations suit a histogram.`), makeBuild('histogram'));
                    addCandidate('box', t(locale, '중앙값·사분위·이상치를 상자 그림으로 요약합니다.', 'Summarizes median, quartiles and outliers in a box plot.'), makeBuild('box'));
                } else {
                    addCandidate('box', t(locale, `유효 관측치가 ${validCount}개로 적어 상자 그림을 추천합니다.`, `With fewer than 20 observations (${validCount}), a box plot is clearer.`), makeBuild('box'));
                }
            }
        }
    } else if (goal === 'relationship') {
        if (valueCols.length < 2) {
            topNeeds.push('values');
        } else if (valueCols.length > 3) {
            fail('relationship의 values는 2~3개여야 합니다.', 'relationship requires 2 or 3 value columns.');
        } else if (rowCount > 200) {
            baseCautions.push(t(locale,
                `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
            topNeeds.push('filter');
        } else {
            const [xCol, yCol, sizeCol] = valueCols;
            if (sizeCol) {
                const hasNegSize = sizeCol.facts.parsed.some(v => v !== null && v < 0);
                if (hasNegSize) {
                    const negCaution = t(locale,
                        `크기 열 ${sizeCol.name}에 음수가 있어 bubble을 제외하고 scatter만 추천합니다.`,
                        `Size column ${sizeCol.name} has negative values; excluding bubble and recommending scatter only.`);
                    addCandidate('scatter', t(locale, `${xCol.name}과 ${yCol.name}의 관계를 산점도로 보여줍니다.`, `Plots the relationship between ${xCol.name} and ${yCol.name}.`), {
                        type: 'scatter',
                        source: rawSource({ x: xCol.name }),
                        series: [{ column: yCol.name }],
                        style: 'report'
                    }, { cautions: [negCaution] });
                } else {
                    addCandidate('bubble', t(locale, `${xCol.name}·${yCol.name} 관계와 ${sizeCol.name} 크기를 버블 차트로 보여줍니다.`, `Shows ${xCol.name} vs ${yCol.name} with bubble size ${sizeCol.name}.`), {
                        type: 'bubble',
                        source: rawSource({ x: xCol.name }),
                        series: [{ column: yCol.name, sizeColumn: sizeCol.name }],
                        style: 'report'
                    });
                }
            } else {
                addCandidate('scatter', t(locale, `${xCol.name}과 ${yCol.name}의 관계를 산점도로 보여줍니다.`, `Shows the relationship between ${xCol.name} and ${yCol.name}.`), {
                    type: 'scatter',
                    source: rawSource({ x: xCol.name }),
                    series: [{ column: yCol.name }],
                    style: 'report'
                });
            }
        }
    } else if (goal === 'target') {
        if (!labelCol) topNeeds.push('label');
        else if (!valueCols.length) topNeeds.push('values');
        else {
            const vc = valueCols[0];
            const refCol = args.reference ? colByName.get(args.reference) : null;
            if (refCol) {
                if (vc.unit !== refCol.unit) {
                    fail(
                        `값 열 ${vc.name}(${vc.unit || '단위 없음'})과 기준 열 ${refCol.name}(${refCol.unit || '단위 없음'})의 단위가 다릅니다.`,
                        `Value column ${vc.name} (${vc.unit || 'no unit'}) and reference column ${refCol.name} (${refCol.unit || 'no unit'}) have different units.`
                    );
                }
                const hasDuplicates = rowCount > labelCol.distinct;
                const compareSpec = {
                    type: 'compare',
                    columns: [labelCol.name, vc.name, refCol.name],
                    ...(labelCol.distinct > 60 ? { limit: labelCol.distinct } : {})
                };
                if (hasDuplicates) {
                    if (labelCol.distinct > 100) {
                        baseCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
                    } else {
                        addCandidate('combo', t(locale, '집계된 실적(막대)과 기준(선)을 같은 축에 비교합니다.', 'Compares aggregated actuals (bars) against reference (line) on the same axis.'), attachExtras({
                            type: 'combo',
                            source: analysisSource(compareSpec),
                            series: [{ column: 'value', kind: 'bar' }, { column: 'reference', kind: 'line' }],
                            style: 'report'
                        }, 'combo', 2, { includeTarget: false }));
                        addCandidate('bar', t(locale, '기준 대비 달성률(%)을 목표선 100%와 함께 보여줍니다.', 'Shows achievement ratio (%) with a 100% target line.'), attachExtras({
                            type: 'bar',
                            source: analysisSource(compareSpec),
                            series: [{ column: 'ratio' }],
                            target: { value: 100 },
                            style: 'report'
                        }, 'bar', 1, { includeTarget: false }));
                    }
                } else if (rowCount > 200) {
                    baseCautions.push(t(locale,
                        `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                        `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                    topNeeds.push('filter');
                } else {
                    addCandidate('combo', t(locale, `${vc.name}(막대)과 ${refCol.name}(선)을 같은 축에 비교합니다.`, `Compares ${vc.name} (bars) against ${refCol.name} (line).`), attachExtras({
                        type: 'combo',
                        source: rawSource({ labels: labelCol.name }),
                        series: [{ column: vc.name, kind: 'bar' }, { column: refCol.name, kind: 'line' }],
                        style: 'report'
                    }, 'combo', 2, { includeTarget: false }));
                    if (labelCol.distinct <= 100) {
                        addCandidate('bar', t(locale, '기준 대비 비율(%)을 100% 목표선과 함께 보여줍니다.', 'Shows ratio to reference (%) with a 100% target line.'), attachExtras({
                            type: 'bar',
                            source: analysisSource(compareSpec),
                            series: [{ column: 'ratio' }],
                            target: { value: 100 },
                            style: 'report'
                        }, 'bar', 1, { includeTarget: false }));
                    }
                }
            } else {
                const hasDuplicates = rowCount > labelCol.distinct;
                if (hasDuplicates) {
                    if (labelCol.distinct > 100) {
                        baseCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
                    } else {
                        const fn = aggregateFunctionForUnit(vc.unit);
                        if (!fn) {
                            topNeeds.push('function');
                        } else {
                            const build = attachExtras({
                                type: 'bar',
                                source: analysisSource({
                                    type: 'aggregate',
                                    columns: [labelCol.name, vc.name],
                                    function: fn,
                                    ...(labelCol.distinct > 60 ? { limit: labelCol.distinct } : {})
                                }),
                                series: [{ column: 'value' }],
                                style: 'report'
                            }, 'bar', 1);
                            addCandidate('bar', t(locale, targetValue !== undefined ? `목표선 ${targetValue} 대비 값을 막대로 비교합니다.` : '목표값과 비교할 막대 차트입니다(target.value 필요).', targetValue !== undefined ? `Compares values against target ${targetValue}.` : 'Bar chart ready for a target line (needs target.value).'), build, targetValue === undefined ? { needs: ['target.value'] } : {});
                        }
                    }
                } else if (rowCount > 200) {
                    baseCautions.push(t(locale,
                        `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                        `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                    topNeeds.push('filter');
                } else {
                    const build = attachExtras({
                        type: 'bar',
                        source: rawSource({ labels: labelCol.name }),
                        series: [{ column: vc.name }],
                        style: 'report'
                    }, 'bar', 1);
                    addCandidate('bar', t(locale, targetValue !== undefined ? `목표선 ${targetValue} 대비 값을 막대로 비교합니다.` : '목표선과 비교할 막대 차트입니다(target.value 필요).', targetValue !== undefined ? `Compares values against target ${targetValue}.` : 'Bar chart ready for a target line (needs target.value).'), build, targetValue === undefined ? { needs: ['target.value'] } : {});
                }
            }
        }
    } else if (goal === 'change') {
        if (!labelCol) topNeeds.push('label');
        else if (!valueCols.length) topNeeds.push('values');
        else {
            const vc = valueCols[0];
            const explicitPeriod = args.period;
            const parsedPeriod = parsed.entries.period.status === 'applied' ? parsed.entries.period.value : null;
            const pColName = explicitPeriod?.column ?? parsedPeriod?.column ?? (periodCols.length === 1 ? periodCols[0].name : null);
            const pCol = pColName ? colByName.get(pColName) : null;

            if (!pCol) {
                if (mixedYearCols.length) {
                    baseCautions.push(t(locale,
                        `기간 열 ${mixedYearCols[0].name}에 연도가 있는 값과 없는 값이 섞여 있어 자동 후보에서 뺐습니다.`,
                        `Period column ${mixedYearCols[0].name} mixes values with and without a year and was excluded from automatic candidates.`));
                }
                if (periodCols.length > 1) {
                    baseCautions.push(t(locale,
                        `기간 열이 여러 개입니다(${periodCols.map(c => c.name).join(', ')}). period.column을 지정하세요.`,
                        `Multiple period columns found (${periodCols.map(c => c.name).join(', ')}); specify period.column.`));
                }
                topNeeds.push('period.column');
            } else if (pCol.period?.mixedNotation) {
                const [a, b] = pCol.period.mixedNotation;
                baseCautions.push(t(locale,
                    `같은 기간이 다른 표기로 적혀 있습니다(${a}, ${b}). 자료 표기를 맞추세요.`,
                    `The same period is written in different formats (${a}, ${b}). Standardize the notation.`));
            } else {
                const base = explicitPeriod?.base ?? parsedPeriod?.base;
                const target = explicitPeriod?.target ?? parsedPeriod?.target;
                if (!base || !target) {
                    const periodValues = pCol.distinctValues.slice(0, 20);
                    notes.push(t(locale,
                        `비교할 두 기간을 지정하세요. 열 ${pCol.name} 고유값: ${periodValues.join(', ')}`,
                        `Specify two periods to compare. Distinct values in ${pCol.name}: ${periodValues.join(', ')}`));
                    const fn = ['%', '%p'].includes(vc.unit) ? 'mean' : 'sum';
                    const preferred = (reqHighlight || fn !== 'sum' || ['%', '%p'].includes(vc.unit)) ? 'barh' : 'waterfall';
                    addCandidate(preferred, t(locale,
                        `두 기간(${pCol.name})의 증감을 ${preferred}로 비교합니다(base·target 필요).`,
                        `Compares period-over-period change on ${pCol.name} as ${preferred} (needs base and target).`), null, { needs: ['period.base', 'period.target'] });
                } else {
                    const fn = ['%', '%p'].includes(vc.unit) ? 'mean' : 'sum';
                    const probeSpec = {
                        type: 'compare',
                        columns: [labelCol.name, vc.name],
                        period: { column: pCol.name, base, target },
                        function: fn,
                        limit: 100
                    };
                    const comp = analyze(filteredDataset, probeSpec, locale);
                    const compareSpec = {
                        type: 'compare',
                        columns: [labelCol.name, vc.name],
                        period: { column: pCol.name, base, target },
                        function: fn,
                        ...(comp.groupCount > 60 && comp.groupCount <= 100 ? { limit: comp.groupCount } : {})
                    };

                    // Resolve conditional decrease/increase highlight on final displayed set (S4').
                    let resolvedHighlight = simpleHighlight;
                    if (reqHighlight?.kind) {
                        const shownLimit = compareSpec.limit ?? 60;
                        const displayed = comp.groups.slice(0, shownLimit);
                        const filtered = reqHighlight.kind === 'decrease'
                            ? displayed.filter(g => g.difference !== null && g.difference < 0).sort((a, b) => a.difference - b.difference || a.group.localeCompare(b.group))
                            : displayed.filter(g => g.difference !== null && g.difference > 0).sort((a, b) => b.difference - a.difference || a.group.localeCompare(b.group));
                        const picked = filtered.slice(0, reqHighlight.count).map(g => g.group);
                        parsed.entries.highlight.selected = picked.length;
                        if (picked.length > 0) {
                            resolvedHighlight = { labels: picked };
                            parsed.entries.highlight.value = { labels: picked };
                        } else {
                            resolvedHighlight = undefined;
                            parsed.entries.highlight.value = { labels: [] };
                            notes.push(t(locale,
                                `${reqHighlight.kind === 'decrease' ? '감소' : '증가'}한 항목이 없어 강조를 넣지 않았습니다(selected: 0).`,
                                `No ${reqHighlight.kind === 'decrease' ? 'decreasing' : 'increasing'} items found; highlight omitted (selected: 0).`));
                        }
                    }

                    const canWaterfall = fn === 'sum' && !['%', '%p'].includes(vc.unit) && !comp.truncated;
                    const barhBuild = attachExtras({
                        type: 'barh',
                        source: analysisSource(compareSpec),
                        series: [{ column: 'difference' }],
                        style: 'report'
                    }, 'barh', 1, { highlight: resolvedHighlight });
                    const waterfallBuild = canWaterfall ? {
                        type: 'waterfall',
                        source: analysisSource(compareSpec),
                        series: [{ column: 'difference' }],
                        style: 'report'
                    } : null;

                    if (resolvedHighlight) {
                        addCandidate('barh', t(locale, `${base}→${target} 증감을 가로 막대로 보여주고 요청한 항목을 강조합니다.`, `Shows ${base}→${target} change as horizontal bars with highlight.`), barhBuild);
                        if (waterfallBuild) addCandidate('waterfall', t(locale, '강조 없이 전체 증감 합계를 폭포 차트로 보여줍니다.', 'Shows additive period change as a waterfall without highlight.'), waterfallBuild);
                    } else if (waterfallBuild) {
                        addCandidate('waterfall', t(locale, `${base}→${target} 가산 증감(${fn})을 폭포 차트로 보여줍니다.`, `Shows additive ${base}→${target} change (${fn}) as a waterfall.`), waterfallBuild);
                        addCandidate('barh', t(locale, '항목별 증감 크기를 가로 막대로 비교합니다.', 'Compares change per group as horizontal bars.'), barhBuild);
                    } else {
                        addCandidate('barh', t(locale, `${base}→${target} 증감을 가로 막대로 보여줍니다.`, `Shows ${base}→${target} change as horizontal bars.`), barhBuild);
                    }
                }
            }
        }
    } else if (goal === 'matrix') {
        if (!labelCol) topNeeds.push('label');
        else if (valueCols.length < 3) {
            baseCautions.push(t(locale,
                '긴 표는 heatmap 전에 행·열로 펼쳐야 합니다.',
                'Long tables must be pivoted to rows and columns before a heatmap.'));
        } else {
            if (new Set(valueCols.map(c => c.unit)).size > 1) {
                fail('matrix의 값 열들은 같은 단위여야 합니다.', 'matrix value columns must share the same unit.');
            }
            if (rowCount > 200 || rowCount > labelCol.distinct) {
                baseCautions.push(t(locale,
                    rowCount > 200
                        ? `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`
                        : '범주 이름이 겹쳐 heatmap을 원자료로 그릴 수 없습니다. filter로 줄이거나 집계하세요.',
                    rowCount > 200
                        ? `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`
                        : 'Duplicate category labels cannot be plotted as a raw heatmap.'));
                topNeeds.push('filter');
            } else {
                const used = valueCols.slice(0, 12);
                const extraCautions = valueCols.length > 12 ? [t(locale,
                    `수치 열이 ${valueCols.length}개라 앞 12개만 사용했습니다.`,
                    `${valueCols.length} numeric columns found; using the first 12.`)] : [];
                valueCols = used;
                addCandidate('heatmap', t(locale, `${labelCol.name}과 ${used.length}개 지표를 히트맵으로 비교합니다.`, `Compares ${labelCol.name} across ${used.length} metrics as a heatmap.`), {
                    type: 'heatmap',
                    source: rawSource({ labels: labelCol.name }),
                    series: used.map(c => ({ column: c.name, name: c.name })),
                    style: 'report'
                }, { cautions: extraCautions });
            }
        }
    }

    // S4: If any field is ambiguous, withhold build from ALL candidates.
    const limited = candidates.slice(0, 3);
    if (hasAmbiguous) {
        for (const cand of limited) delete cand.build;
    }

    const dataShape = {
        rows: rowCount,
        labelColumn: labelCol?.name ?? null,
        labelKind: labelCol?.role ?? null,
        distinct: labelCol?.distinct ?? 0,
        valueColumns: valueCols.map(c => ({ name: c.name, ...(c.unit ? { unit: c.unit } : {}) })),
        summaryRowCandidates
    };

    return {
        goal,
        dataShape,
        candidates: limited,
        readFromRequest: parsed.readFromRequest,
        ...(parsed.confirm.length ? { confirm: parsed.confirm } : {}),
        ...(topNeeds.length ? { needs: topNeeds } : {}),
        ...(baseCautions.length && !limited.length ? { cautions: baseCautions } : {}),
        ...(notes.length ? { notes } : {})
    };
}
