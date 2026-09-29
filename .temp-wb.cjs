"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_WALLPAPERS = void 0;
exports.findBuiltinWallpaper = findBuiltinWallpaper;
// ---------- 内置动态壁纸库（2026-09-25，参考 Wallpaper Engine） ----------
// 全部程序化生成（CSS 动画 / Canvas），零资源文件、零体积成本。
// css 字段：设置面板缩略图用的近似渐变；render()：WallpaperLayer 实际渲染的全屏组件。
const react_1 = __importStar(require("react"));
/** 通用全屏容器：内容绝对铺满 */
const Full = ({ children, bg }) => (react_1.default.createElement("div", { className: "absolute inset-0 overflow-hidden", style: bg ? { background: bg } : undefined }, children));
/** 星空漫游：Canvas 星点缓速漂移 + 闪烁 */
const Starfield = () => {
    const ref = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        const canvas = ref.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        let raf = 0;
        let w = 0, h = 0;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const resize = () => {
            w = canvas.clientWidth;
            h = canvas.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        const stars = Array.from({ length: 170 }, () => ({
            x: Math.random(), y: Math.random(),
            r: 0.4 + Math.random() * 1.4,
            vx: (Math.random() - 0.5) * 0.008,
            vy: (Math.random() - 0.5) * 0.006,
            ph: Math.random() * Math.PI * 2,
            sp: 0.4 + Math.random() * 1.2,
        }));
        let t = 0;
        const draw = () => {
            t += 0.016;
            ctx.fillStyle = '#070b1d';
            ctx.fillRect(0, 0, w, h);
            for (const s of stars) {
                s.x = (s.x + s.vx / 100 + 1) % 1;
                s.y = (s.y + s.vy / 100 + 1) % 1;
                const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
                ctx.beginPath();
                ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(226,232,255,${a.toFixed(3)})`;
                ctx.fill();
            }
            raf = requestAnimationFrame(draw);
        };
        draw();
        window.addEventListener('resize', resize);
        return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
    }, []);
    return react_1.default.createElement(Full, null,
        react_1.default.createElement("canvas", { ref: ref, className: "absolute inset-0 w-full h-full" }));
};
/** 雨夜玻璃：Canvas 雨丝下落 */
const Rain = () => {
    const ref = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        const canvas = ref.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        let raf = 0;
        let w = 0, h = 0;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const resize = () => {
            w = canvas.clientWidth;
            h = canvas.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        const drops = Array.from({ length: 130 }, () => ({
            x: Math.random(), y: Math.random(),
            len: 12 + Math.random() * 26,
            v: 0.55 + Math.random() * 0.75,
            o: 0.08 + Math.random() * 0.22,
        }));
        const draw = () => {
            ctx.fillStyle = '#0d1420';
            ctx.fillRect(0, 0, w, h);
            for (const d of drops) {
                d.y += d.v / 100;
                if (d.y > 1.1) {
                    d.y = -0.1;
                    d.x = Math.random();
                }
                ctx.beginPath();
                ctx.moveTo(d.x * w, d.y * h - d.len);
                ctx.lineTo(d.x * w, d.y * h);
                ctx.strokeStyle = `rgba(148,183,255,${d.o.toFixed(3)})`;
                ctx.lineWidth = 1.1;
                ctx.stroke();
            }
            raf = requestAnimationFrame(draw);
        };
        draw();
        window.addEventListener('resize', resize);
        return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
    }, []);
    return react_1.default.createElement(Full, null,
        react_1.default.createElement("canvas", { ref: ref, className: "absolute inset-0 w-full h-full" }));
};
exports.BUILTIN_WALLPAPERS = [
    {
        id: 'aurora',
        name: '极光流转',
        css: 'linear-gradient(160deg,#0b1026,#1b2a4a 45%,#0e3b3e)',
        render: () => (react_1.default.createElement(Full, { bg: "linear-gradient(160deg,#0b1026,#1b2a4a 45%,#0e3b3e)" },
            react_1.default.createElement("div", { className: "absolute inset-0", style: {
                    background: 'radial-gradient(60% 50% at 20% 30%, rgba(56,189,248,.5), transparent 70%),' +
                        'radial-gradient(50% 45% at 78% 18%, rgba(167,139,250,.45), transparent 70%),' +
                        'radial-gradient(55% 50% at 55% 82%, rgba(52,211,153,.4), transparent 70%)',
                    animation: 'wp-hue 26s linear infinite',
                } }))),
    },
    {
        id: 'sunset',
        name: '日落暖阳',
        css: 'linear-gradient(180deg,#3b1d60,#b3466b 55%,#ff9966)',
        render: () => (react_1.default.createElement(Full, { bg: "linear-gradient(180deg,#2b1a4d 0%,#7a3b6e 42%,#c25b63 68%,#ff9966 100%)" },
            react_1.default.createElement("div", { className: "absolute rounded-full", style: {
                    width: '38vmin', height: '38vmin', left: '50%', top: '62%',
                    transform: 'translate(-50%,-50%)',
                    background: 'radial-gradient(circle,#ffd9a0 0%,#ff9d5c 45%,rgba(255,120,80,.25) 72%,transparent 78%)',
                    animation: 'wp-pulse 7s ease-in-out infinite',
                } }),
            react_1.default.createElement("div", { className: "absolute inset-0", style: { background: 'linear-gradient(0deg,rgba(43,26,77,.55),transparent 45%)' } }))),
    },
    {
        id: 'ocean',
        name: '碧海层浪',
        css: 'linear-gradient(180deg,#063a5e,#0b7f9e 60%,#5eead4)',
        render: () => (react_1.default.createElement(Full, { bg: "linear-gradient(180deg,#063a5e 0%,#0b7f9e 55%,#17b3a6 100%)" }, [
            { bottom: '6%', o: 0.5, dur: '16s', delay: '0s', fill: 'rgba(224,255,250,.5)' },
            { bottom: '-2%', o: 0.65, dur: '11s', delay: '-4s', fill: 'rgba(190,242,235,.55)' },
            { bottom: '-8%', o: 0.8, dur: '8s', delay: '-2s', fill: 'rgba(255,255,255,.65)' },
        ].map((wv, i) => (react_1.default.createElement("svg", { key: i, className: "absolute left-0 w-[200%] h-[26vh]", style: { bottom: wv.bottom, opacity: wv.o, animation: `wp-wave ${wv.dur} linear infinite`, animationDelay: wv.delay }, viewBox: "0 0 2880 260", preserveAspectRatio: "none" },
            react_1.default.createElement("path", { d: "M0,130 C240,40 480,220 720,130 C960,40 1200,220 1440,130 C1680,40 1920,220 2160,130 C2400,40 2640,220 2880,130 L2880,260 L0,260 Z", fill: wv.fill })))))),
    },
    {
        id: 'mesh',
        name: '流体彩雾',
        css: 'linear-gradient(140deg,#1e1b4b,#4c1d95 50%,#831843)',
        render: () => (react_1.default.createElement(Full, { bg: "linear-gradient(140deg,#171532,#241b4d 55%,#171532)" }, [
            { c: 'rgba(129,140,248,.55)', size: '55vmax', x: '-12%', y: '-14%', an: 'wp-drift 22s ease-in-out infinite' },
            { c: 'rgba(244,114,182,.45)', size: '48vmax', x: '58%', y: '48%', an: 'wp-drift2 27s ease-in-out infinite' },
            { c: 'rgba(45,212,191,.42)', size: '42vmax', x: '52%', y: '-16%', an: 'wp-drift2 31s ease-in-out infinite reverse' },
            { c: 'rgba(250,204,21,.30)', size: '34vmax', x: '-8%', y: '58%', an: 'wp-drift 25s ease-in-out infinite reverse' },
        ].map((b, i) => (react_1.default.createElement("div", { key: i, className: "absolute rounded-full", style: { width: b.size, height: b.size, left: b.x, top: b.y, background: b.c, filter: 'blur(90px)', animation: b.an } }))))),
    },
    {
        id: 'starfield',
        name: '星空漫游',
        css: 'radial-gradient(circle at 30% 40%,#1e293b,#070b1d 70%)',
        render: () => react_1.default.createElement(Starfield, null),
    },
    {
        id: 'rain',
        name: '雨夜霓虹',
        css: 'linear-gradient(180deg,#0d1420,#17304d)',
        render: () => react_1.default.createElement(Rain, null),
    },
    {
        id: 'neon',
        name: '霓虹网格',
        css: 'linear-gradient(180deg,#1a0b2e,#3b0764 70%)',
        render: () => (react_1.default.createElement(Full, { bg: "linear-gradient(180deg,#160a2b 0%,#2e0f52 60%,#4c1d95 100%)" },
            react_1.default.createElement("div", { className: "absolute left-[-25%] right-[-25%] bottom-[-12%] h-[75%]", style: {
                    transform: 'perspective(420px) rotateX(58deg)',
                    backgroundImage: 'repeating-linear-gradient(0deg, rgba(232,121,249,.5) 0 1.5px, transparent 1.5px 44px),' +
                        'repeating-linear-gradient(90deg, rgba(56,189,248,.42) 0 1.5px, transparent 1.5px 44px)',
                    animation: 'wp-grid 3.2s linear infinite',
                    maskImage: 'linear-gradient(0deg, black 55%, transparent)',
                    WebkitMaskImage: 'linear-gradient(0deg, black 55%, transparent)',
                } }),
            react_1.default.createElement("div", { className: "absolute rounded-full", style: {
                    width: '70vmin', height: '70vmin', left: '50%', top: '58%',
                    transform: 'translate(-50%,-50%)',
                    background: 'radial-gradient(circle, rgba(232,121,249,.28), transparent 62%)',
                    animation: 'wp-pulse 6s ease-in-out infinite',
                } }))),
    },
    {
        id: 'bokeh',
        name: '光斑虚化',
        css: 'linear-gradient(150deg,#fdf2f8,#fce7f3 40%,#e0f2fe)',
        render: () => (react_1.default.createElement(Full, { bg: "linear-gradient(150deg,#fff1f2 0%,#fce7f3 45%,#e0f2fe 100%)" }, [
            { c: 'rgba(251,113,133,.4)', s: 320, x: '8%', y: '12%', an: 'wp-drift 19s ease-in-out infinite' },
            { c: 'rgba(251,191,36,.38)', s: 260, x: '62%', y: '8%', an: 'wp-drift2 23s ease-in-out infinite' },
            { c: 'rgba(56,189,248,.35)', s: 300, x: '70%', y: '58%', an: 'wp-drift 26s ease-in-out infinite reverse' },
            { c: 'rgba(167,139,250,.36)', s: 240, x: '18%', y: '64%', an: 'wp-drift2 21s ease-in-out infinite reverse' },
            { c: 'rgba(52,211,153,.30)', s: 180, x: '44%', y: '38%', an: 'wp-drift 17s ease-in-out infinite' },
        ].map((b, i) => (react_1.default.createElement("div", { key: i, className: "absolute rounded-full", style: {
                width: b.s, height: b.s, left: b.x, top: b.y,
                background: `radial-gradient(circle, ${b.c}, transparent 70%)`,
                filter: 'blur(28px)', animation: b.an,
            } }))))),
    },
];
function findBuiltinWallpaper(id) {
    return exports.BUILTIN_WALLPAPERS.find(b => b.id === id);
}
