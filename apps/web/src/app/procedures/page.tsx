// ============================================================
// 반복된 절차 — 관측에서 캐낸 것.
//
// /skills 와 다른 것이다. 저쪽은 LLM 이 경험에서 뽑은 **스킬 이름**(React,
// Docker)이고 여기는 **조작의 열**이다. 저쪽은 "무엇을 다룰 줄 아는가"를,
// 여기는 "어떤 순서로 하는가"를 말한다.
//
// 지금은 보여주기만 한다. 승인해서 실행 가능한 것으로 굳히는 일은 실데이터가
// 쌓인 뒤에 붙인다 — 무엇이 나오는지 보고 나서 문턱과 화면을 정하려는
// 것이고, 그게 감으로 정하지 않는 유일한 방법이다.
// ============================================================

import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { procedures, sessions } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd } from "@/lib/date";
import { digest, findProcedures, looksLikeOscillation, stepsOf } from "@/lib/procedure";
import { Head, Shell, Empty } from "@/components/shell";
import { ProcedureCard } from "@/components/procedure-card";
import {
  approveProcedure,
  forgetProcedureAnswer,
  rejectProcedure,
  repointProcedureStep,
  dropProcedureStep,
  repointProcedureRead,
  guessApiForDomain,
} from "@/app/actions";

/** 훑을 세션 수. 절차는 몇 주에 걸쳐 반복되므로 최근 것만 봐서는 안 잡힌다. */
const SCAN_LIMIT = 400;

