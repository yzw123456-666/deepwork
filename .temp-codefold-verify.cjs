"use strict";
// ---------- 思考区显示层的代码折叠（2026-09-22 轮 J） ----------
// 用户三次反馈「思考过程中出现代码」（截图：```js 围栏块、无围栏的 const/function 裸代码）。
// 根因：轮 G 只给对话页 ThinkingBlock 接了清洗，任务视图（TaskWorkspace）的思考区没有；
// 且 dropCodeBlocks 只认围栏与 HTML 文档，模型输出不带 ``` 的裸代码（const/function 逐行）
// 完全漏网。
// 原则：落盘保留思考原文（完整推理可回溯），**显示层**一律把代码折叠成一行「📄 代码草稿（未写入文件）」。
// 本模块为 ChatArea 与 TaskWorkspace 共用，避免两份实现漂移。
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODE_NOTE = void 0;
exports.foldFenceBlocks = foldFenceBlocks;
exports.isCodeLine = isCodeLine;
exports.foldBareCode = foldBareCode;
exports.sanitizeThinkingDisplay = sanitizeThinkingDisplay;
exports.parseThinkingUnits = parseThinkingUnits;
exports.CODE_NOTE = '📄 代码草稿（未写入文件）';
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * 围栏代码块（含流式中未闭合的 ```）→ 一行提示；裸 HTML 文档同样处理。
 * 与 ChatArea.dropCodeBlocks 的围栏/HTML 部分语义一致。
 */
function foldFenceBlocks(content) {
    if (!content)
        return content;
    const hasFence = content.includes('```');
    const hasHtmlDoc = /<!DOCTYPE[^>]*>|<html[\s>]/i.test(content);
    if (!hasFence && !hasHtmlDoc)
        return content;
    let out = content.replace(/```[^\n]*\n[\s\S]*?```/g, exports.CODE_NOTE).replace(/```[^\n]*\n[\s\S]*$/, exports.CODE_NOTE);
    out = out
        .replace(/<!DOCTYPE[^>]*>[\s\S]*?<\/html\s*>/gi, exports.CODE_NOTE)
        .replace(/<html[^>]*>[\s\S]*?<\/html\s*>/gi, exports.CODE_NOTE)
        .replace(/(^|\n)\s*<!DOCTYPE[^>]*>[\s\S]*$/i, exports.CODE_NOTE)
        .replace(/(^|\n)\s*<html[^>]*>[\s\S]*$/i, exports.CODE_NOTE);
    out = out.replace(new RegExp(`(?:${escapeRegExp(exports.CODE_NOTE)}\\s*){2,}`, 'g'), exports.CODE_NOTE);
    return out.replace(/\n{3,}/g, '\n\n').trim();
}
/**
 * 单行是否像代码（裸代码启发式的一环）。
 * 必须多行连续命中才折叠（foldBareCode），单行命中不折叠——防止误伤
 * 「const x = 1 的写法」「return 之后判断」这类正文提及。
 */
function isCodeLine(line) {
    const s = line.trim();
    if (!s)
        return false;
    if (/^(?:const\s|let\s|var\s|function\s+|class\s|import\s|export\s)/.test(s))
        return true;
    if (/^(?:if|for|while|switch|catch|else)\s*[({]/.test(s))
        return true;
    if (/^return\b/.test(s))
        return true;
    if (/^\}/.test(s))
        return true;
    if (/[{};]\s*$/.test(s) && /[=(){}[\]<>]|=>/.test(s))
        return true;
    if (/\)\s*\{\s*$/.test(s))
        return true;
    return false;
}
/**
 * 无围栏裸代码：连续 ≥3 行代码特征行（允许中间空行）整段折叠成一行提示。
 * 「const CSS_SIZE = 640; … function cellSize() { … } …」这类思考草稿没有 ``` 围栏，
 * 只能靠行特征识别。阈值 3 行：两行以内的零星代码样文本不折叠（防误伤）。
 */
function foldBareCode(content) {
    if (!content)
        return content;
    const lines = content.split('\n');
    const out = [];
    let buf = [];
    let codeCount = 0;
    const flush = () => {
        if (codeCount >= 3)
            out.push(exports.CODE_NOTE);
        else
            out.push(...buf);
        buf = [];
        codeCount = 0;
    };
    for (const line of lines) {
        if (isCodeLine(line)) {
            buf.push(line);
            codeCount++;
            continue;
        }
        if (!line.trim()) {
            // 空行：在代码段缓冲内则暂存（段内空行），否则直接输出
            if (buf.length)
                buf.push(line);
            else
                out.push(line);
            continue;
        }
        flush();
        out.push(line);
    }
    flush();
    const joined = out.join('\n');
    // 折叠后可能产生重复提示行与堆积空行，清一遍
    return joined
        .replace(new RegExp(`(?:^|\\n)${escapeRegExp(exports.CODE_NOTE)}(?:\\s*\\n${escapeRegExp(exports.CODE_NOTE)})+`, 'g'), '\n' + exports.CODE_NOTE)
        .replace(/\n{3,}/g, '\n\n');
}
/** 思考区显示层总入口：围栏 + HTML 文档 + 无围栏裸代码 全部折叠成一行「📄 代码草稿（未写入文件）」 */
function sanitizeThinkingDisplay(content) {
    if (!content)
        return content;
    return foldBareCode(foldFenceBlocks(content));
}
// 与 foldFenceBlocks 前两轮 replace 同一套模式：闭合围栏 / 未闭合围栏（流式中）/ 闭合 HTML 文档
const RE_THINKING_CODE_BLOCK = /```[^\n]*\n[\s\S]*?```|```[^\n]*\n[\s\S]*$|<!DOCTYPE[^>]*>[\s\S]*?<\/html\s*>|<html[^>]*>[\s\S]*?<\/html\s*>/gi;
// 与 foldFenceBlocks 第三轮同款：行首开始的未闭合 HTML 文档（直到结尾）
const RE_UNCLOSED_DOC = /(^|\n)\s*<!DOCTYPE[^>]*>[\s\S]*$|(^|\n)\s*<html[^>]*>[\s\S]*$/i;
/** 纯文本段：先切行首未闭合 HTML 文档，再按 foldBareCode 的行走规则切无围栏裸代码 */
function pushTextSegment(text, units) {
    if (!text)
        return;
    const m = RE_UNCLOSED_DOC.exec(text);
    if (m && m.index !== undefined) {
        pushTextSegment(text.slice(0, m.index), units);
        units.push({ kind: 'code', code: m[0] });
        return;
    }
    // 无围栏裸代码：与 foldBareCode 同步的行走逻辑——连续 ≥3 行代码特征行（允许段内空行）成段
    let textLines = [];
    let buf = [];
    let codeCount = 0;
    const flushText = () => {
        if (textLines.length) {
            units.push({ kind: 'text', text: textLines.join('\n') });
            textLines = [];
        }
    };
    const flushBuf = () => {
        if (codeCount >= 3) {
            flushText(); // 代码段之前的正文先落位
            units.push({ kind: 'code', code: buf.join('\n') });
        }
        else {
            textLines.push(...buf); // 不成段的代码样行还原成正文（防误伤）
        }
        buf = [];
        codeCount = 0;
    };
    for (const line of text.split('\n')) {
        if (isCodeLine(line)) {
            buf.push(line);
            codeCount++;
        }
        else if (!line.trim()) {
            if (buf.length)
                buf.push(line); // 段内空行
            else
                textLines.push(line);
        }
        else {
            flushBuf();
            textLines.push(line);
        }
    }
    flushBuf();
    flushText();
}
/** 思考内容 → text / code 单元序列（code 单元 = 代码草稿原文，UI 渲染为可展开块） */
function parseThinkingUnits(content) {
    if (!content)
        return [];
    const units = [];
    let last = 0;
    for (const m of content.matchAll(RE_THINKING_CODE_BLOCK)) {
        const idx = m.index ?? 0;
        if (idx > last)
            pushTextSegment(content.slice(last, idx), units);
        units.push({ kind: 'code', code: m[0] });
        last = idx + m[0].length;
    }
    if (last < content.length)
        pushTextSegment(content.slice(last), units);
    return units;
}
