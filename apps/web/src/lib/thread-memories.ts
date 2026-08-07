import 'server-only';

import { strongestTrigger } from '@na/shared';
import { loadSkillsByMemory } from './memory-skills';
import type { ThreadMemory } from '@/components/orbital-map';

// ============================================================
// 갈래에 남은 기억 → 별의 성질
//
// 지도의 천체는 갈래 하나뿐이고, 기억은 그 별의 광도·색온도로 얹힌다
// (갈래당 기억 하나 — uq_memories_thread). 그 변환이 여기 한 군데에 있다.
//
// 지금은 부르는 곳이 지도 하나뿐이지만 함수로 떼어둔다. 이 변환에는 판단이
// 들어가 있고(가장 센 trigger 고르기 · 빈 triggers 메우기 · 스킬 붙이기),
// 두 곳에서 각자 하면 반드시 갈린다 — 실제로 한 번 갈려서 같은 별이 화면마다
// '기억' 과 '갈래' 로 다르게 불렸다.
//
// 쿼리는 여기서 안 한다. 지도는 이 목록을 경험의 remembered·forgotten 판정에도
// 쓰느라 잊힌 것까지 함께 읽는데, 그건 이 변환의 관심사가 아니다.
// ============================================================

/** 이 변환이 필요로 하는 최소 정보. 호출부의 행 모양에 의존하지 않는다. */
export type ThreadMemoryRow = {
  id: string;
  threadId: string | null;
  title: string;
  body: string;
  importance: number;
  trigger: string;
  triggers: string[];
  occurredAt: Date;
  experienceIds: string[];
};

/**
 * 갈래 id → 그 갈래에 남은 기억.
 *
 * `threadId` 가 없는 기억은 설 자리가 없어 빠진다. 지금은 안 생긴다 — 기억을
 * 만드는 두 자리 모두 경험의 threadId 가 있어야 들어간다.
 *
 * @param live 잊히지 않은(forgotten_at is null) 기억들
 */
export async function loadThreadMemories(
  userId: string,
  live: readonly ThreadMemoryRow[],
): Promise<Map<string, ThreadMemory>> {
  const skillsByMemory = await loadSkillsByMemory(userId, live);

  const byThread = new Map<string, ThreadMemory>();
  for (const m of live) {
    if (m.threadId == null) continue;
    byThread.set(m.threadId, {
      id: m.id,
      title: m.title,
      body: m.body,
      importance: m.importance,
      // 화면은 색온도에 값 하나가 필요하다. 저장은 전부, 선택은 읽을 때.
      trigger: strongestTrigger(m.triggers, m.trigger),
      // 옛 행은 triggers 가 비어 있고 trigger 하나만 있다.
      triggers: m.triggers.length > 0 ? m.triggers : [m.trigger],
      occurredAt: m.occurredAt.getTime(),
      experienceIds: m.experienceIds,
      skills: (skillsByMemory.get(m.id) ?? []).map((sk) => ({
        name: sk.name,
        firstTime: sk.firstTime,
      })),
    });
  }
  return byThread;
}
