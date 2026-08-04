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
"[project]/apps/web/src/app/page.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$character$2d$avatar$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/character-avatar.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$dialogue$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/dialogue.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$card$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/card.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/mock.ts [app-rsc] (ecmascript)");
;
;
;
;
;
// 세션 시간 표기 — 서버 로케일과 무관하게 KST 24시간제로 고정.
function formatTime(iso) {
    return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Seoul"
    }).format(new Date(iso));
}
function formatTimeRange(startedAt, endedAt) {
    return `${formatTime(startedAt)}–${formatTime(endedAt)}`;
}
const OUTCOME_LABEL = {
    success: "성공",
    partial: "부분",
    stuck: "정체",
    explore: "탐색"
};
const OUTCOME_STYLE = {
    success: "bg-live-bg text-live",
    explore: "border border-rule text-sub",
    partial: "border border-rule text-sub",
    stuck: "border border-rule text-faint"
};
function Home() {
    const dialogue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currentDialogue"])();
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-col items-center",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "flex flex-col items-center pt-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$character$2d$avatar$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CharacterAvatar"], {
                        size: 160
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 47,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "mt-4 flex items-baseline gap-2",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                                className: "text-[19px] font-semibold tracking-tight",
                                children: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["character"].name
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 49,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-mono text-[12px] text-sub",
                                children: [
                                    "LV.",
                                    __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["character"].level,
                                    " · 함께한 지 ",
                                    __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["character"].daysTogether,
                                    "일"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 52,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 48,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "mt-2.5 rounded-sm bg-live-bg px-2 py-0.5 font-mono text-[11px] text-live",
                        children: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["character"].emotion.label
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 56,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/app/page.tsx",
                lineNumber: 46,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "mt-6 max-w-[30rem] text-center",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$dialogue$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Dialogue"], {
                    text: dialogue,
                    size: "lg"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/app/page.tsx",
                    lineNumber: 63,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/page.tsx",
                lineNumber: 62,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "mt-10 flex w-full max-w-sm items-center justify-around border-t border-b border-rule py-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex flex-col items-center gap-1",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-mono text-[20px] leading-none",
                                children: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["character"].experienceCount
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 69,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-mono text-[11px] uppercase tracking-[0.1em] text-faint",
                                children: "경험"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 72,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 68,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex flex-col items-center gap-1",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-mono text-[20px] leading-none",
                                children: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["character"].skillCount
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 77,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-mono text-[11px] uppercase tracking-[0.1em] text-faint",
                                children: "스킬"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 80,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 76,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex flex-col items-center gap-1",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-mono text-[20px] leading-none",
                                children: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["character"].memoryCount
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 85,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-mono text-[11px] uppercase tracking-[0.1em] text-faint",
                                children: "기억"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 88,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 84,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/app/page.tsx",
                lineNumber: 67,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "mt-12 w-full",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$card$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["MonoLabel"], {
                        children: "TODAY"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 96,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "mt-3 flex flex-col gap-3",
                        children: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["todaySessions"].map((session)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$card$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Card"], {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex items-baseline justify-between gap-3",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "font-mono text-[12px] text-faint",
                                                children: formatTimeRange(session.startedAt, session.endedAt)
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/app/page.tsx",
                                                lineNumber: 101,
                                                columnNumber: 17
                                            }, this),
                                            session.tags.includes("scattered") && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "rounded-sm border border-rule bg-paper px-1.5 py-0.5 font-mono text-[10px] text-sub",
                                                children: "산만"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/app/page.tsx",
                                                lineNumber: 105,
                                                columnNumber: 19
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/apps/web/src/app/page.tsx",
                                        lineNumber: 100,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "mt-1.5 flex items-baseline gap-2",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "text-[15px] font-medium",
                                                children: session.title
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/app/page.tsx",
                                                lineNumber: 111,
                                                columnNumber: 17
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "text-[13px] text-sub",
                                                children: session.category
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/app/page.tsx",
                                                lineNumber: 114,
                                                columnNumber: 17
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/apps/web/src/app/page.tsx",
                                        lineNumber: 110,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, session.id, true, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 99,
                                columnNumber: 13
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 97,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/app/page.tsx",
                lineNumber: 95,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "mt-10 w-full",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$card$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["MonoLabel"], {
                        children: "오늘의 경험"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 125,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "mt-3 flex flex-col gap-3",
                        children: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$mock$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["todayExperiences"].map((exp)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$card$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Card"], {
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex items-start justify-between gap-3",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                            className: "text-[14.5px] leading-relaxed",
                                            children: exp.summary
                                        }, void 0, false, {
                                            fileName: "[project]/apps/web/src/app/page.tsx",
                                            lineNumber: 130,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "flex shrink-0 items-center gap-1.5",
                                            children: [
                                                exp.isFirstTime && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: "rounded-sm bg-live-bg px-1.5 py-0.5 font-mono text-[10px] text-live",
                                                    children: "첫 시도"
                                                }, void 0, false, {
                                                    fileName: "[project]/apps/web/src/app/page.tsx",
                                                    lineNumber: 133,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: `rounded-sm px-1.5 py-0.5 font-mono text-[10px] ${OUTCOME_STYLE[exp.outcome]}`,
                                                    children: OUTCOME_LABEL[exp.outcome]
                                                }, void 0, false, {
                                                    fileName: "[project]/apps/web/src/app/page.tsx",
                                                    lineNumber: 137,
                                                    columnNumber: 19
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/apps/web/src/app/page.tsx",
                                            lineNumber: 131,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/apps/web/src/app/page.tsx",
                                    lineNumber: 129,
                                    columnNumber: 15
                                }, this)
                            }, exp.id, false, {
                                fileName: "[project]/apps/web/src/app/page.tsx",
                                lineNumber: 128,
                                columnNumber: 13
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/page.tsx",
                        lineNumber: 126,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/app/page.tsx",
                lineNumber: 124,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/app/page.tsx",
        lineNumber: 44,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/app/page.tsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/web/src/app/page.tsx [app-rsc] (ecmascript)"));
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
"[project]/apps/web/src/components/character-avatar.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// 캐릭터 본체. 말랑한 블롭 + 깜빡이는 눈.
// 감정별 표정 분화는 이후 작업 — 지금은 기본 표정 하나.
__turbopack_context__.s([
    "CharacterAvatar",
    ()=>CharacterAvatar
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
;
function CharacterAvatar({ size = 160 }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "na-float inline-block",
        style: {
            width: size,
            height: size
        },
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
            viewBox: "0 0 160 160",
            width: size,
            height: size,
            "aria-label": "캐릭터",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("defs", {
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("radialGradient", {
                        id: "na-body",
                        cx: "38%",
                        cy: "30%",
                        r: "80%",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                offset: "0%",
                                stopColor: "#fdf6ec"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                                lineNumber: 9,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                offset: "55%",
                                stopColor: "#f2dfc4"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                                lineNumber: 10,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                offset: "100%",
                                stopColor: "#e2b88a"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                                lineNumber: 11,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                        lineNumber: 8,
                        columnNumber: 11
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                    lineNumber: 7,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                    d: "M80 12\n             C 122 12 148 40 148 78\n             C 148 118 120 146 80 146\n             C 40 146 12 118 12 78\n             C 12 40 38 12 80 12 Z",
                    fill: "url(#na-body)",
                    stroke: "#141f28",
                    strokeWidth: "3"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                    lineNumber: 15,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                    className: "na-blink",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("ellipse", {
                            cx: "58",
                            cy: "76",
                            rx: "6.5",
                            ry: "9",
                            fill: "#141f28"
                        }, void 0, false, {
                            fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                            lineNumber: 27,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("ellipse", {
                            cx: "102",
                            cy: "76",
                            rx: "6.5",
                            ry: "9",
                            fill: "#141f28"
                        }, void 0, false, {
                            fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                            lineNumber: 28,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                            cx: "60.5",
                            cy: "72.5",
                            r: "2.2",
                            fill: "#fff"
                        }, void 0, false, {
                            fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                            lineNumber: 29,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                            cx: "104.5",
                            cy: "72.5",
                            r: "2.2",
                            fill: "#fff"
                        }, void 0, false, {
                            fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                            lineNumber: 30,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                    lineNumber: 26,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                    d: "M72 100 Q 80 106 88 100",
                    fill: "none",
                    stroke: "#141f28",
                    strokeWidth: "3",
                    strokeLinecap: "round"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                    lineNumber: 33,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                    cx: "44",
                    cy: "94",
                    r: "7",
                    fill: "#b4671f",
                    opacity: "0.22"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                    lineNumber: 41,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                    cx: "116",
                    cy: "94",
                    r: "7",
                    fill: "#b4671f",
                    opacity: "0.22"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/character-avatar.tsx",
                    lineNumber: 42,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true, {
            fileName: "[project]/apps/web/src/components/character-avatar.tsx",
            lineNumber: 6,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/character-avatar.tsx",
        lineNumber: 5,
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

//# sourceMappingURL=%5Broot-of-the-server%5D__0fg26xe._.js.map