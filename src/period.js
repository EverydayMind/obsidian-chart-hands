export function periodKey(text, { compact = false } = {}) {
    const s = text.trim();
    let m;
    const month = (year, value) => Number(value) >= 1 && Number(value) <= 12 ? `M${year}-${value.padStart(2, '0')}` : null;
    const day = (year, mo, date) => {
        const y = Number(year), n = Number(mo), d = Number(date);
        const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return n >= 1 && n <= 12 && d >= 1 && d <= days[n - 1] ? `D${year}-${mo.padStart(2, '0')}-${date.padStart(2, '0')}` : null;
    };
    if ((m = s.match(/^(\d{4})(?:년도?)?$/))) {
        const y = Number(m[1]);
        return y >= 1900 && y <= 2100 ? `Y${m[1]}` : `S:${s}`;
    }
    if ((m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)) || (m = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/)) || (compact && (m = s.match(/^(\d{4})(\d{2})(\d{2})$/)))) return day(m[1], m[2], m[3]) ?? `S:${s}`;
    if ((m = s.match(/^(\d{4})[-./](\d{1,2})$/)) || (m = s.match(/^(\d{4})년\s*(\d{1,2})월$/)) || (compact && (m = s.match(/^(\d{4})(\d{2})$/)))) return month(m[1], m[2]) ?? `S:${s}`;
    if ((m = s.match(/^(\d{4})(?:\s*[- ]\s*|\s*)Q([1-4])$/i)) || (m = s.match(/^(\d{4})년\s*([1-4])분기$/))) return `Q${m[1]}-${m[2]}`;
    if ((m = s.match(/^Q([1-4])\s+(\d{4})$/i))) return `Q${m[2]}-${m[1]}`;
    if ((m = s.match(/^(?:Q([1-4])|([1-4])분기)$/i))) return `Q?-${m[1] || m[2]}`;
    if ((m = s.match(/^(\d{1,2})월$/))) return month('?', m[1]) ?? `S:${s}`;
    if ((m = s.match(/^(?:(\d{4})(?:년)?\s*)?(상반기|하반기)$/))) return `H${m[1] || '?'}-${m[2] === '상반기' ? 1 : 2}`;
    return `S:${s}`;
}
