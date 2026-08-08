import { redirect } from "next/navigation";
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import {
  dialogues,
  experienceSkills,
  experiences,
  memories,
  questions,
  sessions,
  threads,
} from "@na/db";
import { strongestTrigger } from "@na/shared";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { getCurrentDialogueSlot, getKstDayBoundary, kstDaysTogether, DAY_MS } from "@/lib/date";
import { deriveEmotion, type EmotionExperienceInput, type EmotionSkillInput } from "@/lib/emotion";
import { effective, loadCorrections } from "@/lib/corrections";
import { loadThreadMemories } from "@/lib/thread-memories";
import { NameForm } from "@/components/name-form";
import { RECENT_LIMIT } from "@/lib/recent";
import { MapStage } from "./map-stage";
import type { AskQuestion } from "@/components/ask-card";
import type { Body, ThreadBody } from "@/components/orbital-map";

// 감정 파생에 넣는 최근 경험 표본 크기 (계획서 06장)
const EMOTION_SAMPLE_SIZE = 5;

/**
 * 지도가 읽어오는 경험 수 상한.
 *
 * 경험은 천체가 아니라 별 안의 위성이라 이 값이 계의 모양을 정하지는 않는다.
 * 다만 **상한 밖의 경험은 어느 별에도 안 걸린다** — 당겨 들어가도 위성이 0개인
 * 별이 된다(판독값에 '경험 0건'으로 뜬다).
 *
 * 220 이었다. 갈래 화면(/threads)이 400 을 읽고 있었는데 그 화면을 없애면서
 * 여기가 유일한 지도가 됐으므로, 더 짧은 쪽에 맞추면 닿던 것이 안 닿는다.
 * 근본 해결은 상한을 없애고 위성 배치에 필요한 필드만 내려받는 것이다
 * (HANDOFF「안 끝난 것 2」) — 아직 안 아파서 미뤄뒀다.
 */
