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
  results?: { label: string; value: string; wrong?: string }[];
} | null;

/** 어느 단계 뒤에 무엇을 확인하는가. 관측에서 안 나온다 — 클릭은 기록돼도
 *  본 것은 기록되지 않아서(눈은 이벤트를 안 만든다) 사람이 짚어줘야 한다. */
type Read = {
  after: number;
  sel: string;
  /** 셀렉터 후보들. 앞에서부터 시도한다 — 하나만 두면 깨지는 순간 끝이다. */
  sels?: string[];
  /** 값 옆의 변하지 않는 글자. 값은 변해도 이름은 남는다. */
  anchor?: string;
  label: string;
  path?: string;
  /** API 로 읽는 자리. 있으면 실행할 때 화면을 안 연다 — 셀렉터도 렌더링
   *  타이밍도 상관없다. 집을 때 값이 응답 어디 있는지 찾아 여기 적어둔다. */
  api?: { service: string; probe: string; path: string };
  /** **엿들어 알아낸 요청.** 그 화면이 스스로 부른 API 라, 엔드포인트를
   *  미리 알 필요도 키를 받을 필요도 없다 — 세션 쿠키로 그대로 다시 부른다. */
  net?: { url: string; method: string; body?: string; path: string };
};

/** 그 화면이 아는 서비스인가. 확장이 알려준다. */
type ApiInfo = {
  known: boolean;
  service?: string;
  label?: string;
  keyHint?: string;
  keyUrl?: string;
  hasKey?: boolean;
};

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

