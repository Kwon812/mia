import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { experienceSkills, experiences, userSkills } from '@na/db';
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
  /** 이 기억을 만든 경험들. 갈래당 기억 하나에 쌓인다. */
  experienceIds: string[];
  occurredAt: Date;
};

/** memory.id → 그 기억을 만든 경험의 스킬들 (비중 내림차순) */
export async function loadSkillsByMemory(
  userId: string,
  items: readonly MemoryRef[],
): Promise<Map<string, MemorySkill[]>> {
  const expIds = [...new Set(items.flatMap((m) => m.experienceIds))];
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
  // "그때 처음이었나"는 그 **경험이 일어난 시각**과 비교해야 한다. 기억의
  // occurred_at 은 처음 남을 만해진 순간이라 나중에 붙은 경험과는 어긋난다.
  const expOccurredAt = new Map(
    (
      await db
        .select({ id: experiences.id, occurredAt: experiences.occurredAt })
        .from(experiences)
        .where(inArray(experiences.id, expIds))
    ).map((e) => [e.id, e.occurredAt.getTime()]),
  );

  const byExp = new Map<string, MemorySkill[]>();
  for (const r of rows) {
    const list = byExp.get(r.experienceId) ?? [];
    list.push({
      name: r.name,
      weight: r.weight,
      firstTime: firstUsed.get(r.name) === expOccurredAt.get(r.experienceId),
    });
    byExp.set(r.experienceId, list);
  }
  for (const list of byExp.values()) list.sort((a, b) => b.weight - a.weight);

  // 기억 하나가 경험 여럿을 품으므로 스킬도 합친다. 같은 스킬이 여러 경험에서
  // 나오면 비중이 큰 쪽을, "처음"은 한 번이라도 처음이면 처음으로 본다.
  const byMemory = new Map<string, MemorySkill[]>();
  for (const m of items) {
    const merged = new Map<string, MemorySkill>();
    for (const id of m.experienceIds) {
      for (const sk of byExp.get(id) ?? []) {
        const prev = merged.get(sk.name);
        if (!prev) merged.set(sk.name, { ...sk });
        else {
          prev.weight = Math.max(prev.weight, sk.weight);
          prev.firstTime = prev.firstTime || sk.firstTime;
        }
      }
    }
    byMemory.set(m.id, [...merged.values()].sort((a, b) => b.weight - a.weight));
  }
  return byMemory;
}
