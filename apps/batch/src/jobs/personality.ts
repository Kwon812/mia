// personality: 성격 축 5개는 sessions(+threads/experiences) 데이터만으로 계산한다
// (별도 설문/입력 없음, 계획서 06장). 최근 14일 sessions 가 10개 이상인 유저만
// 대상으로 하고, 그 14일 창 자체가 "최소 2주 이동평균"의 스무딩 역할을 한다 —
// 매일 밤 최근 14일을 다시 계산해 append 하므로 세션 하나로 축이 요동치지 않는다.
//
// 정규화 공식은 전부 실데이터 튜닝 대상이다. 지금은 계획서 06장 표의 방향성
// (관측값이 클수록 어느 극으로 가는지)만 맞춘 선형 공식이다.

import { and, eq, gte, sql } from 'drizzle-orm';
import { experiences, personalitySnapshots, sessions, threads, type Db } from '@na/db';
import { kstHour } from '../kst';

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_SESSIONS = 10;

function clampAxis(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

interface WindowSessionRow {
  durationMin: number;
  uniqueDomains: number;
  tags: string[] | null;
  startedAt: Date;
}

// 몰입형(+) ↔ 산만형(-).
// 세션 평균 길이가 길수록 +, scattered 태그 비율이 높을수록 -.
// 평균 길이 60분을 정규화 상한(=100점)으로 두고, scattered 비율(0~100%)을
// 그대로 0~100 감점으로 뺀다. DURATION_CAP_MIN 은 튜닝 대상.
function calcFocusScatter(rows: WindowSessionRow[]): number {
  const DURATION_CAP_MIN = 60;
  const avgDuration = average(rows.map((r) => r.durationMin));
  const durationScore = clampAxis((avgDuration / DURATION_CAP_MIN) * 100);
  const scatteredCount = rows.filter((r) => (r.tags ?? []).includes('scattered')).length;
  const scatterScore = (scatteredCount / rows.length) * 100;
  return clampAxis(durationScore - scatterScore);
}

// 집중형(+) ↔ 멀티형(-).
// 세션당 unique_domains 평균이 적을수록 +. 평균 1개면 +100, DOMAIN_CAP개 이상이면
// -100 이 되도록 선형 보간한다. DOMAIN_CAP 은 튜닝 대상.
function calcDepthBreadth(rows: WindowSessionRow[]): number {
  const DOMAIN_CAP = 8;
  const avgUniqueDomains = average(rows.map((r) => r.uniqueDomains));
  const raw = 100 - ((avgUniqueDomains - 1) / (DOMAIN_CAP - 1)) * 200;
  return clampAxis(raw);
}

// 완결형(+) ↔ 탐색형(-). threads completed/(completed+abandoned) 비율을 -100~100 으로
// 선형 매핑한다(비율 0.5 = 중립). 분모가 0 이면 판단 근거가 없으므로 0(중립).
function calcFinishExplore(completed: number, abandoned: number): number {
  const denom = completed + abandoned;
  if (denom === 0) return 0;
  const ratio = completed / denom;
  return clampAxis((ratio - 0.5) * 200);
}

// 개척형(+) ↔ 숙련형(-). 최근 14일 experiences 의 is_first_time 비율을 -100~100 으로
// 매핑한다. 창 내 experiences 가 하나도 없으면 판단 근거가 없으므로 0(중립).
function calcPioneerMaster(firstTimeCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  const ratio = firstTimeCount / totalCount;
  return clampAxis(ratio * 200 - 100);
}

// 새벽형(+) ↔ 아침형(-). started_at 의 KST 시간대 분포에서 새벽(0~6시) 비중이
// 높을수록 +, 아침(6~12시) 비중이 높을수록 -. 두 비중(각 0~1) 차이를 그대로
// -100~100 스케일로 늘린다.
function calcNightMorning(rows: WindowSessionRow[]): number {
  const nightCount = rows.filter((r) => kstHour(r.startedAt) < 6).length;
  const morningCount = rows.filter((r) => {
    const h = kstHour(r.startedAt);
    return h >= 6 && h < 12;
  }).length;
  const nightRatio = nightCount / rows.length;
  const morningRatio = morningCount / rows.length;
  return clampAxis((nightRatio - morningRatio) * 100);
}

export async function recomputePersonality(db: Db): Promise<void> {
  console.log('[personality] start');

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_MS);

  const sessionRows = await db
    .select({
      userId: sessions.userId,
      durationMin: sessions.durationMin,
      uniqueDomains: sessions.uniqueDomains,
      tags: sessions.tags,
      startedAt: sessions.startedAt,
    })
    .from(sessions)
    .where(gte(sessions.startedAt, windowStart));

  const byUser = new Map<string, WindowSessionRow[]>();
  for (const row of sessionRows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  let computed = 0;
  let skipped = 0;

  for (const [userId, rows] of byUser) {
    if (rows.length < MIN_SESSIONS) {
      console.log(`[personality] user=${userId} 스킵 (세션 ${rows.length}건 < ${MIN_SESSIONS})`);
      skipped += 1;
      continue;
    }

    const focusScatter = calcFocusScatter(rows);
    const depthBreadth = calcDepthBreadth(rows);
    const nightMorning = calcNightMorning(rows);

    const [threadCounts] = await db
      .select({
        completed: sql<number>`count(*) filter (where ${threads.status} = 'completed')::int`,
        abandoned: sql<number>`count(*) filter (where ${threads.status} = 'abandoned')::int`,
      })
      .from(threads)
      .where(eq(threads.userId, userId));
    const finishExplore = calcFinishExplore(threadCounts?.completed ?? 0, threadCounts?.abandoned ?? 0);

    const [expCounts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        firstTime: sql<number>`count(*) filter (where ${experiences.isFirstTime})::int`,
      })
      .from(experiences)
      .where(and(eq(experiences.userId, userId), gte(experiences.occurredAt, windowStart)));
    const pioneerMaster = calcPioneerMaster(expCounts?.firstTime ?? 0, expCounts?.total ?? 0);

    await db.insert(personalitySnapshots).values({
      userId,
      computedAt: windowEnd,
      windowStart,
      windowEnd,
      focusScatter,
      depthBreadth,
      finishExplore,
      pioneerMaster,
      nightMorning,
      sampleSize: rows.length,
    });

    computed += 1;
  }

  console.log(`[personality] ${computed}명 계산, ${skipped}명 스킵`);
  console.log('[personality] done');
}
