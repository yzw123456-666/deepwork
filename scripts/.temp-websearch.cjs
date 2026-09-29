"use strict";
// ---------- 内置浏览器：网页搜索 + 网页正文抓取 ----------
// 无需任何 API Key：解析搜索结果页 HTML；统一处理实体、标签、正文提取
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_ENGINES = void 0;
exports.decodeEntities = decodeEntities;
exports.stripTags = stripTags;
exports.cleanResultUrl = cleanResultUrl;
exports.parseBingResults = parseBingResults;
exports.parseDuckDuckGoResults = parseDuckDuckGoResults;
exports.parseBaiduResults = parseBaiduResults;
exports.detectEngineResults = detectEngineResults;
exports.htmlToText = htmlToText;
exports.summarizePage = summarizePage;
exports.request = request;
exports.requestBuffer = requestBuffer;
exports.webSearch = webSearch;
exports.webFetch = webFetch;
exports.SEARCH_ENGINES = [
    { id: 'bing', host: 'cn.bing.com', url: (q) => `https://cn.bing.com/search?q=${q}&setlang=zh-CN&ensearch=0` },
    { id: 'duckduckgo', host: 'html.duckduckgo.com', url: (q) => `https://html.duckduckgo.com/html/?q=${q}` },
    { id: 'baidu', host: 'www.baidu.com', url: (q) => `https://www.baidu.com/s?wd=${q}` },
];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_REDIRECTS = 5;
const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
    '#39': "'", '#34': '"', '#38': '&',
};
function decodeEntities(input) {
    return String(input || '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-zA-Z#0-9]+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}
function stripTags(html) {
    return decodeEntities(String(html || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
// 搜索结果的 URL 清洗：去掉引擎跳转包装，提取真实地址
function cleanResultUrl(raw) {
    const href = String(raw || '').trim();
    if (!href)
        return '';
    const ddg = href.match(/[?&]uddg=([^&]+)/);
    if (ddg) {
        try {
            return decodeURIComponent(ddg[1]);
        }
        catch { /* 保底返回原值 */ }
    }
    const target = href.match(/[?&]url=([^&]+)/);
    if (target && /bing\.com|baidu\.com/.test(href)) {
        try {
            const decoded = decodeURIComponent(target[1]);
            if (/^https?:\/\//.test(decoded))
                return decoded;
        }
        catch { /* 保底返回原值 */ }
    }
    return href;
}
// Bing 结果页解析：<li class="b_algo"> 下的 <h2><a href="...">标题</a></h2> + 摘要
function parseBingResults(html, limit = 8) {
    const out = [];
    const blocks = String(html || '').split(/<li class="b_algo"/i).slice(1);
    for (const block of blocks) {
        if (out.length >= limit)
            break;
        const link = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!link)
            continue;
        const url = cleanResultUrl(link[1]);
        const title = stripTags(link[2]);
        if (!url || !title)
            continue;
        const cap = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        out.push({ title, url, snippet: cap ? stripTags(cap[1]) : '' });
    }
    return out;
}
// DuckDuckGo HTML 版解析
function parseDuckDuckGoResults(html, limit = 8) {
    const out = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/gi;
    let m;
    while ((m = re.exec(String(html || ''))) !== null && out.length < limit) {
        const url = cleanResultUrl(m[1]);
        const title = stripTags(m[2]);
        const snip = m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
        if (!url || !title)
            continue;
        out.push({ title, url, snippet: snip ? stripTags(snip[1]) : '' });
    }
    return out;
}
// 百度结果页解析（链接为百度跳转地址，抓正文时会自动跟随到真实站点）
function parseBaiduResults(html, limit = 8) {
    const out = [];
    const blocks = String(html || '').split(/<h3[^>]*class="[^"]*t[^"]*"[^>]*>/i).slice(1);
    for (const block of blocks) {
        if (out.length >= limit)
            break;
        const link = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!link)
            continue;
        const title = stripTags(link[2]);
        if (!title)
            continue;
        const snip = block.match(/class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/span>|<div[^>]*class="[^"]*c-span-last[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        out.push({ title, url: link[1], snippet: snip ? stripTags(snip[1] || snip[2] || '') : '' });
    }
    return out;
}
function detectEngineResults(html, limit = 8) {
    const bing = parseBingResults(html, limit);
    if (bing.length > 0)
        return { engine: 'bing', results: bing };
    const ddg = parseDuckDuckGoResults(html, limit);
    if (ddg.length > 0)
        return { engine: 'duckduckgo', results: ddg };
    const baidu = parseBaiduResults(html, limit);
    if (baidu.length > 0)
        return { engine: 'baidu', results: baidu };
    return { engine: 'none', results: [] };
}
// HTML → 纯文本（去掉脚本/样式，块级标签转换行）
function htmlToText(html, maxChars = 20000) {
    const src = String(html || '');
    const titleMatch = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';
    let body = src
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
    body = body
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table|\/section|\/article)[^>]*>/gi, '\n')
        .replace(/<(p|div|li|h[1-6]|tr)[^>]*>/gi, '\n');
    const text = decodeEntities(body.replace(/<[^>]*>/g, ' '))
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    return { title, text: text.slice(0, maxChars) };
}
// 紧凑提取：域名 + 正文前 N 字符，供模型阅读
function summarizePage(url, title, text, maxChars = 12000) {
    let host = '';
    try {
        host = new URL(url).hostname;
    }
    catch {
        host = url;
    }
    const body = text.length > maxChars ? text.slice(0, maxChars) + `\n…（正文共 ${text.length} 字符，已截断）` : text;
    return `来源: ${host}\n标题: ${title || '(无)'}\n正文:\n${body}`;
}
function getFetch() {
    const f = globalThis.fetch;
    if (typeof f !== 'function')
        throw new Error('当前运行环境不支持 fetch');
    return f;
}
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
        promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
}
async function request(url, timeoutMs, onRedirect) {
    const fetchFn = getFetch();
    const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    // 手动跟随重定向：每跳都交给调用方做安全中心校验，
    // 用 redirect:'follow' 会让黑名单域名通过跳转被静默访问
    let current = url;
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        const res = await withTimeout(fetchFn(current, { redirect: 'manual', headers }), timeoutMs, '网络请求');
        const status = res.status;
        const location = res.headers?.get?.('location');
        const isRedirect = status >= 300 && status < 400 && !!location;
        if (!isRedirect) {
            const body = await res.text();
            return { status, body, finalUrl: current };
        }
        let next;
        try {
            next = new URL(location, current).toString();
        }
        catch {
            break;
        }
        if (onRedirect) {
            const allowed = await onRedirect(next);
            if (!allowed)
                throw new Error(`重定向目标被安全策略拒绝: ${next}`);
        }
        current = next;
    }
    throw new Error(`重定向次数过多（最多 ${MAX_REDIRECTS} 次）`);
}
// 二进制下载（技能包 zip 等）：与 request 同样的逐跳重定向校验，但返回 Buffer
async function requestBuffer(url, timeoutMs, onRedirect) {
    const fetchFn = getFetch();
    const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/zip,application/octet-stream,*/*',
    };
    let current = url;
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        const res = await withTimeout(fetchFn(current, { redirect: 'manual', headers }), timeoutMs, '下载');
        const status = res.status;
        const location = res.headers?.get?.('location');
        const isRedirect = status >= 300 && status < 400 && !!location;
        if (!isRedirect) {
            const ab = await res.arrayBuffer();
            return { status, body: Buffer.from(ab), finalUrl: current };
        }
        let next;
        try {
            next = new URL(location, current).toString();
        }
        catch {
            break;
        }
        if (onRedirect) {
            const allowed = await onRedirect(next);
            if (!allowed)
                throw new Error(`重定向目标被安全策略拒绝: ${next}`);
        }
        current = next;
    }
    throw new Error(`重定向次数过多（最多 ${MAX_REDIRECTS} 次）`);
}
// 搜索：依次尝试内置引擎，第一个解析出结果的胜出
// onEngine 可选：由调用方做安全中心域名校验/用户确认，返回 false 表示跳过该引擎
async function webSearch(query, limit = 8, timeoutMs = 15000, onEngine) {
    const q = String(query || '').trim();
    if (!q)
        return { ok: false, engine: 'none', results: [], errors: ['缺少搜索关键词'] };
    const errors = [];
    for (const engine of exports.SEARCH_ENGINES) {
        const target = engine.url(encodeURIComponent(q));
        if (onEngine) {
            let allowed = false;
            try {
                allowed = await onEngine({ id: engine.id, host: engine.host, url: target });
            }
            catch (e) {
                errors.push(`${engine.id}: 策略校验失败 ${e.message}`);
            }
            if (!allowed)
                continue;
        }
        try {
            const { status, body } = await request(target, timeoutMs);
            if (status >= 400) {
                errors.push(`${engine.id}: HTTP ${status}`);
                continue;
            }
            const { results } = detectEngineResults(body, limit);
            if (results.length > 0)
                return { ok: true, engine: engine.id, results, errors };
            errors.push(`${engine.id}: 未解析出结果`);
        }
        catch (e) {
            errors.push(`${engine.id}: ${e.message}`);
        }
    }
    return { ok: false, engine: 'none', results: [], errors };
}
// 抓取网页正文
async function webFetch(url, maxChars = 12000, timeoutMs = 20000, onRedirect) {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) {
        return { ok: false, url: target, title: '', text: '', error: 'URL 必须以 http:// 或 https:// 开头' };
    }
    try {
        const { status, body, finalUrl } = await request(target, timeoutMs, onRedirect);
        if (status >= 400)
            return { ok: false, url: finalUrl, title: '', text: '', error: `HTTP ${status}` };
        const { title, text } = htmlToText(body, maxChars);
        if (!text)
            return { ok: false, url: finalUrl, title, text: '', error: '页面无可读文本（可能是脚本渲染页面）' };
        return { ok: true, url: finalUrl, title, text };
    }
    catch (e) {
        return { ok: false, url: target, title: '', text: '', error: e.message };
    }
}
