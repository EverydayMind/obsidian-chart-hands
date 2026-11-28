import { analyze, compareNatural, compareText, parseCell, profile, selectRows } from './eda.js';
import { periodKey } from './period.js';
import { inspectColumn, periodHeader } from './column-roles.js';

export const SUGGEST_GOALS = ['trend', 'compare', 'rank', 'share', 'distribution', 'relationship', 'target', 'change', 'matrix'];

const ADDITIVE_UNITS = new Set([
    '원', '천원', '만원', '백만원', '억원', '조원', '달러', '₩', '$', '€', '£', '¥', '건', '개', '회', '곳', '개소', '톤', 'kg',
    'K', 'k', 'M', 'B', 'bn', 'mn', 'thousand', 'million', 'billion',
    'USD', 'EUR', 'KRW', 'JPY', 'GBP',
    'pcs', 'units', 'people', 'cases', 'items',
    ...['₩', '$', '€', '£', '¥'].flatMap(c => ['K', 'k', 'M', 'B', 'bn', 'mn', ' thousand', ' million', ' billion'].map(s => c + s))
]);
const KOREAN_NUMERALS = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const ENGLISH_NUMERALS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NEGATION_RE = /(?:말|빼고|제외|않|없이)|\b(?:except|excluding|exclude|without|other\s+than|apart\s+from|not|omit|leave\s+out|skip)\b|n't\b/i;
const METRIC_MASK_RE = /(?:집행률|달성률|비율|증가율|감소율)/g;
const DIRECTION_WORD_RE = /(?:기준|대비|비해|보다|앞|뒤|이전|이후|전년|작년|올해|금년)|\b(?:compared|against|relative|than|since|baseline|base|previous|prior|earlier|later|before|after|last\s+year|this\s+year)\b|\bfrom\b(?=[^,.;!?]*\bto\b)/i;
const PRIOR_PERIOD_COMPARE_RE = /(?:전년\s*동기\s*대비|전년\s*대비|작년\s*대비|전월\s*대비|전기\s*대비)|\b(?:year[\s-]+over[\s-]+year|yoy|y\/y|month[\s-]+over[\s-]+month|mom|quarter[\s-]+over[\s-]+quarter|qoq|(?:from|over|versus|vs\.?|compared\s+(?:with|to)|against)\s+the\s+(?:previous|prior|last)\s+(?:year|month|quarter|period))\b/gi;
const RELATIVE_PERIOD_RE = /(?:전년|작년|올해|금년)|\b(?:last\s+year|this\s+year|previous\s+year|prior\s+year)\b/i;
const LIST_OR_TABLE_RE = /(?:표로|목록|따로)|\b(?:as\s+a\s+table|in\s+a\s+table|list|separately)\b/i;
const HIGHLIGHT_WORD_RE = /(?:강조|색|칠|눈에\s*띄게)|\b(?:highlight(?:ed|ing)?|emphasi[sz]ed?|emphasis|call\s+out|stand\s+out|colou?r)\b/i;
const DISPLAY_WORD_RE = /(?:차트|그래프|보여|표시)|\b(?:chart|graph|plot|show|display|visuali[sz]e)\b/i;

const SUMMARY_COL_HEAD_RE = /^(?:합계|총계|total)$/i;
const PRINT_STYLE_RE = /(?:흑백|인쇄용?|프린트)|\b(?:print(?:able)?|grayscale|greyscale|monochrome|black[\s-]+and[\s-]+white|b&w)\b/i;
const SLIDES_STYLE_RE = /(?:슬라이드|발표용?|프레젠테이션)|\b(?:slides?|presentation|deck)\b/i;
const RANGE_SLIDER_RE = /(?:기간(?:을|도)?\s*(?:좁혀|조절|선택|확대|축소)|구간(?:을|도)?\s*(?:좁혀|조절|선택)|슬라이더)|\b(?:range[\s-]*slider|zoom(?:able)?|narrow\s+(?:the\s+)?(?:period|range|dates?))\b/i;
const POINT_LABEL_RE = /(?:점마다|점\s*이름|점\s*라벨|각\s*점에|이름(?:을)?\s*(?:표시|붙|적))|\b(?:label(?:s|ed|led)?\s+(?:each\s+)?points?|point\s+labels?|with\s+(?:item|category)?\s*names?)\b/i;
const COUNT_REQUEST_RE = /(?:(?:^|[\s·/])(?:수|개수|갯수|건수)|(?:개수|갯수|건수))(?=$|[\s.,;:!?()[\]{}·/]|을|를|은|는|이|가|의|에|로|으로|와|과|및)|\b(?:count|counts|number\s+of|how\s+many)\b/i;

const GOAL_KEYWORDS = [
    ['target', [/계획 대비/, /예산 대비/, /목표/, /(?<![A-Za-z])target(?![A-Za-z])/i, /(?<![A-Za-z])plan(?![A-Za-z])/i]],
    ['change', [/전년 대비/, /전년 동기/, /(?<![A-Za-z])year over year(?![A-Za-z])/i, /변화량/, /늘어난/, /줄어든/, /증감/, /증가/, /감소/, /(?<![A-Za-z])(?:change|increases?|decreases?|declines?|growth|drops?|rises?|gains?|falls?)(?![A-Za-z])/i]],
    ['rank', [/순위/, /랭킹/, /(?<![A-Za-z])(?:rank|ranking|ranked)(?![A-Za-z])/i]],
    ['share', [/구성비/, /비중/, /점유/, /차지/, /(?<![A-Za-z])(?:composition|share|proportion|breakdown)(?![A-Za-z])/i]],
    ['trend', [/(?<![A-Za-z])over time(?![A-Za-z])/i, /분기별/, /연도별/, /월별/, /주차별/, /주별/, /추이/, /추세/, /흐름/, /(?<![A-Za-z])(?:trend|monthly|quarterly|yearly|annual|weekly)(?![A-Za-z])/i]],
    ['distribution', [/분포/, /편차/, /(?<![A-Za-z])distribution(?![A-Za-z])/i]],
    ['relationship', [/상관/, /관계/, /(?<![A-Za-z])correlation(?![A-Za-z])/i, /(?<![A-Za-z])relationship(?![A-Za-z])/i]],
    ['matrix', [/히트맵/, /매트릭스/, /(?<![A-Za-z])heatmap(?![A-Za-z])/i, /(?<![A-Za-z])matrix(?![A-Za-z])/i]],
    ['compare', [/비교/, /(?<![A-Za-z])(?:compare|comparison|vs)(?![A-Za-z])/i]]
];

const RANK_ORDER_DESC_RE = /(?:많은|큰|높은)\s*순(?:으로|서)?|내림차순|상위\s*순|\b(?:largest|highest|biggest|most|greatest)\s+first\b|\bdescending(?:\s+order)?\b|\bhigh\s+to\s+low\b/i;
const RANK_ORDER_ASC_RE = /(?:적은|작은|낮은)\s*순(?:으로|서)?|오름차순|하위\s*순|\b(?:smallest|lowest|least|fewest)\s+first\b|\bascending(?:\s+order)?\b|\blow\s+to\s+high\b/i;

const UNSUPPORTED_SHAPES = [
    [/(?:산키|생키)|\bsankey\b/i, 'hierarchy'],
    [/(?:아이시클)|\bicicle\b|\bparcats\b/i, 'hierarchy'],
    [/(?:캔들스틱|봉\s*차트)|\b(?:candlestick|ohlc)\b/i, 'timeseries'],
    [/(?:등고선|삼각도|평행좌표|풍배도|3차원)|\b(?:contour|surface|3d|scatter3d|ternary|parcoords|barpolar)\b/i, 'scientific'],
    [/(?:단계구분도|지도)|\b(?:choropleth|scattergeo|scattermap|choroplethmap|densitymap|map\s+chart|world\s+map)\b/i, 'maps'],
    [/(?:산점도\s*행렬|오차\s*막대|신뢰\s*구간)|\b(?:splom|error\s*bars?|confidence\s*band)\b/i, 'statistical'],
    [/(?:서브플롯|다중\s*패널)|\bsubplots?\b/i, 'layout']
];

const SUPPORTED_SHAPES = [
    { re: /(?:누적\s*가로\s*막대|가로\s*누적\s*막대)|\bstacked\s+horizontal\s+bar\b/i, type: 'barh', stacked: true, defaultGoal: 'compare', periodGoal: 'trend' },
    { re: /(?:누적\s*막대|스택\s*막대)|\bstacked\s+(?:bar|column)\b/i, type: 'bar', stacked: true, defaultGoal: 'compare', periodGoal: 'trend' },
    { re: /(?:누적\s*영역|누적\s*면적|스택\s*영역)|\bstacked\s+area\b/i, type: 'area', stacked: true, defaultGoal: 'trend' },
    { re: /(?:가로\s*막대|수평\s*막대)|\b(?:horizontal\s+bar|barh)\b/i, type: 'barh', defaultGoal: 'compare' },
    { re: /(?:세로\s*막대|막대\s*(?:차트|그래프)|바\s*차트)|\b(?:bar\s+(?:chart|graph|plot)|column\s+(?:chart|graph))\b/i, type: 'bar', defaultGoal: 'compare' },
    { re: /(?:영역\s*(?:차트|그래프)|면적\s*(?:차트|그래프))|\barea\s+(?:chart|graph|plot)\b/i, type: 'area', defaultGoal: 'trend' },
    { re: /(?<!목표|기준|추세)(?:꺾은선|선\s*(?:차트|그래프)|라인\s*(?:차트|그래프))|\bline\s+(?:chart|graph|plot)\b/i, type: 'line', defaultGoal: 'trend' },
    { re: /(?:도넛)|\b(?:donut|doughnut)\b/i, type: 'donut', defaultGoal: 'share' },
    { re: /(?:파이|원형\s*(?:차트|그래프)?|원\s*(?:차트|그래프))|\bpie\s*(?:chart|graph)?\b/i, type: 'pie', defaultGoal: 'share' },
    { re: /(?:산점도|스캐터)|\bscatter(?:\s*(?:plot|chart))?\b/i, type: 'scatter', defaultGoal: 'relationship' },
    { re: /(?:버블|거품)\s*(?:차트|그래프)?|\bbubble\s*(?:chart|plot)?\b/i, type: 'bubble', defaultGoal: 'relationship' },
    { re: /(?:히트맵|열지도)|\b(?:heatmap|heat\s+map)\b/i, type: 'heatmap', defaultGoal: 'matrix' },
    { re: /(?:히스토그램|도수분포)|\bhistogram\b/i, type: 'histogram', defaultGoal: 'distribution' },
    { re: /(?:상자\s*(?:그림|수염|차트)|박스\s*(?:플롯|차트))|\bbox\s*(?:plot|chart)\b/i, type: 'box', defaultGoal: 'distribution' },
    { re: /(?:바이올린)|\bviolin(?:\s*(?:plot|chart))?\b/i, type: 'violin', defaultGoal: 'distribution' },
    { re: /(?:폭포|워터폴)|\bwaterfall\b/i, type: 'waterfall', defaultGoal: 'change' },
    { re: /(?:깔때기|퍼널)|\bfunnel\b/i, type: 'funnel', defaultGoal: 'compare' },
    { re: /(?:트리맵)|\btreemap\b/i, type: 'treemap', defaultGoal: 'share' },
    { re: /(?:선버스트)|\bsunburst\b/i, type: 'sunburst', defaultGoal: 'share' },
    { re: /(?:레이더|방사형|거미줄)|\bradar\b/i, type: 'radar', defaultGoal: 'compare' },
    { re: /(?:게이지|계기판)|\bgauge\b/i, type: 'indicator', gauge: true, defaultGoal: 'target' },
    { re: /(?:복합\s*(?:차트|그래프)|겹친\s*(?:차트|그래프)|이중축)|\b(?:combo\s*(?:chart)?|dual[\s-]axis|bar\s+and\s+line)\b/i, type: 'combo', defaultGoal: 'compare', periodGoal: 'trend' }
];

const COMBO_CLAUSE_KO_RE = /([^,.;!?]+?)(?:은|는|을|를)\s*(막대|바|선|꺾은선|라인|영역|면적)(?:로|으로|\s*차트|\s*그래프)/g;
const COMBO_CLAUSE_EN_AS_RE = /\b([A-Za-z0-9_\s-]+?)\s+as\s+(?:a\s+)?(bars?|columns?|lines?|areas?)\b/gi;
const COMBO_CLAUSE_EN_FOR_RE = /\b(bars?|columns?|lines?|areas?)\s+for\s+([^,.;!?]+?)(?=\s+and\s+(?:a\s+)?(?:bars?|columns?|lines?|areas?)\b|[,.;!?]|$)/gi;
const COMBO_KIND_BAR_RE = /^(?:막대|바|bars?|columns?)$/i;
const COMBO_KIND_AREA_RE = /^(?:영역|면적|areas?)$/i;

