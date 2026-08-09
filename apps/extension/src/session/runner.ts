// ============================================================
// 절차 실행 — 승인된 단계를 브라우저에서 되돌린다.
//
// 왜 확장이 하나. 그 절차는 **로그인된 상태**를 전제로 한다. 별도 프로그램은
// 매번 다시 로그인해야 하고, 로그인 폼은 봇 탐지가 제일 촘촘한 자리다.
// 이미 로그인된 브라우저 안에서 도는 것이 유일하게 성립하는 길이다.
//
// ── 상태를 왜 서비스 워커가 드나 ──
//
// 절차는 페이지 이동을 넘는다(supabase → docs.google). content script 는
// 이동할 때마다 죽고 새로 주입되므로 진행 상태를 못 들고 있는다. 서비스
// 워커도 MV3 라 수시로 잠들지만, 저장소에 두면 깨어나서 이어받는다.
//
// ── 왜 시간이 아니라 요소를 기다리나 ──
//
// 녹화 때 잰 dt 를 그대로 재생하면 네트워크가 느린 날 실패하고 빠른 날
// 헛되이 기다린다. dt 는 **얼마나 기다릴 각오를 할지**의 상한으로만 쓰고,
// 실제로는 셀렉터가 나타날 때까지 짧게 되풀이해 찾는다.
// ============================================================

/** 실행 명세의 한 단계. 웹이 승인 시점의 steps 를 그대로 넘긴다. */
export interface RunStep {
  domain: string;
  sel?: string;
  label?: string;
  tag: string;
  mut: boolean;
  dt: number;
  isInput: boolean;
}

/** 어느 단계 뒤에 무엇을 확인하는가. 사람이 승인할 때 짚어준 것이다. */
export interface RunRead {
  /** 이 인덱스의 단계를 마친 뒤에 읽는다 */
  after: number;
  sel: string;
  label: string;
}

export interface RunState {
  id: string;
  name: string;
  steps: RunStep[];
  /** 다음에 할 단계 */
  index: number;
  /** 입력 단계에 넣을 값. 사람이 실행 전에 채운다 — 녹화 때 값을 안 남기기
   *  때문이다. 지난달 값이 박혀 있는 것보다 매번 묻는 쪽이 맞다. */
  params: Record<number, string>;
  startedAt: number;
  /** 무엇이 잘못됐나. 있으면 멈춘 것이다. */
  error?: string;
  /** 끝난 시각. 있으면 더 진행하지 않는다. */
  doneAt?: number;
  /** 확인할 것들. 관측에서 안 나오는 값이라 사람이 짚어준다. */
  reads?: RunRead[];
  /** 읽어낸 값. 절차가 끝나면 이게 결과다 — 네 군데를 열어보는 대신
   *  한 화면에 모이는 것이 이 자동화의 값어치 대부분이다. */
  results?: { label: string; value: string }[];
}

const KEY = 'na_run';

/** 한 단계에 이만큼 못 찾으면 포기한다. dt 가 길었던 단계는 더 준다. */
export const STEP_TIMEOUT_MS = 15_000;
/** 전체가 이보다 오래 끌면 멈춘다 — 어딘가에서 조용히 맴돌고 있다는 뜻이다. */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

export async function getRun(): Promise<RunState | null> {
  const got = await chrome.storage.local.get(KEY);
  const r = got[KEY] as RunState | undefined;
  if (!r) return null;
  // 오래 묵은 것은 없는 셈 친다. 브라우저를 껐다 켜면 이어갈 이유가 없고,
  // 남아 있으면 엉뚱한 날 엉뚱한 페이지에서 갑자기 클릭이 일어난다.
  if (Date.now() - r.startedAt > RUN_TIMEOUT_MS) {
    await clearRun();
    return null;
  }
  return r;
}

export async function setRun(r: RunState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: r });
}

export async function clearRun(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

/**
 * 이 도메인에서 지금 할 단계가 있나.
 *
 * 도메인이 안 맞으면 아무것도 주지 않는다 — 절차가 supabase 를 기다리는데
 * 유튜브에서 클릭이 일어나면 안 된다. 사람이 절차 도중에 다른 탭을 봐도
 * 안전한 이유가 이것이다.
 */
export function stepFor(run: RunState, host: string): { step: RunStep; index: number } | null {
  if (run.doneAt || run.error) return null;
  const step = run.steps[run.index];
  if (!step) return null;
  // 포트까지 맞춘다. localhost:3000 과 localhost:3100 은 다른 프로젝트다.
  if (step.domain !== host) return null;
  return { step, index: run.index };
}

/** 이 단계를 마친 뒤에 읽을 것이 있나. */
export function readsAfter(run: RunState, index: number): RunRead[] {
  return (run.reads ?? []).filter((r) => r.after === index);
}

/** 한 단계가 끝났다. 성공이면 다음으로, 실패면 멈춘다. */
export async function advance(
  ok: boolean,
  error?: string,
  /** 그 단계에서 읽어낸 값들 */
  got?: { label: string; value: string }[],
): Promise<RunState | null> {
  const run = await getRun();
  if (!run) return null;
  if (got && got.length > 0) run.results = [...(run.results ?? []), ...got];
  if (!ok) {
    // 멈추되 지우지는 않는다 — 사람이 무엇이 왜 안 됐는지 봐야 한다.
    // 절반쯤 진행된 채로 멈춘 것 자체가 중요한 정보다.
    run.error = error ?? '알 수 없는 이유로 멈췄어';
    await setRun(run);
    return run;
  }
  run.index += 1;
  if (run.index >= run.steps.length) run.doneAt = Date.now();
  await setRun(run);
  return run;
}
