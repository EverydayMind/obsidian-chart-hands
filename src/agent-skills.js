import generated from './agent-assets.generated.json';

// Host-only provider members (host-capabilities-v1). They are not model tools and never touch the descriptor.
const bodies = generated.bodies;

export function describeAgentAssets() {
    return JSON.parse(JSON.stringify(generated.assets));
}

export function readAgentAsset(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid asset request');
    if (Object.keys(request).sort().join(',') !== 'id,kind,locale') throw new Error('Invalid asset request');
    const { kind, id, locale } = request;
    if (kind !== 'skill' || typeof id !== 'string' || (locale !== 'ko' && locale !== 'en')) throw new Error('Unknown asset');
    const key = `${id}/${locale}`;
    if (!Object.prototype.hasOwnProperty.call(bodies, key)) throw new Error('Unknown asset');
    return { body: bodies[key] };
}

export const HOST_ADVERTISEMENT = Symbol.for('dev.agentinterop.host');

/** Status line only: feature-detects the host advertisement without running any host code. */
export function hostSkillSupport(app) {
    const plugins = app?.plugins?.plugins;
    if (!plugins || typeof plugins !== 'object') return 'unknown';
    for (const instance of Object.values(plugins)) {
        if (!instance || typeof instance !== 'object') continue;
        const d = Object.getOwnPropertyDescriptor(instance, HOST_ADVERTISEMENT);
        if (!d || !('value' in d)) continue;
        const ad = d.value;
        if (ad?.protocol === 'agentinterop' && Array.isArray(ad.contracts) && ad.contracts.includes('host-capabilities-v1')) return 'supported';
    }
    return 'not_found';
}

/** Names of the shipped Skills in one UI language; empty when none exist in it. */
export function agentSkillNames(locale) {
    return generated.assets.skills.filter(skill => skill.locale === locale).map(skill => skill.frontmatter.name);
}

export function hostSkillStatusLine(app, locale, names = agentSkillNames(locale)) {
    const list = names.join(', ');
    const state = hostSkillSupport(app);
    if (locale === 'ko') {
        if (state === 'supported') return list ? `AI 호스트가 이 플러그인의 Skill(${list})을 읽을 수 있습니다.` : 'AI 호스트가 이 플러그인의 Skill을 읽을 수 있습니다.';
        if (state === 'not_found') return list
            ? `켜진 AI 호스트 중 플러그인 Skill을 읽는 것이 없습니다. Verbex를 쓰고 있다면 최신 판으로 업데이트하면 이 플러그인의 Skill(${list})을 쓸 수 있습니다.`
            : '켜진 AI 호스트 중 플러그인 Skill을 읽는 것이 없습니다. Verbex를 쓰고 있다면 최신 판으로 업데이트하면 이 플러그인의 Skill을 쓸 수 있습니다.';
        return 'AI 호스트의 플러그인 Skill 지원 여부를 확인할 수 없습니다.';
    }
    if (state === 'supported') return list ? `An AI host can read this plugin's Skills (${list}).` : "An AI host can read this plugin's Skills.";
    if (state === 'not_found') return list
        ? `No enabled AI host reads plugin Skills. If you use Verbex, update it to use this plugin's Skills (${list}).`
        : "No enabled AI host reads plugin Skills. If you use Verbex, update it to use this plugin's Skills.";
    return 'Could not check whether an AI host supports plugin Skills.';
}
