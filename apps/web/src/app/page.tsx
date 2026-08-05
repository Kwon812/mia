import { redirect } from "next/navigation";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { dialogues, experienceSkills, experiences, sessions, type ExperienceOutcome } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { getCurrentDialogueSlot, getKstDayBoundary, formatKstTimeRange, DAY_MS } from "@/lib/date";
import { deriveEmotion, type EmotionExperienceInput, type EmotionSkillInput } from "@/lib/emotion";
import { CharacterAvatar } from "@/components/character-avatar";
import { Dialogue } from "@/components/dialogue";
import { Card, MonoLabel } from "@/components/card";
import { NameForm } from "@/components/name-form";
import { EmotionAura } from "@/components/emotion-aura";

// 감정 파생에 넣는 최근 경험 표본 크기 (계획서 06장)
const EMOTION_SAMPLE_SIZE = 5;

const OUTCOME_LABEL: Record<ExperienceOutcome, string> = {
  success: "성공",
  partial: "부분",
  stuck: "정체",
  explore: "탐색",
};

// 결과는 빛의 온도로 구분한다 — 성공은 따뜻하게, 탐색은 차갑게, 정체는 색 없이.
const OUTCOME_STYLE: Record<ExperienceOutcome, string> = {
  success: "chip chip-warm",
  explore: "chip chip-cool",
  partial: "chip text-sub",
  stuck: "chip text-faint",
};

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  // 연결은 됐지만 아직 이름이 없다 — Day 0. 다른 섹션은 전부 숨기고
  // 캐릭터 + "..." 말풍선 + 이름 입력 폼만 보여준다.
  if (!user.character.name) {
    return (
      <div className="flex flex-col items-center pt-2">
        <EmotionAura emotion="평온" />
        <CharacterAvatar size={160} />
        <div className="na-rise -mt-6 max-w-[22rem] text-center">
          <Dialogue text="..." size="lg" />
        </div>
        <NameForm />
      </div>
    );
  }

  const dayBoundary = getKstDayBoundary();
  const daysTogether = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);
  const slot = getCurrentDialogueSlot();

  const [dialogueRows, todaySessionRows, todayExperienceRows, recentExperienceRows] = await Promise.all([
    db
      .select({ text: dialogues.text })
      .from(dialogues)
      .where(and(eq(dialogues.userId, user.userId), eq(dialogues.slot, slot)))
      .limit(1),
    db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, user.userId), gte(sessions.startedAt, dayBoundary)))
      .orderBy(desc(sessions.startedAt)),
    db
      .select()
      .from(experiences)
      .where(and(eq(experiences.userId, user.userId), gte(experiences.occurredAt, dayBoundary)))
      .orderBy(desc(experiences.occurredAt)),
    db
      .select()
      .from(experiences)
      .where(eq(experiences.userId, user.userId))
      .orderBy(desc(experiences.occurredAt))
      .limit(EMOTION_SAMPLE_SIZE),
  ]);

  // 새 탭 진입 시 LLM 호출 없음(계획서 09장) — 캐시된 대사만 읽는다.
  // 아직 그 시간대 대사가 생성되지 않았으면 "..." — 갓 태어난 상태.
  const dialogueText = dialogueRows[0]?.text ?? "...";

  // ── 감정 파생(계획서 06장) — 최근 경험 5건 + 그중 가장 최신 경험이
  // 쓴 스킬들의 "재등장 직전" 사용 시각을 함께 구해 순수 함수에 넘긴다.
  const recentExpIds = recentExperienceRows.map((e) => e.id);
  const recentSkillRows =
    recentExpIds.length > 0
      ? await db
          .select({ experienceId: experienceSkills.experienceId, skillName: experienceSkills.skillName })
          .from(experienceSkills)
          .where(inArray(experienceSkills.experienceId, recentExpIds))
      : [];

  const skillNamesByExperience = new Map<string, string[]>();
  for (const row of recentSkillRows) {
    const list = skillNamesByExperience.get(row.experienceId) ?? [];
    list.push(row.skillName);
    skillNamesByExperience.set(row.experienceId, list);
  }

  const emotionExperiences: EmotionExperienceInput[] = recentExperienceRows.map((e) => ({
    occurredAt: e.occurredAt,
    outcome: e.outcome,
    isFirstTime: e.isFirstTime,
    skillNames: skillNamesByExperience.get(e.id) ?? [],
  }));

  const latestExperience = recentExperienceRows[0];
  const latestSkillNames = latestExperience ? (skillNamesByExperience.get(latestExperience.id) ?? []) : [];

  const skillsBeforeLatest: EmotionSkillInput[] = [];
  if (latestExperience && latestSkillNames.length > 0) {
    // user_skills 캐시의 lastUsedAt 은 이미 이 경험으로 갱신돼 간격이 0이 되므로
    // "재등장" 판정에 못 쓴다. 대신 experience_skills 이력에서 이 경험보다
    // 이전에 같은 스킬을 마지막으로 쓴 시각을 직접 찾는다.
    const priorUsageRows = await db
      .select({ skillName: experienceSkills.skillName, occurredAt: experiences.occurredAt })
      .from(experienceSkills)
      .innerJoin(experiences, eq(experiences.id, experienceSkills.experienceId))
      .where(
        and(
          eq(experiences.userId, user.userId),
          inArray(experienceSkills.skillName, latestSkillNames),
          lt(experiences.occurredAt, latestExperience.occurredAt),
        ),
      )
      .orderBy(desc(experiences.occurredAt));

    const seen = new Set<string>();
    for (const row of priorUsageRows) {
      if (seen.has(row.skillName)) continue;
      seen.add(row.skillName);
      skillsBeforeLatest.push({ skillName: row.skillName, lastUsedAt: row.occurredAt });
    }
  }

  const emotion = deriveEmotion(emotionExperiences, skillsBeforeLatest);

  return (
    <div className="flex flex-col items-center">
      {/* 감정이 화면 전체의 공기 색을 정한다 */}
      <EmotionAura emotion={emotion.label} />

      {/* 캐릭터 스테이지 — 유리가 아니라 빛. 이 화면에서 유일하게 패널이 없는 곳이다. */}
      <section className="flex flex-col items-center pt-2">
        <CharacterAvatar size={160} />
        <div className="na-rise -mt-7 flex flex-col items-center">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">
              {user.character.name}
            </h1>
            <span className="font-mono text-[12px] text-sub">
              LV.{user.character.level} · 함께한 지 {daysTogether}일
            </span>
          </div>
          <span
            className="chip chip-warm mt-3 px-2.5 py-0.5 font-mono text-[11px]"
            title={emotion.reason}
          >
            {emotion.label}
          </span>
        </div>
      </section>

      {/* 오늘의 대사 */}
      <section
        className="na-rise mt-7 max-w-[30rem] text-center"
        style={{ "--na-delay": "80ms" } as React.CSSProperties}
      >
        <Dialogue text={dialogueText} size="lg" />
      </section>

      {/* 상태 요약 — 떠 있는 유리 패널 3개 */}
      <section
        className="na-rise mt-10 grid w-full max-w-md grid-cols-3 gap-3"
        style={{ "--na-delay": "160ms" } as React.CSSProperties}
      >
        {[
          { value: user.character.experienceCount, label: "경험" },
          { value: user.character.skillCount, label: "스킬" },
          { value: user.character.memoryCount, label: "기억" },
        ].map((item) => (
          <div
            key={item.label}
            className="glass flex flex-col items-center gap-1.5 px-3 py-4"
          >
            <span className="font-mono text-[24px] leading-none tracking-tight">
              {item.value}
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
              {item.label}
            </span>
          </div>
        ))}
      </section>

      {/* 오늘 섹션 */}
      <section className="mt-14 w-full">
        <MonoLabel>TODAY</MonoLabel>
        <div className="mt-3.5 flex flex-col gap-3">
          {todaySessionRows.length === 0 ? (
            <p className="font-mono text-[12px] text-faint">
              아직 오늘 기록이 없어.
            </p>
          ) : (
            todaySessionRows.map((session, i) => (
              <Card key={session.id} delay={i * 60}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[12px] text-faint">
                    {formatKstTimeRange(session.startedAt, session.endedAt)}
                  </span>
                  {session.tags?.includes("scattered") && (
                    <span className="chip px-2 py-0.5 font-mono text-[10px] text-sub">
                      산만
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[15px] font-medium">
                    {session.primaryCategory}
                  </span>
                  <span className="font-mono text-[13px] text-sub">
                    {session.durationMin}분
                  </span>
                </div>
              </Card>
            ))
          )}
        </div>
      </section>

      {/* 오늘의 경험 */}
      <section className="mt-12 w-full">
        <MonoLabel>오늘의 경험</MonoLabel>
        <div className="mt-3.5 flex flex-col gap-3">
          {todayExperienceRows.length === 0 ? (
            <p className="font-mono text-[12px] text-faint">
              아직 오늘의 경험이 만들어지지 않았어.
            </p>
          ) : (
            todayExperienceRows.map((exp, i) => (
              <Card key={exp.id} accent={exp.isFirstTime} delay={i * 60}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14.5px] leading-relaxed">{exp.summary}</p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {exp.isFirstTime && (
                      <span className="chip chip-warm px-2 py-0.5 font-mono text-[10px]">
                        첫 시도
                      </span>
                    )}
                    {exp.outcome && (
                      <span
                        className={`px-2 py-0.5 font-mono text-[10px] ${OUTCOME_STYLE[exp.outcome]}`}
                      >
                        {OUTCOME_LABEL[exp.outcome]}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
