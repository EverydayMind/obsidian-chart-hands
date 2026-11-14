import { moment } from 'obsidian';

let initializedLocale;
let testLocale;
const valid = value => typeof value === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value.trim());
const language = value => value.trim().toLowerCase().startsWith('ko') ? 'ko' : 'en';

export function resolveLocale() {
    try {
        const appLanguage = moment.locale();
        if (valid(appLanguage)) return language(appLanguage);
    } catch { /* Headless environments may not provide the Obsidian API. */ }
    try {
        const nav = typeof window !== 'undefined' ? window.navigator : typeof navigator !== 'undefined' ? navigator : undefined;
        if (valid(nav?.language)) return language(nav.language);
    } catch { /* A browser language may not be available. */ }
    return 'en';
}
export function initLocale() {
    initializedLocale ??= resolveLocale();
    return initializedLocale;
}
export function getLocale() { return testLocale ?? initLocale(); }
export function setLocaleForTests(locale) { testLocale = locale; }
