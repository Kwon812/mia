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
  /** 얼린 단계. 다시 집어 고친 셀렉터가 여기 있다 — 후보 계산에는 없다. */
  steps?: { domain: string; sel?: string; label?: string; tag: string; mut: boolean; dt: number; isInput: boolean }[];
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
  onRepoint,
  onDropStep,
  onRepointRead,
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
  /** 깨진 단계를 다시 짚는다. 얼린 steps 를 사람이 알고 고치는 길이다. */
  onRepoint?: (
    signature: string,
    index: number,
    sel: string,
    label: string,
  ) => Promise<Result>;
  /** 있어선 안 될 단계를 뺀다. 다시 집어도 안 고쳐지는 것 — 그 자리에
   *  있어야 할 것이 애초에 없는 경우다. */
  onDropStep?: (signature: string, index: number) => Promise<Result>;
  /** 확인 자리를 다시 짚는다. 읽기가 단계보다 자주 깨진다 — 단계는 대개
   *  버튼이라 이름이라도 남지만 값은 숫자라 기댈 이름이 없다. */
  onRepointRead?: (
    signature: string,
    readIndex: number,
    sel: string,
    label: string,
  ) => Promise<Result>;
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
  /** 진행 중인 집기를 접는 손잡이. 결과가 안 돌아와도 잠기지 않게 한다. */
  const [cancelPick, setCancelPick] = useState<() => void>(() => () => {});

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

  /**
   * 그 도메인의 탭을 열고 확장이 집기 모드를 켠다. 사람이 클릭한 자리의
   * 셀렉터가 돌아온다 — 개발자도구 요소 선택기와 같은 방식이다.
   *
   * 결과를 받는 길이 **둘**이다. 확장이 직접 밀어주는 것과, 여기서 가지러
   * 가는 것. 하나만 두면 한 군데라도 어긋날 때 조용히 잠긴 채로 남는다 —
   * 사람 눈에는 확인을 눌렀는데 아무 일도 안 일어난 것으로 보인다.
   *
   * 밀어준 것에는 `after` 가 없다. 확장은 어느 단계를 집는 중이었는지 모르고
   * 알 필요도 없다 — 한 번에 하나만 집으므로 지금 진행 중인 것이 그것이다.
   */
  function pick(after: number, domain: string) {
    setPicking(after);
    setError(null);

    let timer: number | undefined;
    const cleanup = () => {
      window.clearInterval(timer);
      window.removeEventListener("message", onMsg);
      setPicking(null);
    };

    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      // 밀어준 것(push)에는 after 가 없으므로 그건 통과시킨다.
      if (!e.data?.push && e.data?.after !== after) return;

      // 시작 응답 — 다리가 살아 있다는 뜻. 여기서부터는 사람 속도라 안 잰다.
      if (e.data.__na === "pick-started") {
        if (!e.data.ok) {
          cleanup();
          setError(e.data.error ?? "확장이 응답하지 않아. 확장을 새로고침해줘.");
        }
        return;
      }

      if (e.data.__na !== "pick-ack" || !e.data.done) return;
      cleanup();
      if (!e.data.ok || !e.data.sel) {
        setError("집기를 그만뒀어");
        return;
      }
      setReads((v) => [
        ...v.filter((r) => r.after !== after),
        { after, sel: e.data.sel, label: e.data.sample || `${domain} 값` },
      ]);
    };

    window.addEventListener("message", onMsg);
    setCancelPick(() => cleanup);
    timer = window.setInterval(() => {
      window.postMessage({ __na: "pick-poll", after }, "*");
    }, 700);
    const url = domain.startsWith("localhost") ? `http://${domain}` : `https://${domain}`;
    window.postMessage({ __na: "pick", after, url }, "*");
  }

  /**
   * 깨진 자리를 다시 짚는다. 단계든 읽기든 같은 길을 쓰고, 잡은 것을
   * 어디에 쓸지만 다르다.
   */
  function repointAt(
    slot: number,
    domain: string,
    apply: (sel: string, sample: string) => Promise<Result>,
  ) {
    if (!domain) return;
    setPicking(slot);
    setError(null);

    let timer: number | undefined;
    const cleanup = () => {
      window.clearInterval(timer);
      window.removeEventListener("message", onMsg);
      setPicking(null);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      if (!e.data?.push && e.data?.after !== slot) return;
      if (e.data.__na === "pick-started") {
        if (!e.data.ok) {
          cleanup();
          setError(e.data.error ?? "확장이 응답하지 않아");
        }
        return;
      }
      if (e.data.__na !== "pick-ack" || !e.data.done) return;
      cleanup();
      if (!e.data.ok || !e.data.sel) return;
      startTransition(async () => {
        const r = await apply(e.data.sel, e.data.sample ?? "");
        if (!r.ok) setError(r.error);
        else setLive(null); // 고쳤으니 멈춘 자리를 지운다 — 다시 돌리면 된다
      });
    };

    window.addEventListener("message", onMsg);
    setCancelPick(() => cleanup);
    timer = window.setInterval(() => {
      window.postMessage({ __na: "pick-poll", after: slot }, "*");
    }, 700);
    const url = domain.startsWith("localhost") ? `http://${domain}` : `https://${domain}`;
    window.postMessage({ __na: "pick", after: slot, url }, "*");
  }

  function repoint(index: number) {
    if (!onRepoint) return;
    repointAt(index, c.steps[index]?.domain ?? "", (sel, sample) =>
      onRepoint(c.signature, index, sel, sample),
    );
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
          // 후보 계산이 아니라 **승인 때 얼린 것**을 돌린다. 다시 집어 고친
          // 셀렉터가 거기 있고, 후보 쪽에는 없다.
          steps: answer?.steps ?? c.steps,
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
              <>
                <span className="readout text-[12px] text-[#e0a0a0]">
                  {live.index + 1}단계에서 멈췄어 — {live.error}
                </span>
                {/* 셀렉터는 깨진다. 사이트가 화면을 바꾸면 그 자리를 못 찾는데,
                    그때마다 절차를 처음부터 다시 만들게 하면 쓸 수가 없다.
                    멈춘 자리에서 바로 다시 집는다. */}
                {onRepoint && (
                  <button
                    type="button"
                    disabled={picking !== null}
                    onClick={() => repoint(live.index)}
                    className="readout rounded-sm border border-[rgba(160,185,220,0.24)] px-2 py-1 text-[12px] text-lum-1 transition-colors hover:border-[rgba(160,185,220,0.5)] hover:text-lum-0 disabled:opacity-40"
                  >
                    {picking === live.index ? "저 창에서 집어줘…" : "이 단계 다시 집기"}
                  </button>
                )}
                {/* 다시 집어도 안 고쳐지는 것이 있다 — 그 자리에 있어야 할
                    것이 애초에 없는 경우다. 추출이 스친 클릭을 끼워 넣기도
                    한다: 지나가다 누른 것이 마침 두 번 반복되면 절차의
                    일부로 보인다. */}
                {onDropStep && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const i = live.index;
                      startTransition(async () => {
                        const r = await onDropStep(c.signature, i);
                        if (!r.ok) setError(r.error);
                        else setLive(null);
                      });
                    }}
                    className="readout text-[12px] text-lum-4 transition-colors hover:text-lum-2"
                  >
                    이 단계 빼기
                  </button>
                )}
              </>
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

          {/* 확인 자리. 여기가 깨지면 절차는 성공했는데 정작 보려던 것이
              없는 상태가 된다 — 값은 숫자라 기댈 이름이 없어서 단계보다 자주
              깨진다. 그 자리에서 다시 집는다. */}
          {onRepointRead && (answer.reads?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-col gap-0.5">
              {answer.reads!.map((r, i) => (
                <div key={`rd-${i}`} className="flex items-baseline gap-2 text-[12px]">
                  <span className="readout w-4 shrink-0 text-right text-lum-4">
                    {r.after + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lum-2" title={r.sel}>
                    {r.label}
                    <span className="ml-2 text-[11px] text-lum-4">{r.sel}</span>
                  </span>
                  <button
                    type="button"
                    disabled={picking !== null || pending}
                    onClick={() =>
                      repointAt(r.after, c.steps[r.after]?.domain ?? "", (sel, sample) =>
                        onRepointRead(c.signature, i, sel, sample),
                      )
                    }
                    className="readout shrink-0 text-lum-4 transition-colors hover:text-lum-2 disabled:opacity-40"
                  >
                    {picking === r.after ? "집는 중…" : "다시 집기"}
                  </button>
                </div>
              ))}
            </div>
          )}

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
                    {/* 무엇을 어떻게 잡았는지 둘 다 보여준다. 라벨만 보면
                        옆칸을 집었어도 그럴듯해 보이고, 셀렉터가 nth-child
                        범벅이면 화면이 조금만 바뀌어도 깨진다는 뜻이다. */}
                    <span className="min-w-0 flex-1 truncate text-lum-1" title={got.sel}>
                      {got.label}
                      <span className="ml-2 text-[11px] text-lum-4">{got.sel}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setReads((v) => v.filter((r) => r.after !== i))}
                      className="readout shrink-0 text-lum-4 hover:text-lum-2"
                    >
                      빼기
                    </button>
                  </>
                ) : picking === i ? (
                  // 진행 중인 것은 그만둘 수 있어야 한다. 결과가 안 돌아오면
                  // 이 상태로 잠기는데, 예전에는 **다른 집기까지 비활성**돼서
                  // 화면 전체가 먹통처럼 보였다.
                  <button
                    type="button"
                    onClick={() => cancelPick()}
                    className="readout shrink-0 text-lum-3 transition-colors hover:text-lum-0"
                  >
                    집는 중… (누르면 그만)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => pick(i, s.domain)}
                    className="readout shrink-0 text-lum-3 transition-colors hover:text-lum-0"
                  >
                    집기
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
