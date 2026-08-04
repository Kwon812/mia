import { CharacterAvatar } from "@/components/character-avatar";
import { Dialogue } from "@/components/dialogue";
import { Card, MonoLabel } from "@/components/card";
import {
  character,
  currentDialogue,
  todaySessions,
  todayExperiences,
  type Outcome,
} from "@/lib/mock";

// 세션 시간 표기 — 서버 로케일과 무관하게 KST 24시간제로 고정.
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

function formatTimeRange(startedAt: string, endedAt: string): string {
  return `${formatTime(startedAt)}–${formatTime(endedAt)}`;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  success: "성공",
  partial: "부분",
  stuck: "정체",
  explore: "탐색",
};

const OUTCOME_STYLE: Record<Outcome, string> = {
  success: "bg-live-bg text-live",
  explore: "border border-rule text-sub",
  partial: "border border-rule text-sub",
  stuck: "border border-rule text-faint",
};

export default function Home() {
  const dialogue = currentDialogue();

  return (
    <div className="flex flex-col items-center">
      {/* 캐릭터 스테이지 */}
      <section className="flex flex-col items-center pt-4">
        <CharacterAvatar size={160} />
        <div className="mt-4 flex items-baseline gap-2">
          <h1 className="text-[19px] font-semibold tracking-tight">
            {character.name}
          </h1>
          <span className="font-mono text-[12px] text-sub">
            LV.{character.level} · 함께한 지 {character.daysTogether}일
          </span>
        </div>
        <span className="mt-2.5 rounded-sm bg-live-bg px-2 py-0.5 font-mono text-[11px] text-live">
          {character.emotion.label}
        </span>
      </section>

      {/* 오늘의 대사 */}
      <section className="mt-6 max-w-[30rem] text-center">
        <Dialogue text={dialogue} size="lg" />
      </section>

      {/* 상태 요약 스트립 */}
      <section className="mt-10 flex w-full max-w-sm items-center justify-around border-t border-b border-rule py-4">
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-[20px] leading-none">
            {character.experienceCount}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
            경험
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-[20px] leading-none">
            {character.skillCount}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
            스킬
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-[20px] leading-none">
            {character.memoryCount}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
            기억
          </span>
        </div>
      </section>

      {/* 오늘 섹션 */}
      <section className="mt-12 w-full">
        <MonoLabel>TODAY</MonoLabel>
        <div className="mt-3 flex flex-col gap-3">
          {todaySessions.map((session) => (
            <Card key={session.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[12px] text-faint">
                  {formatTimeRange(session.startedAt, session.endedAt)}
                </span>
                {session.tags.includes("scattered") && (
                  <span className="rounded-sm border border-rule bg-paper px-1.5 py-0.5 font-mono text-[10px] text-sub">
                    산만
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-[15px] font-medium">
                  {session.title}
                </span>
                <span className="text-[13px] text-sub">
                  {session.category}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* 오늘의 경험 */}
      <section className="mt-10 w-full">
        <MonoLabel>오늘의 경험</MonoLabel>
        <div className="mt-3 flex flex-col gap-3">
          {todayExperiences.map((exp) => (
            <Card key={exp.id}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14.5px] leading-relaxed">{exp.summary}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {exp.isFirstTime && (
                    <span className="rounded-sm bg-live-bg px-1.5 py-0.5 font-mono text-[10px] text-live">
                      첫 시도
                    </span>
                  )}
                  <span
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] ${OUTCOME_STYLE[exp.outcome]}`}
                  >
                    {OUTCOME_LABEL[exp.outcome]}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
