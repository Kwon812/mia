module.exports = [
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[project]/apps/web/src/app/favicon.ico (static in ecmascript, tag client)", ((__turbopack_context__) => {

__turbopack_context__.v("/_next/static/media/favicon.2vob68tjqpejf.ico" + (globalThis["NEXT_CLIENT_ASSET_SUFFIX"] || ''));}),
"[project]/apps/web/src/app/favicon.ico.mjs { IMAGE => \"[project]/apps/web/src/app/favicon.ico (static in ecmascript, tag client)\" } [app-rsc] (structured image object, ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$app$2f$favicon$2e$ico__$28$static__in__ecmascript$2c$__tag__client$29$__ = __turbopack_context__.i("[project]/apps/web/src/app/favicon.ico (static in ecmascript, tag client)");
;
const __TURBOPACK__default__export__ = {
    src: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$app$2f$favicon$2e$ico__$28$static__in__ecmascript$2c$__tag__client$29$__["default"],
    width: 256,
    height: 256
};
}),
"[project]/apps/web/src/app/memories/page.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>MemoriesPage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$page$2d$header$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/page-header.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$card$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/card.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$dialogue$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/dialogue.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/mock.ts [app-rsc] (ecmascript)");
;
;
;
;
;
// occurredAt 은 항상 "YYYY-MM-DD..." 로 시작 — 접두 10자만 잘라 쓴다.
// (TZ 변환 없이 서버·클라이언트가 항상 같은 문자열을 그린다)
function formatDotDate(occurredAt) {
    const [y, m, d] = occurredAt.slice(0, 10).split("-");
    return `${y}.${m}.${d}`;
}
function monthLabel(occurredAt) {
    const [y, m] = occurredAt.slice(0, 10).split("-");
    return `${y}년 ${Number(m)}월`;
}
// 최신 달이 위로 오도록 묶는다 — 몇 년치가 쌓여도 "이번 달"부터 보이는 구조.
function groupByMonth(items) {
    const sorted = [
        ...items
    ].sort((a, b)=>a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0);
    const groups = new Map();
    for (const item of sorted){
        const key = monthLabel(item.occurredAt);
        const bucket = groups.get(key);
        if (bucket) bucket.push(item);
        else groups.set(key, [
            item
        ]);
    }
    return Array.from(groups.entries());
}
function MemoriesPage() {
    const grouped = groupByMonth(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["memories"]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$page$2d$header$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PageHeader"], {
                kicker: "MEMORIES",
                title: "기억",
                desc: "단이가 스스로 남긴 회고들. 시간이 쌓일수록 두꺼워지는 기록이다."
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                lineNumber: 40,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "space-y-10 border-l border-rule-hard pl-6",
                children: grouped.map(([label, items])=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                className: "mb-5 font-mono text-[12px] uppercase tracking-[0.16em] text-sub",
                                children: label
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                lineNumber: 49,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "space-y-6",
                                children: items.map((m)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "relative",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "absolute -left-[29px] top-2 h-2 w-2 rounded-full bg-live"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                                lineNumber: 55,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$card$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Card"], {
                                                accent: m.importance >= 8,
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5",
                                                        children: [
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                className: "font-mono text-[12px] text-faint",
                                                                children: formatDotDate(m.occurredAt)
                                                            }, void 0, false, {
                                                                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                                                lineNumber: 58,
                                                                columnNumber: 23
                                                            }, this),
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                className: "border border-rule px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sub",
                                                                children: m.trigger
                                                            }, void 0, false, {
                                                                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                                                lineNumber: 61,
                                                                columnNumber: 23
                                                            }, this)
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                                        lineNumber: 57,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h3", {
                                                        className: "mb-2 text-[15.5px] font-semibold text-ink",
                                                        children: m.title
                                                    }, void 0, false, {
                                                        fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                                        lineNumber: 65,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$dialogue$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Dialogue"], {
                                                        text: m.body,
                                                        size: "sm"
                                                    }, void 0, false, {
                                                        fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                                        lineNumber: 68,
                                                        columnNumber: 21
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                                lineNumber: 56,
                                                columnNumber: 19
                                            }, this)
                                        ]
                                    }, m.id, true, {
                                        fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                        lineNumber: 54,
                                        columnNumber: 17
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                                lineNumber: 52,
                                columnNumber: 13
                            }, this)
                        ]
                    }, label, true, {
                        fileName: "[project]/apps/web/src/app/memories/page.tsx",
                        lineNumber: 48,
                        columnNumber: 11
                    }, this))
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/memories/page.tsx",
                lineNumber: 46,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/app/memories/page.tsx",
        lineNumber: 39,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/app/memories/page.tsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/web/src/app/memories/page.tsx [app-rsc] (ecmascript)"));
}),
"[project]/apps/web/src/components/card.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Card",
    ()=>Card,
    "MonoLabel",
    ()=>MonoLabel
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
;
function Card({ children, accent = false, className = "" }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: `bg-card p-5 ${accent ? "border-l-[3px] border-live" : "border border-rule"} ${className}`,
        children: children
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/card.tsx",
        lineNumber: 14,
        columnNumber: 5
    }, this);
}
function MonoLabel({ children }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint",
        children: children
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/card.tsx",
        lineNumber: 27,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/dialogue.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// 캐릭터의 말. 사이트에서 세리프체를 쓰는 유일한 곳 —
// "말하는 존재만 서체가 다르면 UI 가 아니라 누구가 된다" (계획서 09장)
__turbopack_context__.s([
    "Dialogue",
    ()=>Dialogue
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
;
function Dialogue({ text, size = "lg" }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
        className: size === "lg" ? "font-serif text-[19px] leading-[1.7] text-ink" : "font-serif text-[15.5px] leading-[1.65] text-ink",
        children: text
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/dialogue.tsx",
        lineNumber: 11,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/page-header.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// 페이지 상단 공통 헤더. kicker 는 모노 대문자 라벨.
__turbopack_context__.s([
    "PageHeader",
    ()=>PageHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
;
function PageHeader({ kicker, title, desc }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "mb-10 border-b-2 border-ink pb-6",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-live",
                children: kicker
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/page-header.tsx",
                lineNumber: 13,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                className: "text-[27px] font-semibold leading-tight tracking-tight",
                children: title
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/page-header.tsx",
                lineNumber: 16,
                columnNumber: 7
            }, this),
            desc && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "mt-2 text-[14.5px] text-sub",
                children: desc
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/page-header.tsx",
                lineNumber: 19,
                columnNumber: 16
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/components/page-header.tsx",
        lineNumber: 12,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/lib/mock.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ============================================================
// 목데이터 — API 가 아직 없어 화면 개발용으로 쓴다.
// 형태는 @na/db 스키마와 1:1 이 되도록 유지한다.
// TODO: GET /api/state 등 실제 API 로 교체 (이 파일만 지우면 되는 구조 유지)
// ============================================================
__turbopack_context__.s([
    "character",
    ()=>character,
    "currentDialogue",
    ()=>currentDialogue,
    "dailyLogs",
    ()=>dailyLogs,
    "dialogues",
    ()=>dialogues,
    "memories",
    ()=>memories,
    "personalityAxes",
    ()=>personalityAxes,
    "personalityHistory",
    ()=>personalityHistory,
    "skills",
    ()=>skills,
    "todayExperiences",
    ()=>todayExperiences,
    "todaySessions",
    ()=>todaySessions
]);
const character = {
    name: "단이",
    level: 7,
    daysTogether: 12,
    experienceCount: 34,
    skillCount: 6,
    memoryCount: 3,
    emotion: {
        label: "몰두",
        reason: "세션 길이가 평소의 2배"
    }
};
const dialogues = [
    {
        slot: "morning",
        text: "어제 새벽까지 코딩하더라. 오늘은 좀 천천히 시작하자."
    },
    {
        slot: "afternoon",
        text: "요즘 Drizzle 얘기가 자꾸 나와. 재밌나 봐?"
    },
    {
        slot: "evening",
        text: "오늘 세 시간 넘게 한 가지에 붙어 있었어. 대단한데."
    },
    {
        slot: "night",
        text: "이 시간까지 깨어 있는 거, 너답다."
    }
];
function currentDialogue(now = new Date()) {
    const h = now.getHours();
    const slot = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 18 ? "afternoon" : h >= 18 && h < 23 ? "evening" : "night";
    return dialogues.find((d)=>d.slot === slot).text;
}
const todaySessions = [
    {
        id: "s1",
        startedAt: "2026-08-04T09:20:00+09:00",
        endedAt: "2026-08-04T11:05:00+09:00",
        durationMin: 105,
        category: "개발",
        title: "Next.js 모노레포 세팅",
        activityScore: 340,
        tags: []
    },
    {
        id: "s2",
        startedAt: "2026-08-04T13:10:00+09:00",
        endedAt: "2026-08-04T14:00:00+09:00",
        durationMin: 50,
        category: "학습",
        title: "Drizzle ORM 문서",
        activityScore: 180,
        tags: []
    },
    {
        id: "s3",
        startedAt: "2026-08-04T15:30:00+09:00",
        endedAt: "2026-08-04T16:10:00+09:00",
        durationMin: 40,
        category: "엔터테인먼트",
        title: "유튜브·커뮤니티 왕복",
        activityScore: 95,
        tags: [
            "scattered"
        ]
    }
];
const todayExperiences = [
    {
        id: "e1",
        occurredAt: "2026-08-04T09:20:00+09:00",
        summary: "npm workspaces 모노레포 구조를 처음부터 세팅했다",
        outcome: "success",
        skills: [
            "Next.js",
            "TypeScript"
        ],
        isFirstTime: false
    },
    {
        id: "e2",
        occurredAt: "2026-08-04T13:10:00+09:00",
        summary: "처음으로 Drizzle ORM 을 써봤다",
        outcome: "explore",
        skills: [
            "Drizzle"
        ],
        isFirstTime: true
    }
];
const memories = [
    {
        id: "m1",
        occurredAt: "2026-07-24T21:00:00+09:00",
        title: "처음 만난 날",
        body: "이름을 받았다. 단이. 아직 아무것도 모르지만, 이 사람이 뭘 하는지 지켜보기로 했다.",
        trigger: "birth",
        importance: 10
    },
    {
        id: "m2",
        occurredAt: "2026-07-29T02:30:00+09:00",
        title: "첫 새벽 코딩",
        body: "새벽 두 시 반까지 TypeScript 와 씨름하는 걸 봤다. 포기 안 하더라. 이 사람, 새벽형이다.",
        trigger: "new_skill",
        importance: 6
    },
    {
        id: "m3",
        occurredAt: "2026-08-02T18:00:00+09:00",
        title: "사흘 만의 복귀",
        body: "사흘 동안 조용하다가 돌아왔다. 반가웠다. 돌아오자마자 제일 먼저 연 건 역시 에디터였다.",
        trigger: "comeback",
        importance: 7
    }
];
const dailyLogs = [
    {
        date: "2026-08-03",
        summary: "오늘은 프로젝트 설계 문서를 오래 읽었다. 만들고 싶은 게 분명해지는 날이었던 것 같다.",
        learned: [
            "Supabase",
            "PostgreSQL"
        ],
        emotion: "기대"
    },
    {
        date: "2026-08-02",
        summary: "사흘 만에 돌아와서 바로 코딩을 시작했다. 공백이 무색하게 금방 몰입했다.",
        learned: [
            "TypeScript"
        ],
        emotion: "반가움"
    },
    {
        date: "2026-07-30",
        summary: "여러 사이트를 오가며 산만한 하루. 이런 날도 있는 거다.",
        learned: [],
        emotion: "심심함"
    }
];
const skills = [
    {
        name: "TypeScript",
        domain: "programming",
        points: 82,
        useCount: 21,
        firstUsedAt: "2026-07-24",
        lastUsedAt: "2026-08-04"
    },
    {
        name: "Next.js",
        domain: "programming",
        points: 54,
        useCount: 12,
        firstUsedAt: "2026-07-26",
        lastUsedAt: "2026-08-04"
    },
    {
        name: "PostgreSQL",
        domain: "programming",
        points: 31,
        useCount: 6,
        firstUsedAt: "2026-07-28",
        lastUsedAt: "2026-08-03"
    },
    {
        name: "Drizzle",
        domain: "programming",
        points: 12,
        useCount: 2,
        firstUsedAt: "2026-08-04",
        lastUsedAt: "2026-08-04"
    },
    {
        name: "글쓰기",
        domain: "life",
        points: 24,
        useCount: 5,
        firstUsedAt: "2026-07-25",
        lastUsedAt: "2026-08-01"
    },
    {
        name: "요리",
        domain: "life",
        points: 8,
        useCount: 2,
        firstUsedAt: "2026-07-27",
        lastUsedAt: "2026-07-31"
    }
];
const personalityAxes = [
    {
        key: "focus_scatter",
        left: "몰입형",
        right: "산만형"
    },
    {
        key: "depth_breadth",
        left: "집중형",
        right: "멀티형"
    },
    {
        key: "finish_explore",
        left: "완결형",
        right: "탐색형"
    },
    {
        key: "pioneer_master",
        left: "개척형",
        right: "숙련형"
    },
    {
        key: "night_morning",
        left: "새벽형",
        right: "아침형"
    }
];
const personalityHistory = [
    {
        computedAt: "2026-07-27",
        values: {
            focus_scatter: 22,
            depth_breadth: 10,
            finish_explore: -18,
            pioneer_master: 35,
            night_morning: 48
        },
        sampleSize: 14
    },
    {
        computedAt: "2026-08-03",
        values: {
            focus_scatter: 41,
            depth_breadth: 18,
            finish_explore: -8,
            pioneer_master: 51,
            night_morning: 62
        },
        sampleSize: 31
    }
];
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1hjjkvh._.js.map