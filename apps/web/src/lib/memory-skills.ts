import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { experienceSkills, userSkills } from '@na/db';
import { db } from './db';

// ============================================================
// 기억을 만든 경험의 스킬 목록
//
// 기억은 규칙으로 생기고(LLM 호출 없음) trigger 가 "왜 남았는지"를 말한다.
// 그런데 trigger=new_skill 만으로는 **무슨 스킬이 처음이었는지**를 알 수 없다.
// 그 답을 저장하지 않고 읽을 때 만든다 — 저장하면 재구축 때마다 어긋날 값이
// 하나 늘고, 이미 있는 두 테이블로 정확히 계산되기 때문이다.
//
// "그때 처음이었나"는 과거를 훑지 않는다. user_skills.first_used_at 이 그
// 스킬을 처음 쓴 세션의 시작 시각이고 experiences.occurred_at 도 같은 값이라,
// 둘이 같으면 그 경험에서 처음 쓴 것이다.
// ============================================================

export type MemorySkill = {
  name: string;
  weight: number;
  /** 그 경험에서 처음 쓴 스킬인가 */
  firstTime: boolean;
};

/** 기억 하나가 필요로 하는 최소 정보. 호출부의 행 모양에 의존하지 않는다. */
export type MemoryRef = {
  id: string;
  experienceId: string | null;
  occurredAt: Date;
};

/** memory.id → 그 기억을 만든 경험의 스킬들 (비중 내림차순) */
export async function loadSkillsByMemory(
  userId: string,
  items: readonly MemoryRef[],
): Promise<Map<string, MemorySkill[]>> {
  const expIds = items.map((m) => m.experienceId).filter((id): id is string => id != null);
  if (expIds.length === 0) return new Map();

  const [rows, owned] = await Promise.all([
    db
      .select({
        experienceId: experienceSkills.experienceId,
        name: experienceSkills.skillName,
        weight: experienceSkills.weight,
      })
      .from(experienceSkills)
      .where(inArray(experienceSkills.experienceId, expIds)),
    db
      .select({ name: userSkills.skillName, firstUsedAt: userSkills.firstUsedAt })
      .from(userSkills)
      .where(eq(userSkills.userId, userId)),
  ]);

  const firstUsed = new Map(owned.map((s) => [s.name, s.firstUsedAt.getTime()]));
  const occurredAt = new Map(
    items.filter((m) => m.experienceId).map((m) => [m.experienceId!, m.occurredAt.getTime()]),
  );

  const byExp = new Map<string, MemorySkill[]>();
  for (const r of rows) {
    const list = byExp.get(r.experienceId) ?? [];
    list.push({
      name: r.name,
      weight: r.weight,
      firstTime: firstUsed.get(r.name) === occurredAt.get(r.experienceId),
    });
    byExp.set(r.experienceId, list);
  }
  for (const list of byExp.values()) list.sort((a, b) => b.weight - a.weight);

  const byMemory = new Map<string, MemorySkill[]>();
  for (const m of items) {
    if (m.experienceId) byMemory.set(m.id, byExp.get(m.experienceId) ?? []);
  }
  return byMemory;
}