function dur(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

export default async function ProceduresPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  const rows = await db
    .select({
      id: sessions.id,
      startedAt: sessions.startedAt,
      compressedLog: sessions.compressedLog,
    })
    .from(sessions)
    .where(eq(sessions.userId, user.userId))
    .orderBy(desc(sessions.startedAt))
    .limit(SCAN_LIMIT);

  const withActs = rows.filter((r) => stepsOf(r.compressedLog).length > 0);
  const totalSteps = rows.reduce((n, r) => n + stepsOf(r.compressedLog).length, 0);

  // 계산은 매번 새로 한다. 색인을 따로 두지 않는 이유 — 조작 15만 개까지는
  // 수백 밀리초라 이 화면을 여는 동안 끝나고, 캐시 무효화 버그가 계산 비용보다
  // 비싸다. 느려지면 그때 만든다.
  const all = totalSteps > 0 ? findProcedures(rows) : [];
  const found = all.filter((c) => !looksLikeOscillation(c));
  // 무엇이 쌓이고 있나. 후보가 0개일 때 "없다" 만 말하면 도는 중인지
  // 고장인지 알 수 없다.
  const dg = totalSteps > 0 ? digest(rows, found) : null;

  // 사람이 이미 답한 것. 거절한 후보는 목록에서 내리고, 승인한 것은 위에 남긴다.
  const answered = new Map(
    (
      await db
        .select({
          signature: procedures.signature,
          status: procedures.status,
          name: procedures.name,
          skillMd: procedures.skillMd,
          reads: procedures.reads,
          steps: procedures.steps,
        })
        .from(procedures)
        .where(eq(procedures.userId, user.userId))
    ).map((r) => [
      r.signature,
      {
        status: r.status,
        name: r.name,
        skillMd: r.skillMd,
        reads: (r.reads ?? []) as { after: number; sel: string; label: string }[],
        steps: (r.steps ?? []) as never,
      },
    ]),
  );

  // 승인 → 아직 안 물은 것 → 거절 순. 거절한 것도 아주 감추지는 않는다 —
  // 마음이 바뀌었을 때 되돌릴 자리가 있어야 하고, 무엇을 이미 봤는지가
  // 보여야 같은 것을 두 번 고민하지 않는다.
  const rank = (sig: string) => {
    const a = answered.get(sig);
    return a?.status === "approved" ? 0 : a?.status === "rejected" ? 2 : 1;
  };
  const ordered = [...found].sort((x, y) => rank(x.signature) - rank(y.signature));

  return (
    <Shell>
      <Head
        tick="PROCEDURES · 되풀이"
        title="반복한 일"
        note="같은 순서를 두 번 이상 되풀이한 것. 도메인과 제목이 어디 있었나를 말한다면 이건 무엇을 했나다."
      />

      {totalSteps === 0 ? (
        <Empty>
          아직 조작이 안 쌓였어.
          <br />
          확장을 새로고침하고 며칠 쓰면 여기 뭔가 잡히기 시작해.
        </Empty>
      ) : (
        <>
          <div className="mb-8 flex flex-col gap-1.5">
            <p className="readout text-[12.5px] text-lum-3">
              세션 {dg?.withActs ?? 0}개 · 조작 {totalSteps}개에서 찾았어
              {(dg?.oscillations ?? 0) > 0 && ` · 오가기만 한 것 ${dg!.oscillations}개는 뺐어`}
            </p>
            {/* 어디서 얼마나. 무엇을 주로 하는지가 여기 드러나고, 관측이
                제대로 도는지도 한눈에 보인다. */}
            {dg && dg.byDomain.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {dg.byDomain.map((d) => (
                  <span key={d.domain} className="readout text-[11.5px] text-lum-4">
                    {d.domain} <span className="text-lum-3">{d.n}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {found.length === 0 && (dg?.once.length ?? 0) === 0 ? (
            <Empty>
              두 번 이상 되풀이한 순서가 아직 없어.
              <br />
              같은 일을 한 번 더 하면 잡혀.
            </Empty>
          ) : (
            <div className="flex flex-col gap-8">
              {ordered.map((c) => (
                <ProcedureCard
                  key={c.signature}
                  candidate={c}
                  answer={answered.get(c.signature) ?? null}
                  ymd={{ first: formatKstYmd(c.firstAt), last: formatKstYmd(c.lastAt) }}
                  onApprove={approveProcedure}
                  onReject={rejectProcedure}
                  onForget={forgetProcedureAnswer}
                  onRepoint={repointProcedureStep}
                  onDropStep={dropProcedureStep}
                  onRepointRead={repointProcedureRead}
                  onGuessApi={guessApiForDomain}
                />
              ))}
            </div>
          )}

          {/* **아직 한 번뿐인 것.** 되풀이하면 후보가 된다.
              후보가 0개일 때 "없다" 만 보여주면 이게 도는 중인지 고장인지
              알 수 없다. 무엇이 쌓이고 있는지가 보여야 기다릴 수 있다. */}
          {dg && dg.once.length > 0 && (
            <div className="mt-14">
              <div className="tick mb-1">아직 한 번뿐</div>
              <p className="readout mb-5 text-[12px] text-lum-4">
                한 번 더 하면 절차로 올라와. 지금은 그냥 지나간 순서야.
              </p>
              <div className="flex flex-col gap-5">
                {dg.once.map((c) => (
                  <div
                    key={c.signature}
                    className="border-l border-[rgba(160,185,220,0.08)] pl-4 opacity-70"
                  >
                    <div className="tick mb-1.5">
                      1번 · {c.steps.length}단계
                      {c.mutates && " · 바꿈"}
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px] text-lum-2">
                      {c.steps.map((s, i) => (
                        <span key={i} className="flex items-baseline gap-1">
                          {i > 0 && <span className="text-lum-4">→</span>}
                          <span className="readout text-[11px] text-lum-4">{s.domain}</span>
                          <span className="truncate">{s.label ?? s.sel ?? s.tag}</span>
                          {s.mut && <span className="text-[10.5px] text-[#e0c090]">바꿈</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* **무엇을 했나.** 절차가 아직 안 잡혀도 관측이 도는 것은 여기서
              보인다. 도메인이 바뀌는 자리로 끊어 읽으면 하루의 모양이 나온다. */}
          {dg && dg.flows.length > 0 && (
            <div className="mt-14">
              <div className="tick mb-1">무엇을 했나</div>
              <p className="readout mb-5 text-[12px] text-lum-4">
                조작이 잡힌 세션들. 자리를 옮길 때마다 한 토막이야.
              </p>
              <div className="flex flex-col gap-4">
                {dg.flows.map((f, i) => (
                  <div key={i} className="border-l border-[rgba(160,185,220,0.08)] pl-4">
                    <div className="tick mb-1.5">{formatKstYmd(f.at)}</div>
                    <div className="flex flex-col gap-0.5">
                      {f.legs.map((leg, j) => (
                        <div key={j} className="flex items-baseline gap-2 text-[12px]">
                          <span className="readout w-8 shrink-0 text-right text-lum-4">
                            {leg.n}
                          </span>
                          <span className="readout w-40 shrink-0 truncate text-lum-3">
                            {leg.domain}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-lum-4">{leg.sample}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