const MAX_BODIES = 400;

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  // 아직 이름이 없다 — 계는 있는데 중심에 이름이 없는 상태.
  if (!user.character.name) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="settle flex flex-col items-center">
          <span className="mb-8 h-2 w-2 rounded-full bg-lum-0 shadow-[0_0_24px_6px_rgba(200,230,255,.5)]" />
          <p className="utterance mb-10 text-[20px]">…</p>
          <span className="tick mb-6">중심에 이름이 없다</span>
          <NameForm />
        </div>
      </main>
    );
  }

  const dayBoundary = getKstDayBoundary();
  const daysTogether = kstDaysTogether(user.createdAt);
  const slot = getCurrentDialogueSlot();

  const [dialogueRows, expRows, memoryRows, todaySessionRows, recentExperienceRows, threadRows] =
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
          // 판독값의 끝 시각. 세션 길이가 아니라 이 경험에 귀속된 분이라
          // (나눴으면 그 몫만) 실제로 그 일이 차지한 구간과 같다.
          durationMin: experiences.durationMin,
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
          triggers: memories.triggers,
          occurredAt: memories.occurredAt,
          threadId: memories.threadId,
          experienceIds: memories.experienceIds,
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
      // 갈래 전부. 하나가 별 하나다 — 기억이 있으면 밝고 없으면 어둡다.
      // status 는 별의 선(이어짐/끊김)이 쓴다.
      db
        .select({
          id: threads.id,
          title: threads.title,
          category: threads.category,
          status: threads.status,
          experienceCount: threads.experienceCount,
          startedAt: threads.startedAt,
          completedAt: threads.completedAt,
        })
        .from(threads)
        .where(eq(threads.userId, user.userId))
        .orderBy(desc(threads.lastActivityAt)),
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
  // 경험 → 그 경험이 기억이 됐나(그리고 잊혔나). 기억 하나가 경험 여럿을
  // 품으므로 펼쳐서 넣는다.
  //
  // 잊혔는지와 **왜 남았는지**를 함께 싣는다. 좌하단 '최근 경험' 목록이
  // "기억에 붙음"만 적으면 무엇 때문에 남았는지가 안 보이는데, 그건 지도에서
  // 색온도로만 말하고 있던 값이라 글로도 한 번 적어야 둘이 이어진다.
  // 가장 센 이유 하나를 고르는 규칙(strongestTrigger)은 지도와 같은 것을 쓴다.
  const memoryByExp = new Map(
    memoryRows.flatMap((m) =>
      m.experienceIds.map(
        (id) =>
          [id, { forgottenAt: m.forgottenAt, trigger: strongestTrigger(m.triggers, m.trigger) }] as const,
      ),
    ),
  );
  const now = Date.now();
  const bodies: Body[] = expRows.map((e) => ({
    id: e.id,
    summary: e.summary,
    occurredAt: e.occurredAt.getTime(),
    ageDays: Math.max(0, (now - e.occurredAt.getTime()) / DAY_MS),
    outcome: effective(homeCorrections, e.id, "outcome", e.outcome),
    category: effective(homeCorrections, e.id, "category", e.category),
    memoryScore: e.memoryScore,
    durationMin: e.durationMin,
    threadId: e.threadId,
    isFirstTime:
      effective(homeCorrections, e.id, "is_first_time", String(e.isFirstTime)) === "true",
    remembered: memoryByExp.has(e.id),
    forgotten: memoryByExp.get(e.id)?.forgottenAt != null,
    memoryTrigger: memoryByExp.get(e.id)?.trigger ?? null,
  }));

  const liveMemories = memoryRows.filter((m) => m.forgottenAt == null);

  // ── 갈래를 계에 올린다 ──
  //
  // **갈래 하나가 별 하나다.** 기억은 따로 안 뜨고 그 별의 광도·색온도로
  // 얹힌다 — 갈래당 기억이 하나라(uq_memories_thread) 둘로 그리면 같은 것이
  // 화면에 두 번 뜬다. 조건 없이 전부 올린다: 아직 아무것도 안 남긴 일은
  // 안 보이는 게 아니라 **어두운 별**이다.
  //
  const memoryByThread = await loadThreadMemories(user.userId, liveMemories);

  const expIdsByThread = new Map<string, string[]>();
  for (const e of expRows) {
    if (!e.threadId) continue;
    const list = expIdsByThread.get(e.threadId) ?? [];
    list.push(e.id);
    expIdsByThread.set(e.threadId, list);
  }

  /**
   * 갈래의 분야를 **속한 경험들의 최빈 category** 로 다시 만든다.
   *
   * 저장된 threads.category 도 같은 규칙으로 갱신된다 — 엔진이 attach 마다
   * 다시 센다. 그러니 중복처럼 보이지만 세는 **대상이 다르다.**
   *
   *   DB   : experiences.category — 모델의 판정(inferred)
   *   여기 : bodies[].category    — 그 위에 사람 교정을 겹친 값(declared)
   *
   * 엔진은 corrections 를 보지 않는다(세션 처리 시점에는 교정이 아직 없다).
   * /diary 에서 분야를 고쳤는데 별의 방향과 색이 안 따라오면 "고쳐도 아무것도
   * 안 달라진다"가 된다. 이미 불러온 expRows 안에서 세므로 추가 쿼리가 없다.
   *
   * (갈래 화면에만 있던 규칙이다. 그 화면을 없애면서 여기로 옮겼다.)
   */
  const bodyById = new Map(bodies.map((b) => [b.id, b]));
  const dominantOf = (threadId: string, fallback: string): string => {
    const tally = new Map<string, number>();
    for (const id of expIdsByThread.get(threadId) ?? []) {
      const c = bodyById.get(id)?.category;
      if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    if (tally.size === 0) return fallback;
    // 동률이면 이름순 — 렌더마다 색이 바뀌지 않게 결정적으로 고른다.
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  };

  const orbitThreads: ThreadBody[] = threadRows.map((t) => {
    const ids = expIdsByThread.get(t.id) ?? [];
    const m = memoryByThread.get(t.id);
    return {
      kind: "thread" as const,
      id: t.id,
      title: t.title,
      category: dominantOf(t.id, t.category),
      status: t.status,
      experienceCount: t.experienceCount,
      occurredAt: t.startedAt.getTime(),
      completedAt: t.completedAt?.getTime() ?? null,
      ageDays: Math.max(0, (now - t.startedAt.getTime()) / DAY_MS),
      referencedIds: ids,
      // 테두리를 두를 경험들. 남은 게 있으면 그 기억을 만든 근거들이고,
      // 없으면 이 갈래를 시작한 경험 하나다(expRows 가 내림차순이라 마지막).
      // "이 일에 뭐가 있었나"와 "그중 뭐가 남았나"는 다른 질문이라 위성은
      // 경험 전부를 띄우고 이 목록만 테두리로 구분한다.
      sourceIds: m ? m.experienceIds : [ids.at(-1)].filter((id): id is string => id != null),
      memory: m ?? null,
    };
  });

  // 최근에 들어온 경험들과, 그 경험들이 속한 갈래.
  //
  // 경험 하나가 아니라 셋을 표시한다 — 하나만 표시하면 "마지막 한 건"이지
  // "요즘 뭘 하고 있나"가 아니다. 좌하단 '최근 경험' 목록과 같은 수를 쓴다
  // (RECENT_LIMIT). 글로 적힌 셋과 지도에서 빛나는 셋이 어긋나면 안 된다.
  //
  // 갈래 쪽 개수는 **세지 않는다.** 셋이 한 갈래에 몰리면 하나, 흩어지면 셋이
  // 나온다 — 경험이 어디에 붙었는지가 정하는 것이라 여기서 정할 값이 아니다.
  // 갈래가 없는 경험(thread_id=null)만 빠진다.
  const latestExps = expRows.slice(0, RECENT_LIMIT);
  const latestExperienceIds = latestExps.map((e) => e.id);
  const latestThreadIds = [
    ...new Set(latestExps.map((e) => e.threadId).filter((id): id is string => id != null)),
  ];

  const todayMinutes = todaySessionRows.reduce((sum, s) => sum + s.durationMin, 0);

  // 층 2 — 오늘 캐릭터가 물을 것. **읽기만 한다.**
  // 질문 생성은 야간 배치(apps/batch/src/jobs/daily-questions.ts)가 한다 —
  // 여기서 만들면 서버 컴포넌트가 렌더마다 쓰기를 하게 되고, "하루 1건"이라는
  // 예산을 사용자의 새로고침 횟수가 좌우하게 된다.
  const [openQuestion] = await db
    .select({
      id: questions.id,
      field: questions.field,
      text: questions.text,
      modelValue: questions.modelValue,
    })
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
    ? {
        id: openQuestion.id,
        field: openQuestion.field,
        text: openQuestion.text,
        modelValue: openQuestion.modelValue,
      }
    : null;

  return (
    <MapStage
      bodies={bodies}
      threads={orbitThreads}
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
      latestExperienceIds={latestExperienceIds}
      latestThreadIds={latestThreadIds}
      question={question}
    />
  );
}