const EN_MONTH_PAT = /(?:january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/.source;
const PERIOD_TOKEN_BODY = [
    /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/,
    /\d{4}[-./]\d{1,2}[-./]\d{1,2}/,
    /\d{4}년\s*\d{1,2}월/,
    /\d{4}[-./]\d{1,2}/,
    /\d{4}\s*-?\s*W(?:0?[1-9]|[1-4]\d|5[0-3])/,
    new RegExp(`${EN_MONTH_PAT}\\.?(?:\\s+|-)\\d{4}`),
    new RegExp(`\\d{4}(?:\\s+|-)${EN_MONTH_PAT}\\.?`),
    /\d{4}년\s*[1-4]분기/,
    /\d{4}\s*-?\s*Q[1-4]/,
    /Q[1-4]\s+\d{4}/,
    /\d{4}(?:년)?\s*(?:상반기|하반기)/,
    /\d{4}\s*-?\s*H[12]/,
    /H[12](?:\s+|-)\d{4}/,
    /\d{4}(?:년도|년)?/,
    /[1-4]분기/,
    /Q[1-4]/,
    /H[12]/,
    /\d{1,2}월/,
    /상반기/,
    /하반기/
].map(re => re.source).join('|');

const RIGHT_BOUNDARY = /(?=$|[\s.,;:!?()[\]{}·/~]|으로|은|는|이|가|을|를|의|에|만|로|과|와|및)/.source;
const PERIOD_TOKEN_RE = new RegExp(`(^|[\\s.,;:!?()\\[\\]{}·/~])(${PERIOD_TOKEN_BODY})${RIGHT_BOUNDARY}`, 'gi');

const PERIOD_RANGE_KO_YM_RE = /(\d{4})년\s*(\d{1,2})월?\s*(?:[~–-]|부터)\s*(\d{1,2})월(?:까지)?/g;
const PERIOD_RANGE_ISO_YM_RE = /(\d{4})[-./](\d{1,2})\s*[~–]\s*(\d{4})[-./](\d{1,2})/g;
const PERIOD_SINCE_RE = /(\d{4})년(?:도)?\s*(?:부터|이후)|\bsince\s+(\d{4})\b/gi;
const PERIOD_FOLLOW_UNIT_RE = /^\s*(?:주의|주|월의|월|년의|년)(?=$|[\s.,;:!?()[\]{}·/])/;

const KO_UNIT_PAT = /(?:%p|%|백만원|천원|만원|억원|조원|원|달러|개소|건|명|개|회|곳|톤)/.source;
const EN_UNIT_PAT = /(?:thousand|million|billion|people|units|cases|items|USD|EUR|KRW|JPY|GBP|pcs|bn|mn|pp|kg|km|K|k|M|B)(?![A-Za-z])/.source;
const UNIT_PAT = `(?:${KO_UNIT_PAT}|${EN_UNIT_PAT})`;
const TARGET_PREFIX_PAT = /(?:목표(?:값)?|계획(?:값)?|\b(?:target\s+value\s+of|target\s+line\s+at|target\s+of|goal\s+of|target))\s*(?:은|는|이|가|is|:|=)?\s*/.source;
const TARGET_NUM_PAT = /[+\-−△]?(?:[₩$€¥£]|(?:USD|EUR|KRW|JPY|GBP)\b)?\s*(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d*)?|\.\d+)/.source;
const TARGET_VALUE_RE = new RegExp(`${TARGET_PREFIX_PAT}(${TARGET_NUM_PAT}(?:\\s*${UNIT_PAT})?)`, 'gi');
const TARGET_SUFFIX_RE = new RegExp(`(?<![A-Za-z0-9.])(${TARGET_NUM_PAT}(?:\\s*${UNIT_PAT})?)\\s+(?:target|goal)\\b`, 'gi');

const NUM_TOKEN = /(?:\d+(?:\.\d+)?%?|다섯|여섯|일곱|여덟|아홉|[한두세네열])/.source;
const EN_NUM_TOKEN = /(?:\d+(?:\.\d+)?%?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b)/.source;
const QTY_TAIL = /(?=$|[\s.,;:!?()[\]{}·/]|곳|개소|개|명|건|부서|기관|항목|품목|은|는|이|가|을|를|의|에|만|로|으로|과|와|및)/.source;
const DELTA_HIGHLIGHT_RE = new RegExp(`${/(감소|증가)(?:가|이)?\s*(?:폭이\s*)?(?:가장\s*)?큰\s*/.source}(${NUM_TOKEN})${QTY_TAIL}`);
const EN_DELTA_WORD = /(declines?|decreases?|drops?|falls?|increases?|gains?|rises?)/.source;
const EN_DEC_WORD_RE = /^(?:declines?|decreases?|drops?|falls?)$/i;
const EN_DELTA_RES = [
    new RegExp(`\\b(${EN_NUM_TOKEN})\\s+(?:largest|biggest)\\s+${EN_DELTA_WORD}\\b`, 'i'),
    new RegExp(`\\b(?:largest|biggest)\\s+(${EN_NUM_TOKEN})\\s+${EN_DELTA_WORD}\\b`, 'i'),
    new RegExp(`\\b(${EN_NUM_TOKEN})\\s+(?:\\w+\\s+){0,2}with\\s+the\\s+(?:largest|biggest)\\s+${EN_DELTA_WORD}\\b`, 'i')
];
const RANK_QTY_RE = new RegExp(`(?:${/(상위|하위|많은|적은|큰|작은|높은|낮은)\s?/.source}(${NUM_TOKEN})${QTY_TAIL}|\\b${/(top|bottom|highest|lowest|largest|smallest|biggest)/.source}\\s+(${EN_NUM_TOKEN})(?=$|[\\s.,;:!?()\\[\\]{}·/]))`, 'i');
const EN_RANK_NUM_FIRST_RE = new RegExp(`\\b(${EN_NUM_TOKEN})\\s+(highest|lowest|largest|smallest|biggest)\\b`, 'i');
const KO_SUPERLATIVE_QTY_RE = new RegExp(`${/(?:가장|제일)\s*(많은|적은|큰|작은|높은|낮은)\s?/.source}(${NUM_TOKEN})${QTY_TAIL}`);
const DIR_COMPARE_PAT = /(?:\s+대비\s+|에\s*비해\s+|보다\s+)/.source;
const DIR_BASE_PAT = /(?:를|을|는|은)?\s*기준으로\s+.*/.source;
const BY_PREFIX_EN_RE = /\bby\s+$/i;
const BY_SUFFIX_KO_RE = /^별/;
const KO_VALUE_BOUNDARY_RE = /^(?:$|[\s.,;:!?()[\]{}·/]|은|는|이|가|을|를|의|에|에서|만|로|으로|과|와|및)/;
const KO_CHAR_LOOKBEHIND = /(?<![가-힣])/.source;

const t = (locale, ko, en) => (locale === 'ko' ? ko : en);
const areaWhy = (locale, stacked) => t(locale,
    `기간별 변화를 ${stacked ? '누적 ' : ''}영역 차트로 보여줍니다.`,
    `Shows changes over time as ${stacked ? 'a stacked ' : 'an '}area chart.`);
const crowdedPieCaution = (locale, count) => t(locale,
    `항목이 ${count}개로 많아 원형·도넛은 읽기 어려울 수 있습니다.`,
    `${count} categories may be crowded in a pie or donut chart.`);

function parseQuantity(token) {
    if (Object.hasOwn(KOREAN_NUMERALS, token)) return KOREAN_NUMERALS[token];
    const lower = token.toLowerCase();
    if (Object.hasOwn(ENGLISH_NUMERALS, lower)) return ENGLISH_NUMERALS[lower];
    if (/[.%]/.test(token)) return null;
    const n = Number(token);
    return Number.isInteger(n) ? n : null;
}