/** 모르는 사이트의 API 를 물어본 답. 그대로 믿지 않고 두드려본 뒤에 쓴다. */
type GuessResult =
  | { known: false }
  | {
      known: true;
      label: string;
      base: string;
      probes: string[];
      auth: "bearer" | "header" | "none";
      authHeader?: string;
      keyUrl?: string;
      keyHint?: string;
    };

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
  onGuessApi,
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
    extra: { path?: string; sels?: string[] },
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
    extra: { path?: string; sels?: string[]; anchor?: string },
  ) => Promise<Result>;
  /** 모르는 사이트의 API 를 물어본다. 엿듣기가 실패했을 때만 부른다 —
   *  답은 그대로 믿지 않고 확장이 호출해서 검증한 뒤에 쓴다. */
  onGuessApi?: (domain: string) => Promise<GuessResult>;
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
  /** 단계별로 그 화면이 아는 서비스인지. 키 입력란을 그릴지 정한다. */
  const [apiInfo, setApiInfo] = useState<Record<number, ApiInfo>>({});
  /** 절차를 만들 때 넣는 키. **로컬에만 간다** — 서버로 안 보낸다.
   *  도메인으로 잡는다. 예전에는 서비스 id 와 섞여 있어서, 넣은 키를 다른
   *  자리에서 못 찾았다. */
  const [keys, setKeys] = useState<Record<string, string>>({});
  /** 키가 있어야 되는 자리. 401 이 와야 뜬다 — 미리 요구하지 않는다. */
  const [needKey, setNeedKey] = useState<Record<number, { domain: string; keyUrl?: string; hint?: string }>>({});
  /** 집은 값이 API 에 있나. 집는 그 자리에서 갈린다. */
  const [matching, setMatching] = useState<number | null>(null);
  const [matchNote, setMatchNote] = useState<Record<number, string>>({});

  /**
   * 모르는 사이트의 API 를 물어보고 **두드려본다.**
   *
   * 모델이 지어낼 수 있다. 그래서 답을 그대로 저장하지 않는다 — 확장이
   * 실제로 호출해서 집은 값이 그 응답에 있는지 확인한 뒤에만 쓴다.
   * 환각은 그 자리에서 드러난다.
   */
  function askGuess(slot: number, domain: string, picked: string) {
    if (!onGuessApi) return;
    setMatching(slot);
    setMatchNote((v) => ({ ...v, [slot]: "이 사이트 API 를 알아보는 중…" }));
    startTransition(async () => {
      const g = await onGuessApi(domain);
      if (!g.known) {
        setMatching(null);
        setMatchNote((v) => ({
          ...v,
          [slot]: "이 사이트의 공개 API 는 모른대. 화면에서 읽을게.",
        }));
        return;
      }
      setMatchNote((v) => ({ ...v, [slot]: `${g.label} API 를 두드려보는 중…` }));

      const onMsg = (e: MessageEvent) => {
        if (e.source !== window || e.data?.__na !== "try-guess-ack" || e.data.slot !== slot) return;
        window.removeEventListener("message", onMsg);
        setMatching(null);
        if (!e.data.ok) {
          setMatchNote((v) => ({ ...v, [slot]: e.data.error }));
          // 인증이 막은 것이면 그때 키를 받는다. 대시보드가 쓰는 문과 공개
          // API 의 문이 다를 때가 있고, 그건 두드려봐야 안다.
          if (/401|403|로그인/.test(String(e.data.error)) && g.auth !== "none") {
            setNeedKey((v) => ({
              ...v,
              [slot]: { domain, keyUrl: g.keyUrl, hint: g.keyHint },
            }));
          }
          return;
        }
        setNeedKey((v) => {
          const { [slot]: _gone, ...rest } = v;
          return rest;
        });
        setReads((v) =>
          v.map((r) =>
            r.after === slot
              ? { ...r, net: { url: e.data.url, method: "GET", path: e.data.path } }
              : r,
          ),
        );
        let where = e.data.url;
        try {
          where = new URL(e.data.url).pathname;
        } catch {
          /* 그대로 둔다 */
        }
        setMatchNote((v) => ({ ...v, [slot]: `API 로 가져와 — ${where} · ${e.data.path}` }));
      };
      window.addEventListener("message", onMsg);
      window.postMessage(
        { __na: "try-guess", slot, guess: g, key: keys[domain] ?? "", picked },
        "*",
      );
    });
  }

  // 이름 짓기를 펼치면 각 화면이 아는 서비스인지 물어본다.
  useEffect(() => {
    if (!naming) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.__na !== "api-info-ack") return;
      setApiInfo((v) => ({ ...v, [e.data.slot]: e.data as ApiInfo }));
    };
    window.addEventListener("message", onMsg);
    c.steps.forEach((s, i) =>
      window.postMessage({ __na: "api-info", slot: i, domain: s.domain }, "*"),
    );
    return () => window.removeEventListener("message", onMsg);
  }, [naming, c.steps]);

  /**
   * 집은 값이 API 응답 어디에 있는지 찾는다.
   *
   * 찾으면 그 자리는 화면을 안 보고 API 로 읽는다 — 셀렉터가 깨질 일도,
   * 탭이 뜰 일도 없다. 못 찾으면 그 자리에서 말한다: 이 값은 화면에만
   * 있다고. 돌려보고 나서 아는 게 아니다.
   */
  /**
   * 엿들은 응답에서 집은 값을 찾는다.
   *
   * 확장이 그 화면의 API 호출을 이미 잡아뒀다. 집은 값이 그 안에 있으면
   * 그 자리는 화면을 안 보고 그 요청을 다시 불러 읽는다 — 셀렉터도, 탭도,
   * 렌더링 타이밍도 상관없어진다.
   */
  function askNet(slot: number) {
    setMatching(slot);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.__na !== "net-match-ack" || e.data.slot !== slot) return;
      window.removeEventListener("message", onMsg);
      setMatching(null);
      const hit = e.data.ok ? e.data.hits?.[0] : null;
      if (!hit) {
        // **왜 못 찾았는지 갈라서 말한다.** 이 화면이 API 를 아예 안 부르는
        // 것과, 부르긴 하는데 그 값이 응답에 없는 것은 다음 수가 다르다.
        const seen: string[] = e.data.seen ?? [];
        // **가까운 값들.** "그 값이 없어" 만으로는 다음에 뭘 할지 모르는데,
        // 응답에 1.8823 이 있는 걸 보면 자릿수 문제인지 애초에 다른 데서
        // 오는 값인지가 바로 눈에 들어온다.
        const near: string[] = e.data.near ?? [];
        const picked = String(e.data.picked ?? reads.find((r) => r.after === slot)?.label ?? "");
        const why =
          e.data.why === "nothing-caught"
            ? "이 화면은 API 를 안 불러 (엿들은 게 0개). 화면에서 읽을게 — 확장을 새로고침했다면 그 탭도 한 번 새로고침해줘."
            : e.data.why === "not-in-response"
              ? // 0 은 일부러 안 맞춘다 — 응답에 0 은 널려 있어서 우연히 맞는
                // 자리가 수십 개다. 그걸 저장하면 값이 생겼을 때 엉뚱한 데를
                // 읽는다. 그 사정을 그대로 말해준다.
                /(^|\s)0(\s|$)|^\D*0\D*$/.test(picked)
                ? "값이 0 이라 API 에서 못 맞춰 — 0 은 응답에 널려 있어서 엉뚱한 자리를 잡을 수 있어. 값이 생겼을 때 다시 집으면 돼. 지금은 화면에서 읽을게."
                : `API ${seen.length}곳을 봤는데 그 값이 없어 (${seen.slice(0, 2).join(", ")}).` +
                  (near.length > 0 ? ` 가까운 값: ${near.slice(0, 3).join(", ")}` : "") +
                  " 화면에서 읽을게."
              : "값을 찾을 자리가 없었어 — 다시 집어봐.";
        setMatchNote((v) => ({ ...v, [slot]: why }));
        // 엿듣기가 실패했으면 물어본다. 이 화면이 SSR 로 값을 주는 경우가
        // 그렇고, 그때도 그 서비스에 공개 API 가 있을 수 있다.
        //
        // 다만 **엿듣기가 되는데 값만 못 찾은 것이면 안 묻는다.** 그 화면의
        // API 는 이미 손에 있고, 거기 없는 값은 다른 API 에도 없다 —
        // 물어봐야 호출만 한 번 더 태운다.
        const domain = c.steps[slot]?.domain ?? "";
        if (onGuessApi && picked && domain && e.data.why === "nothing-caught") {
          askGuess(slot, domain, picked);
        }
        return;
      }
      setReads((v) =>
        v.map((r) =>
          r.after === slot
            ? {
                ...r,
                net: { url: hit.url, method: hit.method, body: hit.body, path: hit.path },
              }
            : r,
        ),
      );
      // 어디서 가져오는지 보여준다. 긴 URL 은 경로만 — 어느 API 인지만 알면 된다.
      let where = hit.url;
      try {
        where = new URL(hit.url).pathname;
      } catch {
        /* 그대로 둔다 */
      }
      setMatchNote((v) => ({ ...v, [slot]: `API 로 가져와 — ${where} · ${hit.path}` }));
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ __na: "net-match", slot }, "*");
  }

  function tryApi(slot: number, domain: string, picked: string) {
    const info = apiInfo[slot];
    const key = keys[domain] ?? "";
    if (!info?.known) return;
    setMatching(slot);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.__na !== "api-match-ack" || e.data.slot !== slot) return;
      window.removeEventListener("message", onMsg);
      setMatching(null);
      if (!e.data.ok || !e.data.matches?.length) {
        setMatchNote((v) => ({ ...v, [slot]: e.data.error ?? "응답에서 그 값을 못 찾았어" }));
        return;
      }
      const m = e.data.matches[0];
      setReads((v) =>
        v.map((r) =>
          r.after === slot
            ? { ...r, api: { service: e.data.service, probe: m.probe, path: m.path } }
            : r,
        ),
      );
      setMatchNote((v) => ({ ...v, [slot]: `API 로 가져올 수 있어 — ${m.path}` }));
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ __na: "api-match", slot, domain, key, picked }, "*");
  }

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
      if (!e.data.ok) {
        setError("집기를 그만뒀어");
        return;
      }
      // 셀렉터를 못 만든 채로 확인이 온 경우. 예전에는 이걸 '그만뒀어' 로
      // 뭉뚱그려서, 사람은 분명히 확인을 눌렀는데 아무 일도 안 일어난 것으로
      // 보였다. 왜 안 됐는지는 말해줘야 다음 수를 고를 수 있다.
      if (!e.data.sel) {
        setError("그 자리를 짚지 못했어. 감싸는 칸이나 옆의 이름표를 집어봐.");
        return;
      }
      setReads((v) => [
        ...v.filter((r) => r.after !== after),
        // 경로를 같이 들고 간다. 승인할 때 이 값이 그 단계에 실린다 —
        // 읽기는 이동하지 않고 단계가 데려다 놓은 화면에서 읽는다.
        {
          after,
          sel: e.data.sel,
          sels: e.data.sels ?? undefined,
          anchor: e.data.anchor ?? undefined,
          label: e.data.sample || `${domain} 값`,
          path: e.data.path,
        },
      ]);
      // 집자마자 **엿들은 것에서 먼저 찾는다.** 그 화면이 스스로 부른 API 라
      // 엔드포인트를 몰라도 되고 키도 안 받는다. 없으면 그때 등록된 서비스를
      // 두드려보고, 그것도 없으면 화면에서 읽는다.
      askNet(after);
      void ([] as unknown[]).push(...[
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
    apply: (sel: string, sample: string, extra: Partial<Read>) => Promise<Result>,
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
        const r = await apply(e.data.sel, e.data.sample ?? "", {
          path: e.data.path ?? undefined,
          sels: e.data.sels ?? undefined,
          anchor: e.data.anchor ?? undefined,
        });
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
    repointAt(index, c.steps[index]?.domain ?? "", (sel, sample, x) =>
      onRepoint(c.signature, index, sel, sample, { path: x.path, sels: x.sels }),
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
                      repointAt(r.after, c.steps[r.after]?.domain ?? "", (sel, sample, x) =>
                        onRepointRead(c.signature, i, sel, sample, x),
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
                <div key={i} className="flex flex-col">
                  <div className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="readout shrink-0 text-lum-4">{r.label}</span>
                    <span
                      className={`min-w-0 flex-1 truncate ${r.wrong ? "text-lum-3" : "text-lum-0"}`}
                    >
                      {r.value}
                    </span>
                  </div>
                  {/* **왜 안 됐는지 적는다.** 로그인이 풀린 것과 자리가 바뀐
                      것과 요청이 잦아 막힌 것은 다음에 할 일이 전부 다르다. */}
                  {r.wrong && (
                    <span className="readout pl-2 text-[11px] text-[#e0a0a0]">{r.wrong}</span>
                  )}
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
          {/* 키 입력란은 여기 없다.
              **키는 대개 필요 없다.** 엿들은 요청은 세션 쿠키로 그대로 다시
              부르고, 물어본 API 도 쿠키가 통하는 곳이 많다. 필요한 것은
              대시보드가 쓰는 문과 공개 API 의 문이 다를 때뿐이다.
              그건 두드려봐야 알고, 401 이 왔을 때 그 자리에서 받는다 —
              미리 그리면 쓰지도 않을 키를 먼저 요구하는 셈이다. */}
          {c.steps.map((s, i) => {
            const got = reads.find((r) => r.after === i);
            return (
              // 한 단계가 두 줄이다 — 집은 자리와, 그것을 어디서 읽는지.
              <div key={`pick-${i}`} className="flex flex-col">
                <div className="flex items-baseline gap-2 text-[12px]">
                <span className="readout w-4 shrink-0 text-right text-lum-4">{i + 1}</span>
                <span className="readout w-32 shrink-0 truncate text-lum-4">{s.domain}</span>
                {got ? (
                  <>
                    {/* 무엇을 어떻게 잡았는지 둘 다 보여준다. 라벨만 보면
                        옆칸을 집었어도 그럴듯해 보이고, 셀렉터가 nth-child
                        범벅이면 화면이 조금만 바뀌어도 깨진다는 뜻이다. */}
                    <span className="min-w-0 flex-1 truncate text-lum-1" title={got.sel}>
                      {got.label}
                      {/* API 로 읽는 자리는 화면을 안 본다. 그게 보여야
                          이 절차가 탭을 열지 안 열지 미리 안다. */}
                      {got.net || got.api ? (
                        <span className="ml-2 text-[11px] text-[#63e6d2]">API</span>
                      ) : (
                        <span className="ml-2 text-[11px] text-lum-4">화면</span>
                      )}
                    </span>
                    {/* 화면에서 읽기로 정해진 자리도 다시 시도할 수 있다.
                        아는 서비스면 바로 두드리고(호출 0회), 모르면 물어본다. */}
                    {!got.api && !got.net && (
                      <button
                        type="button"
                        disabled={matching !== null || pending}
                        onClick={() =>
                          apiInfo[i]?.known
                            ? tryApi(i, s.domain, got.label)
                            : askGuess(i, s.domain, got.label)
                        }
                        className="readout shrink-0 text-lum-3 transition-colors hover:text-lum-0 disabled:opacity-40"
                      >
                        {matching === i ? "찾는 중…" : "API 로"}
                      </button>
                    )}
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
                {/* **집는 그 자리에서 갈린다.** API 로 가져올 수 있는지,
                    화면에서만 보이는 값인지 — 돌려보고 나서 아는 게 아니다.
                    API 로 가져오는 자리는 실행할 때 탭이 안 뜨고, 셀렉터가
                    깨질 일도 없다. */}
                {/* 키는 **필요해진 자리에만** 뜬다. 두드려봤더니 인증이
                    막았을 때뿐이다 — 미리 그리면 쓰지도 않을 키를 먼저
                    요구하게 된다. 이 값은 이 브라우저를 안 떠난다. */}
                {needKey[i] && (
                  <div className="flex flex-wrap items-center gap-2 pl-6 text-[12px]">
                    <input
                      type="password"
                      value={keys[needKey[i].domain] ?? ""}
                      onChange={(e) =>
                        setKeys((v) => ({ ...v, [needKey[i].domain]: e.target.value }))
                      }
                      placeholder={needKey[i].hint ?? "API 키"}
                      className="readout min-w-0 flex-1 rounded-sm border border-[rgba(160,185,220,0.16)] bg-transparent px-2 py-1 text-[12px] text-lum-0 outline-none placeholder:text-lum-4 focus:border-[rgba(160,185,220,0.4)]"
                    />
                    <button
                      type="button"
                      disabled={!keys[needKey[i].domain] || matching !== null}
                      onClick={() => askGuess(i, needKey[i].domain, got?.label ?? "")}
                      className="readout shrink-0 text-lum-1 transition-colors hover:text-lum-0 disabled:opacity-40"
                    >
                      다시 해보기
                    </button>
                    {needKey[i].keyUrl && (
                      <a
                        href={needKey[i].keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="readout shrink-0 text-lum-4 transition-colors hover:text-lum-2"
                      >
                        발급받기
                      </a>
                    )}
                  </div>
                )}
                {(matching === i || matchNote[i]) && (
                  <div
                    className={`readout truncate pl-6 text-[11px] ${
                      matchNote[i]?.startsWith("API") ? "text-[#63e6d2]" : "text-lum-4"
                    }`}
                  >
                    {matching === i ? "API 에 있나 보는 중…" : matchNote[i]}
                  </div>
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
