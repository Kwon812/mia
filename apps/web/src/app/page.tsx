import { redirect } from "next/navigation";
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { dialogues, experienceSkills, experiences, memories, questions, sessions } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { getCurrentDialogueSlot, getKstDayBoundary, kstDaysTogether, DAY_MS } from "@/lib/date";
import { deriveEmotion, type EmotionExperienceInput, type EmotionSkillInput } from "@/lib/emotion";
import { effective, loadCorrections } from "@/lib/corrections";
import { NameForm } from "@/components/name-form";
import { MapStage } from "./map-stage";
import type { AskQuestion } from "@/components/ask-card";
import type { Body, MemoryBody } from "@/components/orbital-map";

// 감정 파생에 넣는 최근 경험 표본 크기 (계획서 06장)
const EMOTION_SAMPLE_SIZE = 5;

// 지도에 올리는 천체 수 상한. 이보다 많아지면 안쪽이 뭉개져 판독이 안 된다.
const MAX_BODIES = 220;

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  // 아직 이름이 없다 — 계는 있는데 중심에 이름이 없는 상태.
  if (!user.character.name) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="settle flex flex-col items-center">
          <span className="mb-8 h-2 w-2 rounded-full bg-lum-0 shadow-[0_0_24px_6px_rgba(200,230,255,.5)]" />
          <p className="utterance mb-10 text-[19px]">…</p>
          <span className="tick mb-6">중심에 이름이 없다</span>
          <NameForm />
        </div>
      </main>
    );
  }

  const dayBoundary = getKstDayBoundary();
  const daysTogether = kstDaysTogether(user.createdAt);
  const slot = getCurrentDialogueSlot();

  const [dialogueRows, expRows, memoryRows, todaySessionRows, recentExperienceRows] =
    await Promise.all([
      db
        .select({ text: dialogues.text })
        .from(dialogues)
        .where(and(eq(dialogues.userId, user.userId), eq(dialogues.slot, slot)))
        .limit(1),
      db
        .select({
          id: experiences.id,
          summary: experiences.summary,
          occurredAt: experiences.occurredAt,
          outcome: experiences.outcome,
          category: experiences.category,
          memoryScore: experiences.memoryScore,
          threadId: experiences.threadId,
          isFirstTime: experiences.isFirstTime,
        })
        .from(experiences)
        .where(eq(experiences.userId, user.userId))
        .orderBy(desc(experiences.occurredAt))
        .limit(MAX_BODIES),
      db
        .select({
          id: memories.id,
          title: memories.title,
          body: memories.body,
          importance: memories.importance,
          trigger: memories.trigger,
          occurredAt: memories.occurredAt,
          threadId: memories.threadId,
          experienceId: memories.experienceId,
          forgottenAt: memories.forgottenAt,
        })
        .from(memories)
        .where(eq(memories.userId, user.userId)),
      db
        .select({ durationMin: sessions.durationMin })
        .from(sessions)
        .where(and(eq(sessions.userId, user.userId), gte(sessions.startedAt, dayBoundary))),
      db
        .select()
        .from(experiences)
        .where(eq(experiences.userId, user.userId))
        .orderBy(desc(experiences.occurredAt))
        .limit(EMOTION_SAMPLE_SIZE),
    ]);

  // 새 탭 진입 시 LLM 호출 없음(계획서 09장) — 캐시된 대사만 읽는다.
  const dialogueText = dialogueRows[0]?.text ?? "…";

  // ── 감정 파생(계획서 06장) ──
  const recentExpIds = recentExperienceRows.map((e) => e.id);
  const recentSkillRows =
    recentExpIds.length > 0
      ? await db
          .select({
            experienceId: experienceSkills.experienceId,
            skillName: experienceSkills.skillName,
          })
          .from(experienceSkills)
          .where(inArray(experienceSkills.experienceId, recentExpIds))
      : [];

  const skillNamesByExperience = new Map<string, string[]>();
  for (const row of recentSkillRows) {
    const list = skillNamesByExperience.get(row.experienceId) ?? [];
    list.push(row.skillName);
    skillNamesByExperience.set(row.experienceId, list);
  }

  // 사람이 고친 판정을 겹친다. 이게 없으면 /diary 에서 "이건 막힌 게 아니라
  // 해낸 거야"라고 세 건을 고쳐도 홈의 캐릭터는 계속 답답해한다
  // (emotion.ts 의 stuck 3연속 규칙이 원본 outcome 을 본다). 고쳐도 아무것도
  // 안 달라지면 아무도 안 누르고, 그러면 declared 가 쌓이지 않는다.
  const homeCorrections = await loadCorrections([
    ...new Set([...recentExperienceRows.map((e) => e.id), ...expRows.map((e) => e.id)]),
  ]);

  const emotionExperiences: EmotionExperienceInput[] = recentExperienceRows.map((e) => ({
    occurredAt: e.occurredAt,
    outcome: effective(homeCorrections, e.id, "outcome", e.outcome),
    isFirstTime:
      effective(homeCorrections, e.id, "is_first_time", String(e.isFirstTime)) === "true",
    skillNames: skillNamesByExperience.get(e.id) ?? [],
  }));

  const latestExperience = recentExperienceRows[0];
  const latestSkillNames = latestExperience
    ? (skillNamesByExperience.get(latestExperience.id) ?? [])
    : [];

  const skillsBeforeLatest: EmotionSkillInput[] = [];
  if (latestExperience && latestSkillNames.length > 0) {
    // user_skills 의 lastUsedAt 은 이미 이 경험으로 갱신돼 간격이 0이 된다.
    // 이력에서 "이 경험보다 이전" 사용 시각을 직접 찾아야 재등장이 판정된다.
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

  // ── 궤도 요소로 넘길 형태 ──
  const memoryByExp = new Map(memoryRows.map((m) => [m.experienceId, m.forgottenAt]));
  const now = Date.now();
  const bodies: Body[] = expRows.map((e) => ({
    id: e.id,
    summary: e.summary,
    occurredAt: e.occurredAt.getTime(),
    ageDays: Math.max(0, (now - e.occurredAt.getTime()) / DAY_MS),
    outcome: effective(homeCorrections, e.id, "outcome", e.outcome),
    category: effective(homeCorrections, e.id, "category", e.category),
    memoryScore: e.memoryScore,
    threadId: e.threadId,
    isFirstTime:
      effective(homeCorrections, e.id, "is_first_time", String(e.isFirstTime)) === "true",
    remembered: memoryByExp.has(e.id),
    forgotten: memoryByExp.get(e.id) != null,
  }));

  // 기억이 참조하는 경험들. memories 는 experience_id 하나만 직접 가리키지만,
  // thread_id 가 있으면 그 작업에 속한 경험 전부가 이 기억의 근거다 —
  // 'thread_complete' 기억은 특히 한 경험이 아니라 그 작업 전체를 가리킨다.
  // 이미 불러온 expRows 안에서 찾으므로 추가 쿼리가 없다(그 대신 220건 상한
  // 바깥의 오래된 경험은 위성으로 나타나지 않는다 — 알려진 한계).
  const moons: MemoryBody[] = memoryRows
    .filter((m) => m.forgottenAt == null)
    .map((m) => {
      const referenced = expRows.filter(
        (e) => e.id === m.experienceId || (m.threadId != null && e.threadId === m.threadId),
      );
      return {
        id: m.id,
        threadId: m.threadId,
        title: m.title,
        body: m.body,
        importance: m.importance,
        trigger: m.trigger,
        occurredAt: m.occurredAt.getTime(),
        ageDays: Math.max(0, (now - m.occurredAt.getTime()) / DAY_MS),
        referencedIds: referenced.map((e) => e.id),
        sourceId: m.experienceId,
      };
    });

  const todayMinutes = todaySessionRows.reduce((sum, s) => sum + s.durationMin, 0);

  // 층 2 — 오늘 캐릭터가 물을 것. **읽기만 한다.**
  // 질문 생성은 야간 배치(apps/batch/src/jobs/daily-questions.ts)가 한다 —
  // 여기서 만들면 서버 컴포넌트가 렌더마다 쓰기를 하게 되고, "하루 1건"이라는
  // 예산을 사용자의 새로고침 횟수가 좌우하게 된다.
  const [openQuestion] = await db
    .select({ id: questions.id, field: questions.field, text: questions.text })
    .from(questions)
    .where(
      and(
        eq(questions.userId, user.userId),
        isNull(questions.answeredAt),
        isNull(questions.dismissedAt),
      ),
    )
    .orderBy(desc(questions.askedAt))
    .limit(1);

  const question: AskQuestion | null = openQuestion
    ? { id: openQuestion.id, field: openQuestion.field, text: openQuestion.text }
    : null;

  return (
    <MapStage
      bodies={bodies}
      memories={moons}
      name={user.character.name}
      level={user.character.level}
      daysTogether={daysTogether}
      emotion={emotion.label}
      emotionReason={emotion.reason}
      dialogue={dialogueText}
      counts={{
        experience: user.character.experienceCount,
        skill: user.character.skillCount,
        memory: user.character.memoryCount,
      }}
      todayMinutes={todayMinutes}
      todaySessions={todaySessionRows.length}
      question={question}
    />
  );
}