function hasOnlyBefore(request, matchIndex) {
    const before = request.slice(0, matchIndex);
    const clause = before.slice(Math.max(before.lastIndexOf(','), before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1);
    return /\b(?:only|just)\b/i.test(clause);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function columnHead(name) {
    const trimmed = String(name ?? '').trim();
    const m = trimmed.match(/^[^_([\]]+/);
    return (m ? m[0] : trimmed).trim();
}

function isSummaryColumn(col) {
    return SUMMARY_COL_HEAD_RE.test(columnHead(col.name));
}

function buildColumnMatchRegex(phrase, flags = 'gi') {
    const compact = phrase.replace(/\s+/g, '');
    if (!compact) return null;
    const isAscii = /^[A-Za-z0-9_.-]+$/.test(compact);
    if (isAscii) {
        if (compact.length < 2) return null;
        const body = phrase.trim().split(/[\s_]+/).filter(Boolean).map(escapeRegExp).join('[\\s_]+');
        return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, flags);
    }
    const chars = [...compact];
    if (chars.length < 2) return null;
    const body = chars.map(escapeRegExp).join('\\s*');
    return new RegExp(body, flags);
}

function maskLongerColumnHeads(request, cols) {
    let masked = request;
    for (const col of cols) {
        const head = columnHead(col.name);
        const compact = head.replace(/\s+/g, '');
        if (compact.length < 2) continue;
        let containsShorterGoal = false;
        for (const [, patterns] of GOAL_KEYWORDS) {
            for (const re of patterns) {
                const m = compact.match(re);
                if (m && m[0].replace(/\s+/g, '').length < compact.length) {
                    containsShorterGoal = true;
                    break;
                }
            }
            if (containsShorterGoal) break;
        }
        if (!containsShorterGoal) continue;
        const re = buildColumnMatchRegex(head, 'gi');
        if (re) masked = masked.replace(re, m => ' '.repeat(m.length));
    }
    return masked;
}

function matchGoalKeywords(request, cols = []) {
    const colMasked = maskLongerColumnHeads(request, cols);
    const masked = colMasked.replace(METRIC_MASK_RE, m => ' '.repeat(m.length));
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

function buildColumnSearchForms(cols) {
    const partCounts = new Map();
    for (const col of cols) {
        const head = columnHead(col.name);
        if (/[·/]/.test(head)) {
            for (const part of head.split(/[·/]/).map(s => s.trim()).filter(s => [...s.replace(/\s+/g, '')].length >= 2)) {
                const key = part.toLowerCase();
                partCounts.set(key, (partCounts.get(key) || 0) + 1);
            }
        }
    }
    return cols.map(col => {
        const forms = [];
        const addForm = (text, priority) => {
            const tStr = text.trim();
            if (!tStr) return;
            const key = tStr.toLowerCase().replace(/\s+/g, '');
            if (forms.some(f => f.key === key)) return;
            const re = buildColumnMatchRegex(tStr, 'gi');
            if (re) forms.push({ text: tStr, key, re, len: [...key].length, priority });
        };
        addForm(col.name, 3);
        if (/_/.test(col.name) && /^[A-Za-z0-9_\s]+$/.test(col.name)) {
            addForm(col.name.replace(/_/g, ' '), 3);
        }
        const head = columnHead(col.name);
        addForm(head, 2);
        if (/[·/]/.test(head)) {
            for (const part of head.split(/[·/]/).map(s => s.trim())) {
                if ([...part.replace(/\s+/g, '')].length >= 2 && partCounts.get(part.toLowerCase()) === 1) {
                    addForm(part, 1);
                }
            }
        }
        return { col, forms };
    });
}

function findMentionedColumns(text, cols) {
    const searchForms = buildColumnSearchForms(cols);
    const hits = [];
    for (const { col, forms } of searchForms) {
        for (const form of forms) {
            form.re.lastIndex = 0;
            let m;
            while ((m = form.re.exec(text)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                const before = text.slice(Math.max(0, start - 6), start);
                const after = text.slice(end, end + 4);
                const isBy = BY_SUFFIX_KO_RE.test(after) || BY_PREFIX_EN_RE.test(before);
                hits.push({ col, start, end, len: m[0].length, priority: form.priority, isBy, raw: m[0] });
            }
        }
    }
    // Prefer longer span, then higher form priority, then earlier index.
    hits.sort((a, b) => b.len - a.len || b.priority - a.priority || a.start - b.start);
    const chosen = [];
    for (const hit of hits) {
        if (chosen.some(c => hit.start < c.end && hit.end > c.start)) continue;
        chosen.push(hit);
    }
    chosen.sort((a, b) => a.start - b.start);
    const byCol = new Map();
    for (const hit of chosen) {
        const prev = byCol.get(hit.col.name);
        if (!prev) byCol.set(hit.col.name, { col: hit.col, start: hit.start, end: hit.end, isBy: hit.isBy, raw: hit.raw });
        else if (hit.isBy) prev.isBy = true;
    }
    return [...byCol.values()];
}

function mapComboKind(word) {
    if (COMBO_KIND_BAR_RE.test(word)) return 'bar';
    if (COMBO_KIND_AREA_RE.test(word)) return 'area';
    return 'line';
}

function parseComboKinds(request, cols) {
    const numericCols = cols.filter(c => c.role === 'numeric');
    if (numericCols.length < 2) return null;
    const assigned = [];
    const seen = new Set();
    const recordClause = (segment, kindWord) => {
        const kind = mapComboKind(kindWord);
        const mentioned = findMentionedColumns(segment, numericCols);
        for (const item of mentioned) {
            if (seen.has(item.col.name)) continue;
            seen.add(item.col.name);
            assigned.push({ column: item.col.name, kind });
        }
    };
    COMBO_CLAUSE_KO_RE.lastIndex = 0;
    let m;
    while ((m = COMBO_CLAUSE_KO_RE.exec(request)) !== null) {
        recordClause(m[1], m[2]);
    }
    if (assigned.length < 2) {
        COMBO_CLAUSE_EN_AS_RE.lastIndex = 0;
        while ((m = COMBO_CLAUSE_EN_AS_RE.exec(request)) !== null) {
            recordClause(m[1], m[2]);
        }
    }
    if (assigned.length < 2) {
        COMBO_CLAUSE_EN_FOR_RE.lastIndex = 0;
        while ((m = COMBO_CLAUSE_EN_FOR_RE.exec(request)) !== null) {
            recordClause(m[2], m[1]);
        }
    }
    if (assigned.length >= 2 && new Set(assigned.map(a => a.kind)).size >= 2) {
        return assigned;
    }
    return null;
}

function parseShapeHint(request, cols) {
    for (const [re, topic] of UNSUPPORTED_SHAPES) {
        const m = request.match(re);
        if (m) return { unsupported: { matched: m[0], topic } };
    }
    const comboSeries = parseComboKinds(request, cols);
    if (comboSeries) {
        return {
            shape: {
                type: 'combo',
                comboSeries,
                defaultGoal: 'compare',
                periodGoal: 'trend',
                matched: 'combo'
            }
        };
    }
    for (const spec of SUPPORTED_SHAPES) {
        const m = request.match(spec.re);
        if (m) {
            return {
                shape: {
                    type: spec.type,
                    stacked: Boolean(spec.stacked),
                    gauge: Boolean(spec.gauge),
                    defaultGoal: spec.defaultGoal,
                    periodGoal: spec.periodGoal ?? spec.defaultGoal,
                    matched: m[0]
                }
            };
        }
    }
    return {};
}

function parsePeriodRangeFilter(request, periodCols) {
    if (!periodCols.length) return { filter: [], maskedRequest: request, usedCols: new Set() };
    const filter = [];
    const usedCols = new Set();
    let masked = request;
    const maskSpan = (start, length) => {
        masked = masked.slice(0, start) + ' '.repeat(length) + masked.slice(start + length);
    };
    const monthCol = periodCols.find(c => c.period?.unit === 'M');
    const dayCol = periodCols.find(c => c.period?.unit === 'D');
    const yearCol = periodCols.find(c => c.period?.unit === 'Y');

    const pickValue = (col, key, fallback) => col.period?.keyToRaws.get(key)?.[0] ?? fallback;

    PERIOD_RANGE_KO_YM_RE.lastIndex = 0;
    let m;
    while ((m = PERIOD_RANGE_KO_YM_RE.exec(request)) !== null) {
        const y = m[1], m1 = Number(m[2]), m2 = Number(m[3]);
        if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12 || m1 > m2) continue;
        const p1 = String(m1).padStart(2, '0'), p2 = String(m2).padStart(2, '0');
        const col = monthCol || dayCol;
        if (!col) continue;
        const startVal = col.period.unit === 'M' ? pickValue(col, `M${y}-${p1}`, `${y}-${p1}`) : `${y}-${p1}-01`;
        const endVal = col.period.unit === 'M' ? pickValue(col, `M${y}-${p2}`, `${y}-${p2}`) : `${y}-${p2}-31`;
        filter.push({ column: col.name, op: 'gte', value: startVal }, { column: col.name, op: 'lte', value: endVal });
        usedCols.add(col.name);
        maskSpan(m.index, m[0].length);
    }

    PERIOD_RANGE_ISO_YM_RE.lastIndex = 0;
    while ((m = PERIOD_RANGE_ISO_YM_RE.exec(masked)) !== null) {
        const y1 = m[1], m1 = Number(m[2]), y2 = m[3], m2 = Number(m[4]);
        if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) continue;
        const col = monthCol || dayCol;
        if (!col || usedCols.has(col.name)) continue;
        const p1 = String(m1).padStart(2, '0'), p2 = String(m2).padStart(2, '0');
        const startVal = col.period.unit === 'M' ? pickValue(col, `M${y1}-${p1}`, `${y1}-${p1}`) : `${y1}-${p1}-01`;
        const endVal = col.period.unit === 'M' ? pickValue(col, `M${y2}-${p2}`, `${y2}-${p2}`) : `${y2}-${p2}-31`;
        filter.push({ column: col.name, op: 'gte', value: startVal }, { column: col.name, op: 'lte', value: endVal });
        usedCols.add(col.name);
        maskSpan(m.index, m[0].length);
    }

    PERIOD_SINCE_RE.lastIndex = 0;
    while ((m = PERIOD_SINCE_RE.exec(masked)) !== null) {
        const y = m[1] || m[2];
        const col = monthCol || yearCol || dayCol;
        if (!col || usedCols.has(col.name)) continue;
        const startVal = col.period.unit === 'Y'
            ? pickValue(col, `Y${y}`, y)
            : col.period.unit === 'M'
                ? pickValue(col, `M${y}-01`, `${y}-01`)
                : `${y}-01-01`;
        filter.push({ column: col.name, op: 'gte', value: startVal });
        usedCols.add(col.name);
        maskSpan(m.index, m[0].length);
    }

    return { filter, maskedRequest: masked, usedCols };
}

function extractPeriodTokens(request) {
    const found = [];
    PERIOD_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = PERIOD_TOKEN_RE.exec(request)) !== null) {
        const raw = m[2];
        const key = periodKey(raw, { compact: false, weeks: true });
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

function parseValueMentionFilters(request, cols, { excludeCols, periodTokens, skipPeriodCols, existingFilterCols }) {
    const filter = [];
    const colNameSet = new Set(cols.flatMap(c => [c.name, columnHead(c.name)]));
    // Mask period tokens and their immediate unit+particle suffix (e.g. "2026-W45 주의") so "주의" is not matched as a category value.
    let catRequest = request;
    for (const tok of periodTokens) {
        const tailMatch = request.slice(tok.end).match(PERIOD_FOLLOW_UNIT_RE);
        const spanEnd = tok.end + (tailMatch ? tailMatch[0].length : 0);
        catRequest = catRequest.slice(0, tok.start) + ' '.repeat(spanEnd - tok.start) + catRequest.slice(spanEnd);
    }

    // 1. Single period token matching a period column value (when not comparing two periods).
    if (!skipPeriodCols && periodTokens.length === 1) {
        const tok = periodTokens[0];
        const matchedPeriodCols = cols.filter(c => c.role === 'period' && !excludeCols.has(c.name) && !existingFilterCols.has(c.name) && c.period?.keyToRaws.has(tok.key));
        if (matchedPeriodCols.length === 1) {
            const pCol = matchedPeriodCols[0];
            filter.push({ column: pCol.name, op: 'eq', value: pCol.period.keyToRaws.get(tok.key)[0] });
        }
    }

    // 2. Category column value exact mention (exactly one distinct value mentioned in that column).
    for (const col of cols) {
        if (col.role !== 'category') continue;
        if (excludeCols.has(col.name) || existingFilterCols.has(col.name)) continue;
        const hits = [];
        for (const val of col.distinctValues) {
            if (!val || [...val].length < 2) continue;
            if (colNameSet.has(val)) continue;
            const isAscii = /^[A-Za-z0-9_.-]+$/.test(val);
            const escaped = escapeRegExp(val);
            const re = isAscii
                ? new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`)
                : new RegExp(`${KO_CHAR_LOOKBEHIND}${escaped}`);
            const m = catRequest.match(re);
            if (!m) continue;
            if (!isAscii) {
                const after = catRequest.slice(m.index + m[0].length);
                if (!KO_VALUE_BOUNDARY_RE.test(after)) continue;
            }
            hits.push(val);
            if (hits.length > 1) break;
        }
        if (hits.length === 1) {
            filter.push({ column: col.name, op: 'eq', value: hits[0] });
        }
    }
    return filter;
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
            const pEnFrom = new RegExp(`\\bfrom\\s+${x}(?![A-Za-z0-9])\\s+to\\s+${y}(?![A-Za-z0-9])`, 'i');
            if (pEnFrom.test(clause)) return { base: xTok, target: yTok };
            const pEnCmp = new RegExp(`(?<![A-Za-z0-9])${y}(?![A-Za-z0-9])[^,.;!?]*?\\b(?:compared\\s+(?:with|to)|against|relative\\s+to)\\s+${x}(?![A-Za-z0-9])`, 'i');
            if (pEnCmp.test(clause)) return { base: xTok, target: yTok };
            const pEnBase = new RegExp(`(?:\\b(?:with|using)\\s+)?(?<![A-Za-z0-9])${x}\\s+as\\s+(?:the\\s+)?(?:baseline|base)\\b`, 'i');
            const pHasY = new RegExp(`(?<![A-Za-z0-9])${y}(?![A-Za-z0-9])`, 'i');
            if (pEnBase.test(clause) && pHasY.test(clause)) return { base: xTok, target: yTok };
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
    let rankOrder = null;
    const emptyExtras = {
        shapeHint: null,
        unsupportedShape: null,
        rankOrder: null,
        mentionedCols: [],
        inferredFilter: [],
        countRequest: false,
        inferredStyle: 'report',
        inferredRangeSlider: false,
        inferredPointLabels: false
    };

    if (!request) {
        return { readFromRequest: [], confirm, cautions, rankOverride, entries, ...emptyExtras };
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
            entries,
            ...emptyExtras
        };
    }

    // 1. Period range filter + Period parsing (S4 + S4' + R2).
    const periodCols = cols.filter(c => c.role === 'period');
    const rangeParsed = parsePeriodRangeFilter(request, periodCols);
    const { unique: periodTokens } = extractPeriodTokens(rangeParsed.maskedRequest);
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
                    const hasDir = DIRECTION_WORD_RE.test(request.replace(PRIOR_PERIOD_COMPARE_RE, ' '));
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

    // 2. Highlight & R3 rank-only parsing + H10 order words.
    const hasListOrTable = LIST_OR_TABLE_RE.test(request);
    const hasHighlightWord = HIGHLIGHT_WORD_RE.test(request);
    const hasDisplayWord = DISPLAY_WORD_RE.test(request);
    const koDeltaMatch = request.match(DELTA_HIGHLIGHT_RE);
    let deltaInfo = koDeltaMatch
        ? { raw: koDeltaMatch[0], index: koDeltaMatch.index, end: koDeltaMatch.index + koDeltaMatch[0].length, n: parseQuantity(koDeltaMatch[2]), kind: /^감소$/.test(koDeltaMatch[1]) ? 'decrease' : 'increase' }
        : null;
    if (!deltaInfo) {
        for (const re of EN_DELTA_RES) {
            const m = request.match(re);
            if (m) {
                deltaInfo = { raw: m[0], index: m.index, end: m.index + m[0].length, n: parseQuantity(m[1]), kind: EN_DEC_WORD_RE.test(m[2]) ? 'decrease' : 'increase' };
                break;
            }
        }
    }
    let qtyInfo = null;
    if (!deltaInfo) {
        const m = request.match(RANK_QTY_RE);
        if (m) {
            qtyInfo = { raw: m[0], index: m.index, end: m.index + m[0].length, dirWord: (m[1] || m[3]).toLowerCase(), n: parseQuantity(m[2] || m[4]) };
        } else {
            const m2 = request.match(EN_RANK_NUM_FIRST_RE);
            if (m2) qtyInfo = { raw: m2[0], index: m2.index, end: m2.index + m2[0].length, dirWord: m2[2].toLowerCase(), n: parseQuantity(m2[1]) };
        }
    }

    if (!overridden.highlight) {
        if (deltaInfo) {
            const { raw, index, end, n, kind } = deltaInfo;
            const after = request.slice(end);
            const hasMan = /^\s*(?:곳|개소|개|명|건|부서|기관|항목|품목)?\s*만/.test(after) || hasOnlyBefore(request, index);
            if (n !== null) {
                if (n < 1 || n > 50 || hasListOrTable || (hasHighlightWord && hasMan)) {
                    entries.highlight.status = 'ambiguous';
                    entries.highlight.matched = [raw];
                    confirm.push({ field: 'highlight', candidates: [] });
                } else if (hasHighlightWord) {
                    entries.highlight.status = 'applied';
                    entries.highlight.matched = [raw];
                    entries.highlight.value = { kind, count: n };
                }
            }
        } else if (qtyInfo) {
            const { raw, index, end, dirWord, n } = qtyInfo;
            const after = request.slice(end);
            const hasMan = /^\s*(?:곳|개소|개|명|건|부서|기관|항목|품목)?\s*만/.test(after) || hasOnlyBefore(request, index);
            if (n !== null) {
                if (n < 1 || n > 50 || hasListOrTable || (hasHighlightWord && hasMan)) {
                    entries.highlight.status = 'ambiguous';
                    entries.highlight.matched = [raw];
                    confirm.push({ field: 'highlight', candidates: [] });
                } else if (hasMan && hasDisplayWord && !hasHighlightWord && /^(?:상위|하위|top|bottom|highest|lowest|largest|smallest|biggest)$/.test(dirWord)) {
                    rankOverride = { top: n, order: /^(?:하위|bottom|lowest|smallest)$/.test(dirWord) ? 'asc' : 'desc', matched: raw };
                } else if (hasHighlightWord) {
                    const isBottom = /^(?:하위|적은|작은|낮은|bottom|lowest|smallest)$/.test(dirWord);
                    entries.highlight.status = 'applied';
                    entries.highlight.matched = [raw];
                    entries.highlight.value = isBottom ? { bottom: n } : { top: n };
                }
            }
        }
    }

    // H10: Superlative quantity ("가장 적은 5개", "5 smallest") and order phrases ("많은 순", "largest first").
    if (!deltaInfo && !hasListOrTable && !hasHighlightWord) {
        if (!rankOverride) {
            const supKo = request.match(KO_SUPERLATIVE_QTY_RE);
            if (supKo) {
                const n = parseQuantity(supKo[2]);
                if (n !== null && n >= 1 && n <= 50) {
                    const isAsc = /^(?:적은|작은|낮은)$/.test(supKo[1]);
                    rankOverride = { top: n, order: isAsc ? 'asc' : 'desc', matched: supKo[0] };
                }
            } else if (qtyInfo && qtyInfo.n !== null && qtyInfo.n >= 1 && qtyInfo.n <= 50 && /^(?:bottom|lowest|smallest|highest|largest|biggest)$/.test(qtyInfo.dirWord)) {
                const isAsc = /^(?:bottom|lowest|smallest)$/.test(qtyInfo.dirWord);
                rankOverride = { top: qtyInfo.n, order: isAsc ? 'asc' : 'desc', matched: qtyInfo.raw };
            }
        }
        const descMatch = request.match(RANK_ORDER_DESC_RE);
        const ascMatch = request.match(RANK_ORDER_ASC_RE);
        if (ascMatch && !descMatch) {
            rankOrder = { order: 'asc', matched: ascMatch[0] };
        } else if (descMatch && !ascMatch) {
            rankOrder = { order: 'desc', matched: descMatch[0] };
        }
    }

    // 3. H10: Shape, style, options, columns, and count inference.
    const { shape: shapeHint = null, unsupported: unsupportedShape = null } = parseShapeHint(request, cols);
    const mentionedCols = findMentionedColumns(request, cols);
    const mentionedNumeric = mentionedCols.filter(m => m.col.role === 'numeric');
    const mentionedCategory = mentionedCols.filter(m => m.col.role === 'category');
    const inferredStyle = PRINT_STYLE_RE.test(request) ? 'print' : SLIDES_STYLE_RE.test(request) ? 'slides' : 'report';
    const inferredRangeSlider = RANGE_SLIDER_RE.test(request);
    const inferredPointLabels = POINT_LABEL_RE.test(request);
    const hasByCategory = mentionedCategory.some(m => m.isBy) || (mentionedCategory.length > 0 && /(?:별\b|\bby\b)/i.test(request));
    const countRequest = !args.values?.length && mentionedNumeric.length === 0 && COUNT_REQUEST_RE.test(request) && (hasByCategory || cols.some(c => c.role === 'category'));

    // 4. Goal parsing (S4 + S4' + R3 + H10 column masking + H10 shape/order fallback).
    if (!overridden.goal && !unsupportedShape) {
        const hits = matchGoalKeywords(request, cols);
        if (rankOverride) {
            if (!hits.has('rank')) hits.set('rank', [rankOverride.matched]);
            else hits.get('rank').push(rankOverride.matched);
        } else if (rankOrder) {
            if (!hits.has('rank')) hits.set('rank', [rankOrder.matched]);
            else hits.get('rank').push(rankOrder.matched);
        }
        // Infer goal from shape or count only when no explicit goal/rank keyword matched.
        if (hits.size === 0) {
            if (shapeHint) {
                const hasPeriod = periodCols.length > 0 || cols.some(c => c.role === 'category' && periodHeader(c.name) && !c.period?.mixedYear);
                const inferredGoal = hasPeriod && shapeHint.periodGoal ? shapeHint.periodGoal : shapeHint.defaultGoal;
                hits.set(inferredGoal, [shapeHint.matched]);
            } else if (countRequest) {
                hits.set('compare', ['count']);
            }
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
            else if (set.size === 2 && set.has('matrix') && (set.has('trend') || set.has('compare'))) resolved = 'matrix';

            if (resolved) {
                entries.goal.status = 'applied';
                entries.goal.matched = goals.flatMap(g => hits.get(g));
                entries.goal.value = resolved;
            } else {
                entries.goal.status = 'ambiguous';
                entries.goal.matched = goals.flatMap(g => hits.get(g));
                confirm.push({ field: 'goal', candidates: goals });
            }
        }
    }

    // 5. Target value parsing (S4 + S4').
    if (!overridden['target.value']) {
        const valueCol = args.values?.length
            ? cols.find(c => c.name === args.values[0])
            : (mentionedNumeric[0]?.col ?? cols.find(c => c.role === 'numeric'));
        const valueUnit = valueCol?.unit || '';
        TARGET_VALUE_RE.lastIndex = 0;
        TARGET_SUFFIX_RE.lastIndex = 0;
        const matches = [];
        const spans = [];
        let m;
        while ((m = TARGET_VALUE_RE.exec(request)) !== null) {
            const parsed = parseCell(m[1]);
            if (!parsed) continue;
            const after = request.slice(m.index + m[0].length);
            const forbidden = /^\s*(?:이상|이하|초과|미만|곳|개소|기관|개|건|명)/.test(after);
            const allowedEnd = /^(?:$|[\s.,;:!?()[\]{}]|으로|로|에)/.test(after);
            if (!forbidden && !allowedEnd) continue;
            spans.push([m.index, m.index + m[0].length]);
            matches.push({ raw: m[0].trim(), parsed, forbidden });
        }
        while ((m = TARGET_SUFFIX_RE.exec(request)) !== null) {
            const start = m.index, end = start + m[0].length;
            if (spans.some(([s, e]) => start < e && end > s)) continue;
            const parsed = parseCell(m[1]);
            if (!parsed) continue;
            // "the 2026 target" names a period, not a target value: skip bare year-like numbers.
            if (!parsed.unit && /^\s*\d{4}\s*$/.test(m[1]) && parsed.value >= 1900 && parsed.value <= 2100) continue;
            matches.push({ raw: m[0].trim(), parsed, forbidden: false });
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

    // 6. Value mention eq filters (excluding grouping axis columns, range-filtered columns, and compared periods).
    const excludeFilterCols = new Set(rangeParsed.usedCols);
    if (args.label) excludeFilterCols.add(args.label);
    for (const m of mentionedCols) {
        if (m.isBy) excludeFilterCols.add(m.col.name);
    }
    const existingFilterCols = new Set((args.filter ?? []).map(f => f.column));
    const skipPeriodFilter = entries.period.status === 'applied' || entries.period.status === 'ambiguous' || overridden.period;
    const eqFilters = parseValueMentionFilters(rangeParsed.maskedRequest, cols, {
        excludeCols: excludeFilterCols,
        periodTokens,
        skipPeriodCols: skipPeriodFilter,
        existingFilterCols
    });
    const inferredFilter = [...rangeParsed.filter, ...eqFilters];

    return {
        readFromRequest: Object.values(entries),
        confirm,
        cautions,
        rankOverride,
        rankOrder,
        entries,
        shapeHint,
        unsupportedShape,
        mentionedCols,
        inferredFilter,
        countRequest,
        inferredStyle,
        inferredRangeSlider,
        inferredPointLabels
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
        if (goal && goal !== 'change' && goal !== 'compare') fail('period는 change 또는 compare 목적에만 씁니다.', 'period is only for goal change or compare.');
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
    if (unit === '%' || unit === '%p' || unit === 'pp' || unit === '') return 'mean';
    if (ADDITIVE_UNITS.has(unit)) return 'sum';
    return null;
}

function periodLabelsInChronologicalOrder(distinctValues, keyMap) {
    const sorted = [...distinctValues].sort((a, b) => compareNatural(a, b));
    for (let i = 1; i < sorted.length; i++) {
        if (keyMap.get(sorted[i]) <= keyMap.get(sorted[i - 1])) return false;
    }
    return true;
}

function dropSummaryColumns(cols, locale) {
    if (cols.length < 2) return { kept: cols, caution: null };
    const summaryCols = cols.filter(isSummaryColumn);
    const rest = cols.filter(c => !isSummaryColumn(c));
    if (!summaryCols.length || !rest.length) return { kept: cols, caution: null };
    const names = summaryCols.map(c => c.name).join(', ');
    return {
        kept: rest,
        caution: t(locale,
            `합계 열(${names})은 다른 열과 함께 그리지 않도록 제외했습니다.`,
            `Excluded total column(s) (${names}) so they are not plotted alongside component columns.`)
    };
}

function pickSameUnitGroup(numericCols) {
    const byUnit = new Map();
    for (const c of numericCols) {
        if (!byUnit.has(c.unit)) byUnit.set(c.unit, []);
        byUnit.get(c.unit).push(c);
    }
    let best = [];
    for (const group of byUnit.values()) {
        if (group.length > best.length) best = group;
    }
    return best;
}

export function suggestChart(dataset, args = {}, locale = 'ko') {
    const fail = (ko, en) => { throw new Error(t(locale, ko, en)); };

    // Apply optional filter first (S2').
    const selected = selectRows(dataset, args.filter, locale, 'filter');
    const baseFilteredDataset = {
        headers: dataset.headers,
        rows: selected.map(item => item.row),
        ...(dataset.lines ? { lines: selected.map(item => item.line) } : {}),
        ...(dataset.table ? { table: dataset.table } : {})
    };
    const initialCols = baseFilteredDataset.headers.map((_, i) => inspectColumn(baseFilteredDataset, i, { weeks: true }));

    // Validate explicit args (before request parsing for basic shape, then again once goal is known).
    validateExplicitArgs(baseFilteredDataset, args, initialCols, args.goal, locale);

    const parsed = parseRequest(args.request, initialCols, args, locale);
    const goal = args.goal ?? (parsed.entries.goal.status === 'applied' ? parsed.entries.goal.value : null);

    if (goal) {
        validateExplicitArgs(baseFilteredDataset, args, initialCols, goal, locale);
    }

    // Apply inferred filters (from value mention or period range) when valid and within the 4-condition limit.
    let effectiveFilter = args.filter ? [...args.filter] : undefined;
    let filteredDataset = baseFilteredDataset;
    if (parsed.inferredFilter.length && !parsed.confirm.length) {
        const combined = [...(args.filter ?? []), ...parsed.inferredFilter].slice(0, 4);
        const reselected = selectRows(dataset, combined, locale, 'filter');
        if (reselected.length > 0) {
            effectiveFilter = combined;
            filteredDataset = {
                headers: dataset.headers,
                rows: reselected.map(item => item.row),
                ...(dataset.lines ? { lines: reselected.map(item => item.line) } : {}),
                ...(dataset.table ? { table: dataset.table } : {})
            };
        }
    }

    const cols = filteredDataset.headers.map((_, i) => inspectColumn(filteredDataset, i, { weeks: true }));
    const colByName = new Map(cols.map(c => [c.name, c]));

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
    const periodHeaderFallbackCols = cols.filter(c => c.role === 'category' && periodHeader(c.name) && !c.period?.mixedYear);
    const categoryCols = cols.filter(c => c.role === 'category');
    const numericCols = cols.filter(c => c.role === 'numeric');

    const mentionedByRole = (role, byFirst = true) => {
        const items = parsed.mentionedCols
            .map(m => ({ ...m, col: colByName.get(m.col.name) }))
            .filter(m => m.col && m.col.role === role);
        if (byFirst) items.sort((a, b) => Number(b.isBy) - Number(a.isBy) || a.start - b.start);
        return items.map(m => m.col);
    };
    const mentionedPeriodCols = mentionedByRole('period');
    const mentionedCategoryCols = mentionedByRole('category');
    const mentionedNumericCols = mentionedByRole('numeric', false);

    const baseSource = {
        path: args.path || 'data.csv',
        ...(args.table !== undefined ? { table: args.table } : {})
    };
    const rawSource = (extra = {}) => ({
        ...baseSource,
        ...(effectiveFilter ? { filter: effectiveFilter } : {}),
        ...extra
    });
    const analysisSource = (spec) => ({
        ...baseSource,
        analysis: {
            ...spec,
            ...(effectiveFilter ? { filter: effectiveFilter } : {})
        }
    });

    const hasAmbiguous = parsed.confirm.length > 0;
    const shapeHint = parsed.shapeHint;
    const style = parsed.inferredStyle || 'report';
    const wantSlider = parsed.inferredRangeSlider;
    const rowCount = filteredDataset.rows.length;
    const targetValue = args.target_value ?? (parsed.entries['target.value'].status === 'applied' ? parsed.entries['target.value'].value : undefined);
    const reqHighlight = args.highlight ?? (parsed.entries.highlight.status === 'applied' ? parsed.entries.highlight.value : undefined);
    const simpleHighlight = reqHighlight && !reqHighlight.kind ? reqHighlight : undefined;

    const canHighlightType = (type, seriesCount, highlight) => (type === 'bar' || type === 'barh') && (seriesCount === 1 || Boolean(highlight && Object.hasOwn(highlight, 'labels'))) || type === 'combo';
    const attachExtras = (build, type, seriesCount, { includeTarget = true, highlight = simpleHighlight } = {}) => {
        if (includeTarget && targetValue !== undefined && ['line', 'area', 'bar', 'barh', 'combo', 'indicator'].includes(type)) {
            build.target = { value: targetValue, ...(build.series.some(s => s.secondary) ? { series: 0 } : {}) };
        }
        if (highlight && canHighlightType(type, seriesCount, highlight)) {
            if (['below_target', 'above_target'].some(k => Object.hasOwn(highlight, k)) && !build.target) return build;
            build.highlight = highlight;
        }
        return build;
    };

    const resolveColsForGoal = (g, useShape) => {
        const hint = useShape ? shapeHint : null;
        let labelCol = null;
        let valueCols = [];
        let summaryCaution = null;

        if (args.label) {
            labelCol = colByName.get(args.label);
        } else if (g === 'trend') {
            labelCol = mentionedPeriodCols[0] ?? periodCols[0] ?? mentionedCategoryCols.find(c => periodHeader(c.name) && !c.period?.mixedYear) ?? periodHeaderFallbackCols[0] ?? null;
        } else if (g === 'target') {
            labelCol = mentionedCategoryCols[0] ?? mentionedPeriodCols[0] ?? categoryCols[0] ?? periodCols[0] ?? null;
        } else if (g && !['distribution', 'relationship'].includes(g)) {
            labelCol = mentionedCategoryCols[0] ?? categoryCols[0] ?? (hint?.stacked || hint?.type === 'combo' ? (mentionedPeriodCols[0] ?? periodCols[0] ?? null) : null);
        }

        if (args.values) {
            valueCols = args.values.map(name => colByName.get(name));
        } else if (useShape && hint?.comboSeries?.length) {
            valueCols = hint.comboSeries.map(s => colByName.get(s.column)).filter(Boolean);
        } else if (useShape && mentionedNumericCols.length) {
            const dropped = dropSummaryColumns(mentionedNumericCols, locale);
            valueCols = dropped.kept;
            summaryCaution = dropped.caution;
            if (g === 'relationship' && valueCols.length === 1) {
                const extra = numericCols.find(c => c.name !== valueCols[0].name);
                if (extra) valueCols = [valueCols[0], extra];
            }
        } else if (g === 'relationship') {
            valueCols = numericCols.slice(0, 2);
        } else if (g === 'matrix') {
            valueCols = pickSameUnitGroup(numericCols);
        } else if (useShape && hint?.stacked && numericCols.length >= 2) {
            const dropped = dropSummaryColumns(pickSameUnitGroup(numericCols), locale);
            valueCols = dropped.kept.slice(0, 12);
            summaryCaution = dropped.caution;
        } else if (g === 'share' && !labelCol && numericCols.length >= 2) {
            const dropped = dropSummaryColumns(pickSameUnitGroup(numericCols), locale);
            valueCols = dropped.kept.slice(0, 8);
            summaryCaution = dropped.caution;
        } else if (numericCols.length) {
            valueCols = [numericCols[0]];
        }

        return { labelCol, valueCols, summaryCaution };
    };

    const runGoal = (g, { useShape = true, allowThrow = true } = {}) => {
        const localCandidates = [];
        const localNeeds = [];
        const localCautions = [];
        const localNotes = [];
        let localRefCandidates = [];
        const hint = useShape ? shapeHint : null;

        const { labelCol, valueCols: initialValueCols, summaryCaution } = resolveColsForGoal(g, useShape);
        let valueCols = initialValueCols;
        if (summaryCaution) localCautions.push(summaryCaution);
        if (labelCol?.facts.leadingZeros) {
            localCautions.push(t(locale,
                `열 ${labelCol.name}에 앞자리 0이 있어 범주로 분류했습니다.`,
                `Column ${labelCol.name} has leading zeros and was classified as a category.`));
        }
        for (const vc of valueCols) {
            if (vc.missingRows > 0) {
                localCautions.push(t(locale,
                    `열 ${vc.name}에 결측이 ${vc.missingRows}행 있습니다.`,
                    `Column ${vc.name} has ${vc.missingRows} missing row(s).`));
            }
        }

        const addCandidate = (type, why, build, extra = {}) => {
            localCandidates.push({
                type,
                why,
                cautions: [...baseCautions, ...localCautions, ...(extra.cautions ?? [])],
                ...(build ? { build } : {}),
                ...(extra.needs?.length ? { needs: extra.needs } : {})
            });
        };

        const maybeFail = (ko, en) => {
            if (allowThrow) fail(ko, en);
            return null;
        };

        // Explicit combo request with per-series kind ("A는 막대로 ... B는 선으로").
        if (hint?.type === 'combo' && hint.comboSeries?.length && labelCol && valueCols.length >= 2 && rowCount <= 200 && rowCount === labelCol.distinct) {
            const units = [...new Set(valueCols.map(c => c.unit))];
            const secondUnit = units.length === 2 ? units[1] : null;
            const series = hint.comboSeries.map(s => {
                const vc = colByName.get(s.column);
                return {
                    column: s.column,
                    kind: s.kind,
                    ...(secondUnit !== null && vc?.unit === secondUnit ? { secondary: true } : {})
                };
            });
            addCandidate('combo', t(locale, '요청한 계열별 형태(막대·선)로 복합 차트를 그립니다.', 'Combines the requested series as bars and lines in a combo chart.'), attachExtras({
                type: 'combo',
                source: rawSource({ labels: labelCol.name }),
                series,
                ...(wantSlider || (labelCol.role === 'period' && labelCol.distinct > 24) ? { range_slider: true } : {}),
                style
            }, 'combo', series.length));
            return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
        }

        // Explicit gauge indicator request.
        if (hint?.type === 'indicator' && valueCols.length) {
            const vc = valueCols[0];
            const fn = aggregateFunctionForUnit(vc.unit) ?? 'mean';
            const build = attachExtras({
                type: 'indicator',
                source: analysisSource({ type: 'summary', columns: [vc.name], function: fn }),
                series: [{ column: 'value' }],
                ...(hint.gauge ? { gauge: true } : {}),
                style
            }, 'indicator', 1);
            addCandidate('indicator', t(locale, `${vc.name}의 요약 지표를 게이지로 보여줍니다.`, `Shows the summary indicator for ${vc.name} as a gauge.`), build);
            return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
        }

        // "~별 ... 수/개수/건수" + category column + no numeric column named -> aggregate count candidate.
        if (useShape && parsed.countRequest && labelCol && (g === 'compare' || g === 'rank' || g === 'share')) {
            const maxLen = Math.max(0, ...labelCol.distinctValues.map(v => [...v].length));
            const shortCats = labelCol.distinct <= 7 && maxLen <= 8;
            const sort = parsed.rankOverride?.order ?? parsed.rankOrder?.order ?? 'desc';
            const limit = args.top ?? parsed.rankOverride?.top;
            const preferred = hint?.type && ['bar', 'barh', 'donut', 'pie'].includes(hint.type) ? hint.type : (g === 'rank' ? 'barh' : (shortCats ? 'bar' : 'barh'));
            const spec = {
                type: 'aggregate',
                columns: [labelCol.name],
                function: 'count',
                sort,
                ...(limit ? { limit } : labelCol.distinct > 60 ? { limit: Math.min(labelCol.distinct, 100) } : {})
            };
            const build = attachExtras({
                type: preferred,
                source: analysisSource(spec),
                series: [{ column: 'value' }],
                style
            }, preferred, 1);
            addCandidate(preferred, t(locale, `${labelCol.name}별 건수를 집계(count)해 보여줍니다.`, `Shows row counts grouped by ${labelCol.name}.`), build);
            return { labelCol, valueCols: [], candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
        }

        if (g === 'trend') {
            if (!labelCol) {
                if (mixedYearCols.length) {
                    localCautions.push(t(locale,
                        `기간 열 ${mixedYearCols[0].name}에 연도가 있는 값과 없는 값이 섞여 있어 자동 후보에서 뺐습니다.`,
                        `Period column ${mixedYearCols[0].name} mixes values with and without a year and was excluded from automatic candidates.`));
                }
                localNeeds.push('label');
            } else if (!valueCols.length) {
                localNeeds.push('values');
            } else if (labelCol.period?.mixedNotation) {
                const [a, b] = labelCol.period.mixedNotation;
                localCautions.push(t(locale,
                    `같은 기간이 다른 표기로 적혀 있습니다(${a}, ${b}). 자료 표기를 맞추세요.`,
                    `The same period is written in different formats (${a}, ${b}). Standardize the notation.`));
            } else {
                const hasDuplicates = rowCount > labelCol.distinct;
                if (hasDuplicates) {
                    if (valueCols.length > 1) {
                        localCautions.push(t(locale,
                            '기간이 중복된 자료는 단일 값 열만 자동 집계할 수 있습니다. values를 1개로 지정하거나 filter로 줄이세요.',
                            'Repeated periods can only be aggregated for one value column. Specify a single value column or filter rows.'));
                    } else if (labelCol.distinct > 100) {
                        localCautions.push(t(locale,
                            `고유 기간이 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다. filter로 범위를 줄이세요.`,
                            `${labelCol.distinct} distinct periods exceed the analysis.limit maximum (100). Filter the range.`));
                    } else {
                        const fn = aggregateFunctionForUnit(valueCols[0].unit);
                        if (!fn) {
                            localNeeds.push('function');
                            localCautions.push(t(locale,
                                `열 ${valueCols[0].name}(${valueCols[0].unit})의 집계 방식(sum/mean)을 자동으로 정할 수 없습니다.`,
                                `Cannot infer aggregate function (sum/mean) for column ${valueCols[0].name} (${valueCols[0].unit}).`));
                        } else if (labelCol.period && !periodLabelsInChronologicalOrder(labelCol.distinctValues, labelCol.period.keyMap)) {
                            localCautions.push(t(locale,
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
                                ...(wantSlider || (type === 'line' && labelCol.distinct > 24) ? { range_slider: true } : {}),
                                style
                            }, type, 1);
                            if (hint?.type === 'area') {
                                addCandidate('area', areaWhy(locale, false), makeBuild('area'));
                            } else if (hint?.type === 'bar' || (!hint?.type && labelCol.distinct < 4 && !wantSlider)) {
                                addCandidate('bar', t(locale, `기간이 ${labelCol.distinct}개로 적어 막대가 읽기 쉽습니다.`, `With only ${labelCol.distinct} periods, bars are easy to compare.`), makeBuild('bar'));
                                addCandidate('line', t(locale, '기간 흐름을 선으로 연결합니다.', 'Connects the periods as a line.'), makeBuild('line'));
                            } else {
                                addCandidate('line', t(locale, `기간 ${labelCol.distinct}개를 집계(${fn})해 추이를 선으로 보여줍니다.`, `Aggregates (${fn}) ${labelCol.distinct} periods as a line trend.`), makeBuild('line'));
                                addCandidate('bar', t(locale, '기간별 집계 크기를 막대로 비교합니다.', 'Compares aggregated period values as bars.'), makeBuild('bar'));
                            }
                        }
                    }
                } else if (rowCount > 200) {
                    localCautions.push(t(locale,
                        `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                        `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                    localNeeds.push('filter');
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
                            ...(wantSlider || labelCol.distinct > 24 ? { range_slider: true } : {}),
                            style
                        }, 'combo', 2), { cautions: [unitCaution] });
                    } else {
                        const series = valueCols.map(c => ({ column: c.name }));
                        const makeBuild = (type, stacked = false) => attachExtras({
                            type,
                            source: rawSource({ labels: labelCol.name }),
                            series,
                            ...(stacked && (type === 'area' || series.length >= 2) ? { stacked: true } : {}),
                            ...(wantSlider || (type === 'line' && labelCol.distinct > 24) ? { range_slider: true } : {}),
                            style
                        }, type, series.length);
                        if (hint?.type === 'area') {
                            const stacked = Boolean(hint.stacked);
                            addCandidate('area', areaWhy(locale, stacked), makeBuild('area', stacked));
                            addCandidate('line', t(locale, `기간 ${labelCol.distinct}개의 변화를 선으로 보여줍니다.`, `Shows changes across ${labelCol.distinct} periods as a line.`), makeBuild('line'));
                        } else if (hint?.type === 'bar' || hint?.type === 'barh') {
                            const stacked = Boolean(hint.stacked && series.length >= 2);
                            addCandidate(hint.type, t(locale, '기간별 값을 막대로 비교합니다.', 'Compares period values as bars.'), makeBuild(hint.type, stacked));
                            addCandidate('line', t(locale, `기간 ${labelCol.distinct}개의 변화를 선으로 보여줍니다.`, `Shows changes across ${labelCol.distinct} periods as a line.`), makeBuild('line'));
                        } else if (hint?.type === 'line' || wantSlider || labelCol.distinct >= 4) {
                            addCandidate('line', t(locale, `기간 ${labelCol.distinct}개의 변화를 선으로 보여줍니다.`, `Shows changes across ${labelCol.distinct} periods as a line.`), makeBuild('line'));
                            addCandidate('bar', t(locale, '기간별 값을 막대로 비교합니다.', 'Compares period values as bars.'), makeBuild('bar'));
                        } else {
                            addCandidate('bar', t(locale, `기간이 ${labelCol.distinct}개로 적어 막대가 읽기 쉽습니다.`, `With ${labelCol.distinct} periods, bars are easy to read.`), makeBuild('bar'));
                            addCandidate('line', t(locale, '기간 흐름을 선으로 연결합니다.', 'Connects the periods as a line.'), makeBuild('line'));
                        }
                    }
                }
            }
        } else if (g === 'compare') {
            if (!labelCol) localNeeds.push('label');
            else if (!valueCols.length) localNeeds.push('values');
            else {
                const maxSeries = hint?.stacked ? 12 : 3;
                if (valueCols.length > maxSeries) {
                    if (maybeFail('compare의 values는 최대 3개입니다.', 'compare accepts at most 3 value columns.') === null) {
                        return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
                    }
                }
                if (new Set(valueCols.map(c => c.unit)).size > 1) {
                    if (maybeFail('compare의 값 열들은 같은 단위여야 합니다.', 'compare value columns must share the same unit.') === null) {
                        return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
                    }
                }
                const hasDuplicates = rowCount > labelCol.distinct;
                const maxLen = Math.max(0, ...labelCol.distinctValues.map(v => [...v].length));
                const shortCats = labelCol.distinct <= 7 && maxLen <= 8;
                if (hasDuplicates) {
                    if (valueCols.length > 1) {
                        localCautions.push(t(locale, '중복 범주는 단일 값 열만 자동 집계할 수 있습니다.', 'Repeated categories can only be aggregated for one value column.'));
                    } else if (labelCol.distinct > 100) {
                        localCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
                    } else {
                        const fn = aggregateFunctionForUnit(valueCols[0].unit);
                        if (!fn) {
                            localNeeds.push('function');
                        } else {
                            const comparePeriodCols = periodCols.filter(c => c.name !== labelCol.name);
                            const explicitPeriod = args.period;
                            const parsedPeriod = parsed.entries.period.status === 'applied' ? parsed.entries.period.value : null;
                            const pColName = explicitPeriod?.column ?? parsedPeriod?.column ?? (comparePeriodCols.length === 1 ? comparePeriodCols[0].name : null);
                            const pCol = pColName ? colByName.get(pColName) : null;
                            const pBase = explicitPeriod?.base ?? parsedPeriod?.base;
                            const pTarget = explicitPeriod?.target ?? parsedPeriod?.target;
                            const hasAppliedPeriod = Boolean(comparePeriodCols.length && pCol && pBase && pTarget && !pCol.period?.mixedNotation);
                            if (hasAppliedPeriod) {
                                const compareType = hint?.type === 'barh' ? 'barh' : hint?.type === 'bar' ? 'bar' : (shortCats ? 'bar' : 'barh');
                                const compareSpec = {
                                    type: 'compare',
                                    columns: [labelCol.name, valueCols[0].name],
                                    period: { column: pCol.name, base: pBase, target: pTarget },
                                    function: fn,
                                    ...(labelCol.distinct > 60 ? { limit: labelCol.distinct } : {})
                                };
                                const compareBuild = attachExtras({
                                    type: compareType,
                                    source: analysisSource(compareSpec),
                                    series: [
                                        { column: 'base', name: pBase },
                                        { column: 'target', name: pTarget }
                                    ],
                                    style
                                }, compareType, 2);
                                addCandidate(compareType, t(locale,
                                    `${pBase}·${pTarget} 두 기간을 범주별로 나란히 비교합니다.`,
                                    `Compares ${pBase} and ${pTarget} side by side for each category.`), compareBuild);
                            }
                            const periodCaution = comparePeriodCols.length && !hasAppliedPeriod
                                ? [t(locale,
                                    `기간 열 ${comparePeriodCols[0].name}이 있어 집계가 여러 기간을 합칩니다(${fn}). 기간별로 비교하려면 period를 주세요.`,
                                    `Period column ${comparePeriodCols[0].name} is present, so the aggregate combines periods (${fn}). Pass period to compare periods.`)]
                                : [];
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
                                style
                            }, type, 1);
                            if (hint?.type === 'barh') {
                                addCandidate('barh', t(locale, '값 내림차순 가로 막대로 비교합니다.', 'Compares categories sorted descending horizontally.'), makeBuild('barh', 'desc'), { cautions: periodCaution });
                                addCandidate('bar', t(locale, '세로 막대로 비교합니다.', 'Compares categories vertically.'), makeBuild('bar', 'desc'), { cautions: periodCaution });
                            } else if (hint?.type === 'bar' || shortCats) {
                                addCandidate('bar', t(locale, `범주 ${labelCol.distinct}개를 집계(${fn})해 세로 막대로 비교합니다.`, `Compares ${labelCol.distinct} aggregated (${fn}) categories vertically.`), makeBuild('bar', 'original'), { cautions: periodCaution });
                                addCandidate('barh', t(locale, '값 내림차순 가로 막대로 비교합니다.', 'Compares categories sorted descending horizontally.'), makeBuild('barh', 'desc'), { cautions: periodCaution });
                            } else {
                                addCandidate('barh', t(locale, `범주 ${labelCol.distinct}개(최대 ${maxLen}자)를 값 내림차순 가로 막대로 비교합니다.`, `Horizontal bars fit ${labelCol.distinct} categories (up to ${maxLen} chars).`), makeBuild('barh', 'desc'), { cautions: periodCaution });
                                addCandidate('bar', t(locale, '세로 막대로 비교합니다.', 'Compares categories vertically.'), makeBuild('bar', 'desc'), { cautions: periodCaution });
                            }
                        }
                    }
                } else if (rowCount > 200) {
                    localCautions.push(t(locale,
                        `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                        `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                    localNeeds.push('filter');
                } else {
                    const series = valueCols.map(c => ({ column: c.name }));
                    const stacked = Boolean(hint?.stacked && series.length >= 2);
                    const makeBar = () => attachExtras({ type: 'bar', source: rawSource({ labels: labelCol.name }), series, ...(stacked ? { stacked: true } : {}), style }, 'bar', series.length);
                    const makeBarh = () => attachExtras({ type: 'barh', source: rawSource({ labels: labelCol.name, sort: { column: valueCols[0].name, order: 'desc' } }), series, ...(stacked ? { stacked: true } : {}), style }, 'barh', series.length);
                    if (hint?.type === 'funnel' || hint?.type === 'radar') {
                        addCandidate(hint.type, t(locale, '범주별 값을 비교합니다.', 'Compares values across categories.'), {
                            type: hint.type,
                            source: rawSource({ labels: labelCol.name }),
                            series,
                            style
                        });
                    } else if (hint?.type === 'barh') {
                        addCandidate('barh', t(locale, '값 순으로 정렬한 가로 막대로 비교합니다.', 'Compares values sorted descending as horizontal bars.'), makeBarh());
                        addCandidate('bar', t(locale, '세로 막대로 비교합니다.', 'Compares categories as vertical bars.'), makeBar());
                    } else if (hint?.type === 'bar' || shortCats) {
                        addCandidate('bar', t(locale, `범주 ${labelCol.distinct}개, 이름 길이가 짧아 세로 막대가 읽기 쉽습니다.`, `${labelCol.distinct} short category names fit vertical bars well.`), makeBar());
                        addCandidate('barh', t(locale, '값 순으로 정렬한 가로 막대로 비교합니다.', 'Compares values sorted descending as horizontal bars.'), makeBarh());
                    } else {
                        const catCaution = labelCol.distinct > 7 ? [t(locale, `고유 범주가 ${labelCol.distinct}개입니다.`, `There are ${labelCol.distinct} distinct categories.`)] : [];
                        addCandidate('barh', t(locale, `범주 수(${labelCol.distinct}개)나 이름 길이(${maxLen}자)가 커 가로 막대가 읽기 쉽습니다.`, `Horizontal bars are easier to read for ${labelCol.distinct} categories (max ${maxLen} chars).`), makeBarh(), { cautions: catCaution });
                        addCandidate('bar', t(locale, '세로 막대로 비교합니다.', 'Compares categories as vertical bars.'), makeBar(), { cautions: catCaution });
                    }
                }
            }
        } else if (g === 'rank') {
            if (!labelCol) localNeeds.push('label');
            else if (!valueCols.length) localNeeds.push('values');
            else {
                const top = args.top ?? parsed.rankOverride?.top ?? 10;
                const order = parsed.rankOverride?.order ?? parsed.rankOrder?.order ?? 'desc';
                const chartType = hint?.type === 'bar' ? 'bar' : 'barh';
                const hasDuplicates = rowCount > labelCol.distinct;
                if (rowCount <= 200 && hasDuplicates && labelCol.distinct <= 100) {
                    const fn = aggregateFunctionForUnit(valueCols[0].unit) ?? 'sum';
                    const build = attachExtras({
                        type: chartType,
                        source: analysisSource({
                            type: 'aggregate',
                            columns: [labelCol.name, valueCols[0].name],
                            function: fn,
                            sort: order,
                            limit: top
                        }),
                        series: [{ column: 'value' }],
                        style
                    }, chartType, 1);
                    addCandidate(chartType, t(locale,
                        `${order === 'asc' ? '하위' : '상위'} ${top}개 순위를 집계(${fn})해 가로 막대로 보여줍니다.`,
                        `Shows the ${order === 'asc' ? 'bottom' : 'top'} ${top} aggregated (${fn}) items as ${chartType === 'bar' ? 'bars' : 'horizontal bars'}.`), build);
                } else {
                    const build = attachExtras({
                        type: chartType,
                        source: rawSource({ labels: labelCol.name, sort: { column: valueCols[0].name, order }, limit: top }),
                        series: [{ column: valueCols[0].name }],
                        style
                    }, chartType, 1);
                    addCandidate(chartType, t(locale,
                        `${order === 'asc' ? '하위' : '상위'} ${top}개 순위를 가로 막대로 보여줍니다.`,
                        `Shows the ${order === 'asc' ? 'bottom' : 'top'} ${top} ranked items as ${chartType === 'bar' ? 'bars' : 'horizontal bars'}.`), build);
                }
            }
        } else if (g === 'share') {
            // Wide table share via summary source (no category column, 2-8 same-unit numeric columns).
            const wideSummary = !labelCol && valueCols.length >= 2 && valueCols.length <= 8 && new Set(valueCols.map(c => c.unit)).size <= 1;
            if (wideSummary) {
                const sumSpec = {
                    type: 'summary',
                    columns: valueCols.map(c => c.name),
                    function: 'sum'
                };
                const stats = analyze(filteredDataset, { type: 'summary', columns: sumSpec.columns }, locale);
                const sums = stats.perColumn.map(item => item.statistics.sum ?? 0);
                const allZero = sums.every(v => v === 0);
                const hasNeg = sums.some(v => v < 0);
                if (allZero) {
                    localCautions.push(t(locale, '모든 값이 0이라 구성비를 그릴 수 없습니다.', 'All values are zero; cannot plot share.'));
                } else {
                    const makeBuild = type => ({
                        type,
                        source: analysisSource(sumSpec),
                        series: [{ column: 'value' }],
                        style
                    });
                    const wantedPie = hint?.type === 'pie' ? 'pie' : 'donut';
                    if (hasNeg) {
                        const negCaution = t(locale, '음수가 있어 원형·도넛 차트를 제외하고 가로 막대만 추천합니다.', 'Negative values exclude donut/pie charts; recommending horizontal bars only.');
                        addCandidate('barh', t(locale, '음수가 포함된 구성은 가로 막대로 비교합니다.', 'Horizontal bars handle negative values in comparisons.'), makeBuild('barh'), { cautions: [negCaution] });
                    } else if (valueCols.length <= 5 || hint?.type === 'donut' || hint?.type === 'pie') {
                        const crowdCaution = valueCols.length > 5
                            ? [crowdedPieCaution(locale, valueCols.length)]
                            : [];
                        addCandidate(wantedPie, t(locale, `선택한 ${valueCols.length}개 열의 합계 비중을 ${wantedPie} 차트로 보여줍니다.`, `Shows the summed share across ${valueCols.length} columns as a ${wantedPie} chart.`), makeBuild(wantedPie), { cautions: crowdCaution });
                        addCandidate('barh', t(locale, '정확한 크기 비교는 가로 막대가 유리합니다.', 'Horizontal bars allow precise magnitude comparison.'), makeBuild('barh'));
                    } else {
                        const manyCaution = t(locale, `고유 범주가 ${valueCols.length}개라 원형 대신 가로 막대만 추천합니다.`, `${valueCols.length} categories exceed 5; recommending horizontal bars instead of donut.`);
                        addCandidate('barh', t(locale, `범주가 ${valueCols.length}개로 많아 정렬된 가로 막대로 비중을 비교합니다.`, `Sorted horizontal bars compare ${valueCols.length} categories clearly.`), makeBuild('barh'), { cautions: [manyCaution] });
                    }
                }
            } else if (!labelCol) localNeeds.push('label');
            else if (!valueCols.length) localNeeds.push('values');
            else {
                const vc = valueCols[0];
                const hasDuplicates = rowCount > labelCol.distinct;
                let useAnalysis = false;
                let checkValues = vc.facts.parsed.filter(v => v !== null);
                let spec = null;
                if (hasDuplicates) {
                    if (labelCol.distinct > 100) {
                        localCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
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
                        checkValues = agg.groups.map(gr => gr.value).filter(v => v !== null);
                    }
                } else if (rowCount > 200) {
                    localCautions.push(t(locale,
                        `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                        `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                    localNeeds.push('filter');
                }

                if (!localNeeds.length && !(hasDuplicates && labelCol.distinct > 100)) {
                    const allZero = !checkValues.length || checkValues.every(v => v === 0);
                    const hasNeg = checkValues.some(v => v < 0);
                    if (allZero) {
                        localCautions.push(t(locale, '모든 값이 0이라 구성비를 그릴 수 없습니다.', 'All values are zero; cannot plot share.'));
                    } else {
                        const makeBuild = type => ({
                            type,
                            source: useAnalysis ? analysisSource(spec) : rawSource({ labels: labelCol.name, ...(type === 'barh' ? { sort: { column: vc.name, order: 'desc' } } : {}) }),
                            series: [{ column: useAnalysis ? 'value' : vc.name }],
                            style
                        });
                        const wantedPie = hint?.type === 'pie' ? 'pie' : 'donut';
                        if (hasNeg) {
                            const negCaution = t(locale, '음수가 있어 원형·도넛 차트를 제외하고 가로 막대만 추천합니다.', 'Negative values exclude donut/pie charts; recommending horizontal bars only.');
                            addCandidate('barh', t(locale, '음수가 포함된 구성은 가로 막대로 비교합니다.', 'Horizontal bars handle negative values in comparisons.'), makeBuild('barh'), { cautions: [negCaution] });
                        } else if (labelCol.distinct <= 5 || hint?.type === 'donut' || hint?.type === 'pie') {
                            const crowdCaution = labelCol.distinct > 5
                                ? [crowdedPieCaution(locale, labelCol.distinct)]
                                : [];
                            addCandidate(wantedPie, t(locale, `범주가 ${labelCol.distinct}개로 적어 도넛 차트로 비중을 한눈에 봅니다.`, `${labelCol.distinct} categories fit a ${wantedPie} chart cleanly.`), makeBuild(wantedPie), { cautions: crowdCaution });
                            addCandidate('barh', t(locale, '정확한 크기 비교는 가로 막대가 유리합니다.', 'Horizontal bars allow precise magnitude comparison.'), makeBuild('barh'));
                        } else {
                            const manyCaution = t(locale, `고유 범주가 ${labelCol.distinct}개라 원형 대신 가로 막대만 추천합니다.`, `${labelCol.distinct} categories exceed 5; recommending horizontal bars instead of donut.`);
                            addCandidate('barh', t(locale, `범주가 ${labelCol.distinct}개로 많아 정렬된 가로 막대로 비중을 비교합니다.`, `Sorted horizontal bars compare ${labelCol.distinct} categories clearly.`), makeBuild('barh'), { cautions: [manyCaution] });
                        }
                    }
                }
            }
        } else if (g === 'distribution') {
            if (!valueCols.length) localNeeds.push('values');
            else if (rowCount > 200) {
                localCautions.push(t(locale,
                    `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                    `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                localNeeds.push('filter');
            } else {
                const vc = valueCols[0];
                const validCount = vc.facts.parsed.filter(v => v !== null).length;
                if (validCount === 0) {
                    localCautions.push(`Column ${vc.name} has no valid values.`);
                } else {
                    const makeBuild = type => ({ type, source: rawSource(), series: [{ column: vc.name }], style });
                    if (hint?.type === 'box' || hint?.type === 'violin') {
                        addCandidate(hint.type, t(locale, '중앙값·사분위·이상치를 상자 그림으로 요약합니다.', `Summarizes median, quartiles and outliers in a ${hint.type} plot.`), makeBuild(hint.type));
                        if (validCount >= 20) addCandidate('histogram', t(locale, `유효 관측치가 ${validCount}개라 히스토그램으로 분포 모양을 봅니다.`, `${validCount} valid observations suit a histogram.`), makeBuild('histogram'));
                    } else if (validCount >= 20 || hint?.type === 'histogram') {
                        const fewCaution = validCount < 20
                            ? [t(locale, `유효 관측치가 ${validCount}개로 적어 구간 모양이 거칠 수 있습니다.`, `Only ${validCount} valid observations; histogram bins may look coarse.`)]
                            : [];
                        addCandidate('histogram', t(locale, `유효 관측치가 ${validCount}개라 히스토그램으로 분포 모양을 봅니다.`, `${validCount} valid observations suit a histogram.`), makeBuild('histogram'), { cautions: fewCaution });
                        addCandidate('box', t(locale, '중앙값·사분위·이상치를 상자 그림으로 요약합니다.', 'Summarizes median, quartiles and outliers in a box plot.'), makeBuild('box'));
                    } else {
                        addCandidate('box', t(locale, `유효 관측치가 ${validCount}개로 적어 상자 그림을 추천합니다.`, `With fewer than 20 observations (${validCount}), a box plot is clearer.`), makeBuild('box'));
                    }
                }
            }
        } else if (g === 'relationship') {
            if (valueCols.length < 2) {
                localNeeds.push('values');
            } else if (valueCols.length > 3) {
                if (maybeFail('relationship의 values는 2~3개여야 합니다.', 'relationship requires 2 or 3 value columns.') === null) {
                    return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
                }
            } else if (rowCount > 200) {
                localCautions.push(t(locale,
                    `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                    `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                localNeeds.push('filter');
            } else {
                const [xCol, yCol, sizeCol] = valueCols;
                const pointLabelCol = useShape && (parsed.inferredPointLabels || mentionedCategoryCols.length > 0)
                    ? (mentionedCategoryCols[0] ?? categoryCols[0] ?? null)
                    : null;
                const pointExtra = pointLabelCol ? { x: xCol.name, labels: pointLabelCol.name } : { x: xCol.name };
                if (sizeCol) {
                    const hasNegSize = sizeCol.facts.parsed.some(v => v !== null && v < 0);
                    if (hasNegSize) {
                        const negCaution = t(locale,
                            `크기 열 ${sizeCol.name}에 음수가 있어 bubble을 제외하고 scatter만 추천합니다.`,
                            `Size column ${sizeCol.name} has negative values; excluding bubble and recommending scatter only.`);
                        addCandidate('scatter', t(locale, `${xCol.name}과 ${yCol.name}의 관계를 산점도로 보여줍니다.`, `Plots the relationship between ${xCol.name} and ${yCol.name}.`), {
                            type: 'scatter',
                            source: rawSource(pointExtra),
                            series: [{ column: yCol.name }],
                            style
                        }, { cautions: [negCaution] });
                    } else {
                        addCandidate('bubble', t(locale, `${xCol.name}·${yCol.name} 관계와 ${sizeCol.name} 크기를 버블 차트로 보여줍니다.`, `Shows ${xCol.name} vs ${yCol.name} with bubble size ${sizeCol.name}.`), {
                            type: 'bubble',
                            source: rawSource(pointExtra),
                            series: [{ column: yCol.name, sizeColumn: sizeCol.name }],
                            style
                        });
                    }
                } else {
                    addCandidate('scatter', t(locale, `${xCol.name}과 ${yCol.name}의 관계를 산점도로 보여줍니다.`, `Shows the relationship between ${xCol.name} and ${yCol.name}.`), {
                        type: 'scatter',
                        source: rawSource(pointExtra),
                        series: [{ column: yCol.name }],
                        style
                    });
                }
            }
        } else if (g === 'target') {
            if (!labelCol) localNeeds.push('label');
            else if (!valueCols.length) localNeeds.push('values');
            else {
                const vc = valueCols[0];
                const refCol = args.reference ? colByName.get(args.reference) : null;
                if (refCol) {
                    if (vc.unit !== refCol.unit) {
                        if (maybeFail(
                            `값 열 ${vc.name}(${vc.unit || '단위 없음'})과 기준 열 ${refCol.name}(${refCol.unit || '단위 없음'})의 단위가 다릅니다.`,
                            `Value column ${vc.name} (${vc.unit || 'no unit'}) and reference column ${refCol.name} (${refCol.unit || 'no unit'}) have different units.`
                        ) === null) {
                            return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
                        }
                    }
                    const hasDuplicates = rowCount > labelCol.distinct;
                    const compareSpec = {
                        type: 'compare',
                        columns: [labelCol.name, vc.name, refCol.name],
                        ...(labelCol.distinct > 60 ? { limit: labelCol.distinct } : {})
                    };
                    if (hasDuplicates) {
                        if (labelCol.distinct > 100) {
                            localCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
                        } else {
                            addCandidate('combo', t(locale, '집계된 실적(막대)과 기준(선)을 같은 축에 비교합니다.', 'Compares aggregated actuals (bars) against reference (line) on the same axis.'), attachExtras({
                                type: 'combo',
                                source: analysisSource(compareSpec),
                                series: [{ column: 'value', kind: 'bar' }, { column: 'reference', kind: 'line' }],
                                style
                            }, 'combo', 2, { includeTarget: false }));
                            addCandidate('bar', t(locale, '기준 대비 달성률(%)을 목표선 100%와 함께 보여줍니다.', 'Shows achievement ratio (%) with a 100% target line.'), attachExtras({
                                type: 'bar',
                                source: analysisSource(compareSpec),
                                series: [{ column: 'ratio' }],
                                target: { value: 100 },
                                style
                            }, 'bar', 1, { includeTarget: false }));
                        }
                    } else if (rowCount > 200) {
                        localCautions.push(t(locale,
                            `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                            `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                        localNeeds.push('filter');
                    } else {
                        addCandidate('combo', t(locale, `${vc.name}(막대)과 ${refCol.name}(선)을 같은 축에 비교합니다.`, `Compares ${vc.name} (bars) against ${refCol.name} (line).`), attachExtras({
                            type: 'combo',
                            source: rawSource({ labels: labelCol.name }),
                            series: [{ column: vc.name, kind: 'bar' }, { column: refCol.name, kind: 'line' }],
                            style
                        }, 'combo', 2, { includeTarget: false }));
                        if (labelCol.distinct <= 100) {
                            addCandidate('bar', t(locale, '기준 대비 비율(%)을 100% 목표선과 함께 보여줍니다.', 'Shows ratio to reference (%) with a 100% target line.'), attachExtras({
                                type: 'bar',
                                source: analysisSource(compareSpec),
                                series: [{ column: 'ratio' }],
                                target: { value: 100 },
                                style
                            }, 'bar', 1, { includeTarget: false }));
                        }
                    }
                } else {
                    if (targetValue === undefined) {
                        localRefCandidates = numericCols
                            .filter(c => c.name !== vc.name && c.name !== labelCol.name && c.unit === vc.unit)
                            .map(c => c.name)
                            .slice(0, 5);
                    }
                    const targetNeeds = targetValue === undefined
                        ? (localRefCandidates.length ? ['target.value', 'reference'] : ['target.value'])
                        : [];
                    const hasDuplicates = rowCount > labelCol.distinct;
                    if (hasDuplicates) {
                        if (labelCol.distinct > 100) {
                            localCautions.push(t(locale, `고유 범주가 ${labelCol.distinct}개라 analysis.limit 한도(100)를 넘습니다.`, `${labelCol.distinct} distinct categories exceed analysis.limit (100).`));
                        } else {
                            const fn = aggregateFunctionForUnit(vc.unit);
                            if (!fn) {
                                localNeeds.push('function');
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
                                    style
                                }, 'bar', 1);
                                addCandidate('bar', t(locale, targetValue !== undefined ? `목표선 ${targetValue} 대비 값을 막대로 비교합니다.` : '목표값과 비교할 막대 차트입니다(target.value 필요).', targetValue !== undefined ? `Compares values against target ${targetValue}.` : 'Bar chart ready for a target line (needs target.value).'), build, targetNeeds.length ? { needs: targetNeeds } : {});
                            }
                        }
                    } else if (rowCount > 200) {
                        localCautions.push(t(locale,
                            `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`,
                            `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`));
                        localNeeds.push('filter');
                    } else {
                        const build = attachExtras({
                            type: 'bar',
                            source: rawSource({ labels: labelCol.name }),
                            series: [{ column: vc.name }],
                            style
                        }, 'bar', 1);
                        addCandidate('bar', t(locale, targetValue !== undefined ? `목표선 ${targetValue} 대비 값을 막대로 비교합니다.` : '목표선과 비교할 막대 차트입니다(target.value 필요).', targetValue !== undefined ? `Compares values against target ${targetValue}.` : 'Bar chart ready for a target line (needs target.value).'), build, targetNeeds.length ? { needs: targetNeeds } : {});
                    }
                }
            }
        } else if (g === 'change') {
            if (!labelCol) localNeeds.push('label');
            else if (!valueCols.length) localNeeds.push('values');
            else {
                const vc = valueCols[0];
                const explicitPeriod = args.period;
                const parsedPeriod = parsed.entries.period.status === 'applied' ? parsed.entries.period.value : null;
                const pColName = explicitPeriod?.column ?? parsedPeriod?.column ?? (periodCols.length === 1 ? periodCols[0].name : null);
                const pCol = pColName ? colByName.get(pColName) : null;

                if (!pCol) {
                    if (mixedYearCols.length) {
                        localCautions.push(t(locale,
                            `기간 열 ${mixedYearCols[0].name}에 연도가 있는 값과 없는 값이 섞여 있어 자동 후보에서 뺐습니다.`,
                            `Period column ${mixedYearCols[0].name} mixes values with and without a year and was excluded from automatic candidates.`));
                    }
                    if (periodCols.length > 1) {
                        localCautions.push(t(locale,
                            `기간 열이 여러 개입니다(${periodCols.map(c => c.name).join(', ')}). period.column을 지정하세요.`,
                            `Multiple period columns found (${periodCols.map(c => c.name).join(', ')}); specify period.column.`));
                    }
                    localNeeds.push('period.column');
                } else if (pCol.period?.mixedNotation) {
                    const [a, b] = pCol.period.mixedNotation;
                    localCautions.push(t(locale,
                        `같은 기간이 다른 표기로 적혀 있습니다(${a}, ${b}). 자료 표기를 맞추세요.`,
                        `The same period is written in different formats (${a}, ${b}). Standardize the notation.`));
                } else {
                    const base = explicitPeriod?.base ?? parsedPeriod?.base;
                    const target = explicitPeriod?.target ?? parsedPeriod?.target;
                    if (!base || !target) {
                        const periodValues = pCol.distinctValues.slice(0, 20);
                        localNotes.push(t(locale,
                            `비교할 두 기간을 지정하세요. 열 ${pCol.name} 고유값: ${periodValues.join(', ')}`,
                            `Specify two periods to compare. Distinct values in ${pCol.name}: ${periodValues.join(', ')}`));
                        const fn = ['%', '%p', 'pp'].includes(vc.unit) ? 'mean' : 'sum';
                        const preferred = (reqHighlight || fn !== 'sum' || ['%', '%p', 'pp'].includes(vc.unit)) ? 'barh' : 'waterfall';
                        addCandidate(preferred, t(locale,
                            `두 기간(${pCol.name})의 증감을 ${preferred}로 비교합니다(base·target 필요).`,
                            `Compares period-over-period change on ${pCol.name} as ${preferred} (needs base and target).`), null, { needs: ['period.base', 'period.target'] });
                    } else {
                        const fn = ['%', '%p', 'pp'].includes(vc.unit) ? 'mean' : 'sum';
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
                                ? displayed.filter(gr => gr.difference !== null && gr.difference < 0).sort((a, b) => a.difference - b.difference || compareText(a.group, b.group))
                                : displayed.filter(gr => gr.difference !== null && gr.difference > 0).sort((a, b) => b.difference - a.difference || compareText(a.group, b.group));
                            const picked = filtered.slice(0, reqHighlight.count).map(gr => gr.group);
                            parsed.entries.highlight.selected = picked.length;
                            if (picked.length > 0) {
                                resolvedHighlight = { labels: picked };
                                parsed.entries.highlight.value = { labels: picked };
                            } else {
                                resolvedHighlight = undefined;
                                parsed.entries.highlight.value = { labels: [] };
                                localNotes.push(t(locale,
                                    `${reqHighlight.kind === 'decrease' ? '감소' : '증가'}한 항목이 없어 강조를 넣지 않았습니다(selected: 0).`,
                                    `No ${reqHighlight.kind === 'decrease' ? 'decreasing' : 'increasing'} items found; highlight omitted (selected: 0).`));
                            }
                        }

                        const canWaterfall = fn === 'sum' && !['%', '%p', 'pp'].includes(vc.unit) && !comp.truncated;
                        const barhBuild = attachExtras({
                            type: 'barh',
                            source: analysisSource(compareSpec),
                            series: [{ column: 'difference' }],
                            style
                        }, 'barh', 1, { highlight: resolvedHighlight });
                        const waterfallBuild = canWaterfall ? {
                            type: 'waterfall',
                            source: analysisSource(compareSpec),
                            series: [{ column: 'difference' }],
                            style
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
        } else if (g === 'matrix') {
            // Check for long-table pivot heatmap first when two axes + one numeric value are present.
            const axisCandidates = [
                ...mentionedPeriodCols,
                ...mentionedCategoryCols
            ].filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i);
            const fallbackAxes = axisCandidates.length >= 2
                ? axisCandidates.slice(0, 2)
                : (valueCols.length === 1 && (periodCols.length + categoryCols.length) >= 2 && rowCount > (periodCols[0]?.distinct ?? categoryCols[0]?.distinct ?? 0))
                    ? [...periodCols, ...categoryCols].slice(0, 2)
                    : [];
            if (fallbackAxes.length === 2 && valueCols.length === 1) {
                const periodAxis = fallbackAxes.find(c => c.role === 'period');
                const otherAxis = fallbackAxes.find(c => c !== periodAxis);
                const xCol = periodAxis ?? fallbackAxes[0];
                const seriesCol = periodAxis ? otherAxis : fallbackAxes[1];
                const valCol = valueCols[0];
                const fn = aggregateFunctionForUnit(valCol.unit) ?? 'mean';
                addCandidate('heatmap', t(locale, `${xCol.name}×${seriesCol.name} 기준 ${valCol.name}을 피벗 히트맵으로 보여줍니다.`, `Shows ${valCol.name} pivoted by ${xCol.name} and ${seriesCol.name} as a heatmap.`), {
                    type: 'heatmap',
                    source: analysisSource({
                        type: 'pivot',
                        columns: [xCol.name, seriesCol.name, valCol.name],
                        function: fn
                    }),
                    series: [{ column: 'value' }],
                    style
                });
            } else if (!labelCol) localNeeds.push('label');
            else if (valueCols.length < 3) {
                localCautions.push(t(locale,
                    '긴 표는 heatmap 전에 행·열로 펼쳐야 합니다.',
                    'Long tables must be pivoted to rows and columns before a heatmap.'));
            } else {
                if (new Set(valueCols.map(c => c.unit)).size > 1) {
                    if (maybeFail('matrix의 값 열들은 같은 단위여야 합니다.', 'matrix value columns must share the same unit.') === null) {
                        return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
                    }
                }
                if (rowCount > 200 || rowCount > labelCol.distinct) {
                    localCautions.push(t(locale,
                        rowCount > 200
                            ? `행이 ${rowCount}개라 build_chart source는 200행까지입니다. filter로 줄이세요.`
                            : '범주 이름이 겹쳐 heatmap을 원자료로 그릴 수 없습니다. filter로 줄이거나 집계하세요.',
                        rowCount > 200
                            ? `${rowCount} rows exceed the 200-row build_chart source limit. Narrow the rows with filter.`
                            : 'Duplicate category labels cannot be plotted as a raw heatmap.'));
                    localNeeds.push('filter');
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
                        style
                    }, { cautions: extraCautions });
                }
            }
        }

        return { labelCol, valueCols, candidates: localCandidates, needs: localNeeds, cautions: localCautions, notes: localNotes, referenceCandidates: localRefCandidates };
    };

    let candidates = [];
    let topNeeds = [];
    let referenceCandidates = [];
    let labelCol = null;
    let valueCols = numericCols.length ? [numericCols[0]] : [];
    let overview = false;

    if (parsed.unsupportedShape) {
        baseCautions.push(t(locale,
            `요청한 형태(${parsed.unsupportedShape.matched})는 build_chart가 지원하지 않습니다. get_chart_guide(topic: "${parsed.unsupportedShape.topic}")를 참고하세요.`,
            `Requested chart type (${parsed.unsupportedShape.matched}) is not supported by build_chart. See get_chart_guide (topic: "${parsed.unsupportedShape.topic}").`));
    } else if (!goal) {
        if (!hasAmbiguous && rowCount > 0) {
            const picked = [];
            const seenSig = new Set();
            const tryGoal = (g) => {
                const res = runGoal(g, { useShape: false, allowThrow: false });
                const first = res.candidates.find(c => c.build);
                if (!first) return false;
                const sig = `${first.type}:${first.build.series.map(s => s.column).join(',')}:${first.build.source?.labels ?? first.build.source?.x ?? ''}:${first.build.source?.analysis?.type ?? ''}:${first.build.source?.analysis?.columns?.join(',') ?? ''}`;
                if (seenSig.has(sig)) return false;
                seenSig.add(sig);
                picked.push(first);
                if (!labelCol && res.labelCol) labelCol = res.labelCol;
                return true;
            };
            tryGoal('trend');
            if (picked.length < 3) {
                if (!tryGoal('compare')) tryGoal('rank');
            }
            if (picked.length < 3) tryGoal('share');
            if (picked.length < 3) tryGoal('relationship');
            if (picked.length < 3) tryGoal('distribution');

            if (picked.length > 0) {
                overview = true;
                candidates = picked.slice(0, 3);
                notes.unshift(t(locale,
                    '목적을 몰라 자료 모양으로 고른 후보입니다.',
                    'No goal was stated; selected candidates from the data shape.'));
            } else {
                topNeeds.push('goal');
            }
        } else if (!hasAmbiguous) {
            topNeeds.push('goal');
        }
    } else if (rowCount === 0) {
        baseCautions.push(t(locale, '조건에 맞는 행이 없습니다.', 'No rows match the current filter.'));
    } else {
        const res = runGoal(goal, { useShape: true, allowThrow: true });
        labelCol = res.labelCol;
        valueCols = res.valueCols;
        candidates = res.candidates;
        topNeeds = res.needs;
        baseCautions.push(...res.cautions);
        notes.push(...res.notes);
        referenceCandidates = res.referenceCandidates;
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
        ...(overview ? { overview: true } : {}),
        dataShape,
        candidates: limited,
        readFromRequest: parsed.readFromRequest,
        ...(parsed.confirm.length ? { confirm: parsed.confirm } : {}),
        ...(topNeeds.length ? { needs: topNeeds } : {}),
        ...(referenceCandidates.length ? { referenceCandidates } : {}),
        ...(baseCautions.length && !limited.length ? { cautions: baseCautions } : {}),
        ...(notes.length ? { notes } : {})
    };
}
