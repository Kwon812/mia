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
import { sessions } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd } from "@/lib/date";
import { findProcedures, looksLikeOscillation, stepsOf } from "@/lib/procedure";
import { Head, Shell, Empty } from "@/components/shell";

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
              {found.map((c) => (
                <div key={c.signature} className="border-l border-[rgba(160,185,220,0.14)] pl-4">
                  {/* 「몇 번」은 사실이고 「매번 몇 분」이 이유다 — 자동화할
                      값어치를 재는 것은 뒤쪽이다. */}
                  <div className="tick mb-2">
                    {c.runs}번 · 매번 {dur(c.medianSec)} · {c.steps.length}단계
                    {c.mutates && " · 바꿈"}
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
                        <span className="readout shrink-0 text-[11.5px] text-lum-4">
                          {s.domain}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {s.label ?? s.sel ?? s.tag}
                        </span>
                        {/* 매개변수는 실행할 때 물어볼 자리다. 입력값을 안 남기니
                            무엇을 넣었는지는 모르고, 넣을 자리라는 것만 안다 —
                            오히려 그게 맞다. 지난달 값이 박혀 있으면 그건 버그다. */}
                        {c.paramIdx.includes(i) && (
                          <span className="readout shrink-0 text-[11px] text-lum-3">
                            매번 다름
                          </span>
                        )}
                        {s.mut && (
                          <span className="readout shrink-0 text-[11px] text-[#e0c090]">바꿈</span>
                        )}
                      </li>
                    ))}
                  </ol>

                  <div className="readout mt-2 text-[11.5px] text-lum-4">
                    {formatKstYmd(c.firstAt)} 처음
                    {c.lastAt.getTime() !== c.firstAt.getTime() &&
                      ` · ${formatKstYmd(c.lastAt)} 마지막`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
