// Project NA 야간 배치 엔트리포인트.
// Render Cron Job 으로 매일 새벽 3시(KST) 실행: 일기 생성 -> 성격 축 재계산 -> 레벨/캐릭터 캐시 갱신 -> 무활동 thread 정리.
// 각 단계는 독립적으로 실패해도 나머지 단계는 계속 진행하고, 하나라도 실패하면 마지막에 exit 1 한다.

import { createDb, type Db } from "@na/db";
import { generateDailyLogs } from "./jobs/daily-logs";
import { recomputePersonality } from "./jobs/personality";
import { refreshCharacterCache } from "./jobs/character-cache";
import { markAbandonedThreads } from "./jobs/threads";

type Step = {
  name: string;
  run: (db: Db) => Promise<void>;
};

// 순서에 뜻이 있다. markAbandonedThreads 가 recomputePersonality 보다 앞이다 —
// 뒤에 두면 오늘 밤 무활동 임계를 넘긴 thread 들이 성격 계산이 끝난 뒤에야
// abandoned 가 되어, finishExplore 축이 늘 하루 늦게 반영된다.
const STEPS: Step[] = [
  { name: "generateDailyLogs", run: generateDailyLogs },
  { name: "markAbandonedThreads", run: markAbandonedThreads },
  { name: "recomputePersonality", run: recomputePersonality },
  { name: "refreshCharacterCache", run: refreshCharacterCache },
];

async function main(): Promise<void> {
  const startedAt = new Date();
  console.log(`[batch] start ${startedAt.toISOString()}`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!process.env.ANTHROPIC_API_KEY) {
    // 없으면 일기 생성만 조용히 실패한다 — 그마저도 그날 경험이 0건이면
    // LLM 클라이언트를 만들기 전에 early return 이라 증상이 나타났다 사라진다.
    console.error("[batch] ANTHROPIC_API_KEY 환경변수가 없습니다. 배치를 종료합니다.");
    process.exit(1);
  }

  if (!databaseUrl) {
    console.error("[batch] DATABASE_URL 환경변수가 설정되어 있지 않습니다. 배치를 종료합니다.");
    process.exit(1);
  }

  const db = createDb();

  const failed: string[] = [];

  for (const step of STEPS) {
    console.log(`[batch] step "${step.name}" start`);
    try {
      await step.run(db);
      console.log(`[batch] step "${step.name}" ok`);
    } catch (error) {
      failed.push(step.name);
      console.error(`[batch] step "${step.name}" failed:`, error);
    }
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  console.log(`[batch] end ${finishedAt.toISOString()} (took ${durationMs}ms)`);

  if (failed.length > 0) {
    console.error(`[batch] failed steps: ${failed.join(", ")}`);
    process.exit(1);
  }

  // postgres.js 는 커넥션을 유지하므로 명시적으로 종료해야 프로세스가 끝난다
  process.exit(0);
}

main().catch((error) => {
  console.error("[batch] unexpected fatal error:", error);
  process.exit(1);
});
