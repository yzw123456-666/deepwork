"use strict";
// ---------- 壁纸文件路径 → file:// URL（2026-09-25） ----------
// 渲染层显示本地壁纸（图片/视频/HTML）统一走 file:// URL。
// 前提：主进程 webSecurity:false 已开启（模型 API 直连需要），file:// 加载不受同源限制。
// 只做纯字符串转换，便于单测。
Object.defineProperty(exports, "__esModule", { value: true });
exports.toFileUrl = toFileUrl;
/**
 * 本地磁盘路径 → file:// URL
 * - Windows 盘符：D:\a\b.png → file:///D:/a/b.png
 * - UNC 路径：   \\srv\share\a.png → file://srv/share/a.png
 * - POSIX：      /a/b.png → file:///a/b.png
 * - 已是 file:// 开头：原样返回
 * - 中文/空格等字符经 encodeURI 编码
 */
function toFileUrl(p) {
    if (!p)
        return '';
    const trimmed = p.trim();
    if (!trimmed)
        return '';
    if (/^file:\/\//i.test(trimmed))
        return trimmed;
    // UNC（\\srv\share\x 或 //srv/share/x）→ file://srv/share/x
    if (/^\\\\/.test(trimmed) || /^\/\//.test(trimmed)) {
        return encodeURI('file://' + trimmed.replace(/\\/g, '/').replace(/^\/+/, ''));
    }
    // Windows 盘符（D:\x 或 D:/x）
    if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
        return encodeURI('file:///' + trimmed.replace(/\\/g, '/'));
    }
    // POSIX 绝对路径
    if (trimmed.startsWith('/')) {
        return encodeURI('file://' + trimmed);
    }
    // 兜底：当作相对路径处理（正常不会出现）
    return encodeURI('file:///' + trimmed.replace(/\\/g, '/'));
}
