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
import { findProcedures, looksLikeOscillation, stepsOf } from "@/lib/procedure";
import { Head, Shell, Empty } from "@/components/shell";
import { ProcedureCard } from "@/components/procedure-card";
import { approveProcedure, forgetProcedureAnswer, rejectProcedure } from "@/app/actions";

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
  const oscillations = all.length - found.length;

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
          <p className="readout mb-6 text-[12.5px] text-lum-3">
            세션 {withActs.length}개 · 조작 {totalSteps}개에서 찾았어
            {oscillations > 0 && ` · 오가기만 한 것 ${oscillations}개는 뺐어`}
          </p>

          {found.length === 0 ? (
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
                />
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
