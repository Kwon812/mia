"use client";

// ============================================================
// 후보 하나 — 절차로 만들지 사람이 답한다.
//
// 코드가 답할 수 없는 질문이 하나 남는다: **자동화할 값어치가 있나.**
// 반복 횟수도 단계 수도 무엇을 바꾸는지도 전부 관측에서 나오지만, 귀찮음은
// 관측되지 않는다. 클릭 열두 번짜리인데 재밌어할 수도 있고 세 번짜리인데
// 하기 싫어 미룰 수도 있다.
//
// 그래서 화면이 판단 근거를 다 내놓아야 한다. 「몇 번 했다」는 사실이고
// 「매번 몇 분 걸린다」가 이유다 — 승인을 정할 때 실제로 보는 것은 뒤쪽이다.
// ============================================================

import { useState, useTransition } from "react";

import type { Candidate } from "@/lib/procedure";

type Answer = {
  status: "approved" | "rejected";
  name: string | null;
  /** 승인한 것에만 있다. 실패했으면 없다 — 곁들이지 본체가 아니다. */
  skillMd?: string | null;
} | null;
type Result = { ok: true } | { ok: false; error: string };

function dur(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

export function ProcedureCard({
  candidate,
  answer,
  ymd,
  onApprove,
  onReject,
  onForget,
}: {
  candidate: Candidate;
  /** 이미 답한 것이면 그 답. 아니면 null. */
  answer: Answer;
  /** 서버에서 KST 로 찍어 넘긴다 — 클라이언트 시간대에 안 휘둘리게. */
  ymd: { first: string; last: string };
  onApprove: (
    signature: string,
    name: string,
    steps: unknown,
    mutates: boolean,
    stats: { runs: number; medianSec: number },
  ) => Promise<Result>;
  onReject: (signature: string) => Promise<Result>;
  onForget: (signature: string) => Promise<Result>;
}) {
  const c = candidate;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<Result>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else setNaming(false);
    });
  }

  return (
    <div className="border-l border-[rgba(160,185,220,0.14)] pl-4">
      <div className="tick mb-2">
        {c.runs}번 · 매번 {dur(c.medianSec)} · {c.steps.length}단계
        {c.mutates && " · 바꿈"}
        {answer?.status === "approved" && (
          <span className="ml-2 text-[#63e6d2]">절차 — {answer.name}</span>
        )}
        {answer?.status === "rejected" && <span className="ml-2 text-lum-4">안 만듦</span>}
      </div>

      <ol className="flex flex-col gap-1">
        {c.steps.map((s, i) => (
          <li
            key={`${c.signature}-${i}`}
            className="flex items-baseline gap-2 text-[13.5px] text-lum-1"
          >
            <span className="readout w-4 shrink-0 text-right text-[11.5px] text-lum-4">
              {i + 1}
            </span>
            <span className="readout shrink-0 text-[11.5px] text-lum-4">{s.domain}</span>
            <span className="min-w-0 flex-1 truncate">{s.label ?? s.sel ?? s.tag}</span>
            {/* 매개변수는 실행할 때 물어볼 자리다. 입력값을 안 남기니 무엇을
                넣었는지는 모르고 넣을 자리라는 것만 안다 — 오히려 그게 맞다.
                지난달 값이 박혀 있으면 그건 버그다. */}
            {c.paramIdx.includes(i) && (
              <span className="readout shrink-0 text-[11px] text-lum-3">매번 다름</span>
            )}
            {s.mut && <span className="readout shrink-0 text-[11px] text-[#e0c090]">바꿈</span>}
          </li>
        ))}
      </ol>

      <div className="readout mt-2 text-[11.5px] text-lum-4">
        {ymd.first} 처음
        {ymd.last !== ymd.first && ` · ${ymd.last} 마지막`}
      </div>

      {answer ? (
        <>
          {/* 설명은 접어둔다. 목록은 무엇이 있는지 훑는 자리라 본문이 펼쳐져
              있으면 다음 절차가 화면 밖으로 밀린다. */}
          {answer.skillMd && (
            <details className="mt-3">
              <summary className="readout cursor-pointer text-[12px] text-lum-3 transition-colors hover:text-lum-1">
                설명 보기
              </summary>
              <pre className="readout mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-sm border border-[rgba(160,185,220,0.12)] p-3 text-[12px] leading-relaxed text-lum-2">
                {answer.skillMd}
              </pre>
            </details>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => onForget(c.signature))}
            className="readout mt-2 text-[11.5px] text-lum-4 transition-colors hover:text-lum-2"
          >
            다시 정하기
          </button>
        </>
      ) : naming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이 일을 뭐라고 부를까"
            autoFocus
            disabled={pending}
            className="readout min-w-0 flex-1 rounded-sm border border-[rgba(160,185,220,0.16)] bg-transparent px-2 py-1 text-[12.5px] text-lum-0 outline-none placeholder:text-lum-4 focus:border-[rgba(160,185,220,0.4)]"
          />
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() =>
              run(() =>
                onApprove(c.signature, name, c.steps, c.mutates, {
                  runs: c.runs,
                  medianSec: c.medianSec,
                }),
              )
            }
            className="readout shrink-0 rounded-sm border border-[rgba(99,230,210,0.3)] px-2 py-1 text-[12.5px] text-lum-1 transition-colors hover:border-[rgba(99,230,210,0.6)] hover:text-lum-0 disabled:opacity-40"
          >
            만들기
          </button>
          <button
            type="button"
            onClick={() => setNaming(false)}
            className="readout shrink-0 text-[11.5px] text-lum-4 transition-colors hover:text-lum-2"
          >
            그만
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="readout rounded-sm border border-[rgba(160,185,220,0.18)] px-2 py-1 text-[12px] text-lum-2 transition-colors hover:border-[rgba(160,185,220,0.4)] hover:text-lum-0"
          >
            절차로 만들기
          </button>
          {/* 「아니야」의 문턱이 낮아야 한다. 틀린 제안은 한 번 누르면 끝이고
              놓친 절차는 아예 안 보인다 — 그래서 후보를 넉넉히 올리는 대신
              거절이 쉬워야 균형이 맞는다. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => onReject(c.signature))}
            className="readout text-[12px] text-lum-4 transition-colors hover:text-lum-2"
          >
            아니야
          </button>
        </div>
      )}

      {error && <p className="readout mt-2 text-[12px] text-[#e0a0a0]">{error}</p>}
    </div>
  );
}
