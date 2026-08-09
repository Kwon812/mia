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

import { useEffect, useState, useTransition } from "react";

import type { Candidate } from "@/lib/procedure";

/** 확장이 돌고 있는 절차의 상태. 다리(run-content.js)가 넘겨준다. */
type RunState = {
  id: string;
  name: string;
  index: number;
  steps: unknown[];
  error?: string;
  doneAt?: number;
  /** 읽어낸 값들. 절차가 끝나면 이게 결과다 — 네 군데를 열어보는 대신
   *  한 화면에 모이는 것이 이 자동화의 값어치 대부분이다. */
  results?: { label: string; value: string }[];
} | null;

/** 어느 단계 뒤에 무엇을 확인하는가. 관측에서 안 나온다 — 클릭은 기록돼도
 *  본 것은 기록되지 않아서(눈은 이벤트를 안 만든다) 사람이 짚어줘야 한다. */
type Read = { after: number; sel: string; label: string };

type Answer = {
  status: "approved" | "rejected";
  name: string | null;
  /** 승인한 것에만 있다. 실패했으면 없다 — 곁들이지 본체가 아니다. */
  skillMd?: string | null;
  /** 승인 때 짚어준 확인 자리. 실행할 때 이걸 읽어 온다. */
  reads?: Read[];
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
    reads: Read[],
  ) => Promise<Result>;
  onReject: (signature: string) => Promise<Result>;
  onForget: (signature: string) => Promise<Result>;
}) {
  const c = candidate;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 매개변수 값. 녹화에 안 남기므로 돌릴 때마다 받는다 — 지난달 값이 박혀
  // 있는 것보다 매번 묻는 쪽이 맞다.
  const [vals, setVals] = useState<Record<number, string>>({});
  const [asking, setAsking] = useState(false);
  const [live, setLive] = useState<RunState>(null);
  const [reads, setReads] = useState<Read[]>([]);
  const [picking, setPicking] = useState<number | null>(null);

  // 확장이 어디까지 갔는지 물어본다. 절차가 도는 동안 화면이 조용하면
  // 멈춘 건지 도는 건지 알 수 없다.
  useEffect(() => {
    if (!live || live.doneAt || live.error) return;
    const timer = setInterval(() => {
      window.postMessage({ __na: "run-status" }, "*");
    }, 1000);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.__na !== "run-status-ack") return;
      setLive(e.data.run ?? null);
    };
    window.addEventListener("message", onMsg);
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", onMsg);
    };
  }, [live]);

  /** 그 도메인의 탭을 열고 확장이 집기 모드를 켠다. 사람이 클릭한 자리의
   *  셀렉터가 돌아온다 — 개발자도구 요소 선택기와 같은 방식이다. */
  function pick(after: number, domain: string) {
    setPicking(after);
    setError(null);
    // 확장이 없거나 다리가 안 붙었으면 아무 답도 안 온다. 그러면 "저 창에서
    // 클릭해…" 가 영영 남아서, 사람은 창을 기다리는데 실은 아무 일도 일어나지
    // 않는 상태가 된다. 조용한 실패가 제일 나쁘다.
    // 집기는 사람이 화면을 옮겨 다니는 시간이 든다. 시한은 **다리가 붙었나**만
    // 재는 것이라 짧게 두면 안 된다 — 확장이 응답만 하면 그 뒤로는 사람 속도다.
    // 대신 창이 뜨면 다리는 살아 있는 것이므로, 그때부터는 안 재도 된다.
    const dead = setTimeout(() => {
      window.removeEventListener("message", onAck);
      setPicking(null);
      setError("확장이 응답하지 않아. 확장을 새로고침하고 이 페이지도 새로고침해줘.");
    }, 180_000);
    const onAck = (e: MessageEvent) => {
      if (e.source !== window || e.data?.__na !== "pick-ack" || e.data.after !== after) return;
      clearTimeout(dead);
      window.removeEventListener("message", onAck);
      setPicking(null);
      if (!e.data.ok || !e.data.sel) {
        setError(e.data.error ?? "집기가 취소됐어");
        return;
      }
      setReads((v) => [
        ...v.filter((r) => r.after !== after),
        { after, sel: e.data.sel, label: e.data.sample || `${domain} 값` },
      ]);
    };
    window.addEventListener("message", onAck);
    const url = domain.startsWith("localhost") ? `http://${domain}` : `https://${domain}`;
    window.postMessage({ __na: "pick", after, url }, "*");
  }

  function start() {
    setError(null);
    // 집기와 같은 이유로 시한을 둔다 — 확장이 없으면 아무 답도 안 오는데,
    // 그러면 버튼을 눌렀는데 아무 일도 안 일어난 것처럼 보인다.
    const dead = setTimeout(() => {
      window.removeEventListener("message", onAck);
      setError("확장이 응답하지 않아. 확장을 새로고침하고 이 페이지도 새로고침해줘.");
    }, 4000);
    const onAck = (e: MessageEvent) => {
      if (e.source !== window || e.data?.__na !== "run-ack") return;
      clearTimeout(dead);
      window.removeEventListener("message", onAck);
      if (!e.data.ok) setError(e.data.error ?? "확장이 응답하지 않아");
      else setLive({ id: c.signature, name: answer?.name ?? "", index: 0, steps: c.steps });
    };
    window.addEventListener("message", onAck);
    window.postMessage(
      {
        __na: "run",
        run: {
          id: c.signature,
          name: answer?.name ?? "",
          steps: c.steps,
          index: 0,
          params: vals,
          reads: answer?.reads ?? [],
          startedAt: Date.now(),
        },
      },
      "*",
    );
    setAsking(false);
  }

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
          {/* 돌리기 — 사람이 눌러야만 시작한다. 스스로 시작하는 길은 없다.
              바꾸는 조작이 든 절차를 사람 모르게 돌리면 틀렸다는 걸 아는
              시점이 이미 실행된 뒤다. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {live && !live.doneAt && !live.error ? (
              <span className="readout text-[12px] text-lum-2">
                도는 중 · {live.index + 1}/{c.steps.length}단계
              </span>
            ) : live?.error ? (
              <span className="readout text-[12px] text-[#e0a0a0]">
                {live.index + 1}단계에서 멈췄어 — {live.error}
              </span>
            ) : live?.doneAt ? (
              <span className="readout text-[12px] text-[#63e6d2]">다 됐어</span>
            ) : asking ? (
              <>
                {c.paramIdx.map((i) => (
                  <input
                    key={i}
                    value={vals[i] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [i]: e.target.value }))}
                    placeholder={`${i + 1}단계에 넣을 값`}
                    className="readout min-w-0 flex-1 rounded-sm border border-[rgba(160,185,220,0.16)] bg-transparent px-2 py-1 text-[12.5px] text-lum-0 outline-none placeholder:text-lum-4 focus:border-[rgba(160,185,220,0.4)]"
                  />
                ))}
                <button
                  type="button"
                  onClick={start}
                  className="readout shrink-0 rounded-sm border border-[rgba(99,230,210,0.3)] px-2 py-1 text-[12.5px] text-lum-1 transition-colors hover:border-[rgba(99,230,210,0.6)] hover:text-lum-0"
                >
                  시작
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  className="readout shrink-0 text-[11.5px] text-lum-4 transition-colors hover:text-lum-2"
                >
                  그만
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => (c.paramIdx.length > 0 ? setAsking(true) : start())}
                className="readout rounded-sm border border-[rgba(99,230,210,0.3)] px-2 py-1 text-[12px] text-lum-1 transition-colors hover:border-[rgba(99,230,210,0.6)] hover:text-lum-0"
              >
                돌려보기
                {c.mutates && <span className="ml-1 text-[#e0c090]">· 바꿈</span>}
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => onForget(c.signature))}
              className="readout ml-auto text-[11.5px] text-lum-4 transition-colors hover:text-lum-2"
            >
              다시 정하기
            </button>
          </div>

          {/* 모아 온 것. 네 군데를 열어보는 대신 여기 모이는 것이 이 자동화의
              값어치 대부분이다 — 이동만 자동화하면 4분이 3분이 될 뿐이다. */}
          {live?.results && live.results.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5 border-l border-[rgba(99,230,210,0.3)] pl-3">
              {live.results.map((r, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="readout shrink-0 text-lum-4">{r.label}</span>
                  <span className="min-w-0 flex-1 truncate text-lum-0">{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : naming ? (
        <div className="mt-3 flex flex-col gap-2">
          {/* 여기서 무엇을 확인하는지는 관측에 없다 — 클릭은 기록돼도 본 것은
              기록되지 않는다. 짚어주면 절차가 상태를 모아 오고, 안 짚으면
              이동만 자동화된다(네 군데를 열어주고 보는 건 여전히 사람이 한다). */}
          <div className="tick">여기서 뭘 확인해? (안 짚으면 이동만 한다)</div>
          {c.steps.map((s, i) => {
            const got = reads.find((r) => r.after === i);
            return (
              <div key={`pick-${i}`} className="flex items-baseline gap-2 text-[12px]">
                <span className="readout w-4 shrink-0 text-right text-lum-4">{i + 1}</span>
                <span className="readout w-32 shrink-0 truncate text-lum-4">{s.domain}</span>
                {got ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-lum-1">{got.label}</span>
                    <button
                      type="button"
                      onClick={() => setReads((v) => v.filter((r) => r.after !== i))}
                      className="readout shrink-0 text-lum-4 hover:text-lum-2"
                    >
                      빼기
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={picking !== null}
                    onClick={() => pick(i, s.domain)}
                    className="readout shrink-0 text-lum-3 transition-colors hover:text-lum-0 disabled:opacity-40"
                  >
                    {picking === i ? "저 창에서 집어줘…" : "집기"}
                  </button>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
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
                onApprove(
                  c.signature,
                  name,
                  c.steps,
                  c.mutates,
                  { runs: c.runs, medianSec: c.medianSec },
                  reads,
                ),
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
