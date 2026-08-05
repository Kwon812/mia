// daily-logs: 어제(KST 새벽4시 경계 하루) experiences 가 1건 이상인 유저별로
// LLM 1회(Haiku)를 호출해 캐릭터 1인칭 일기를 생성하고 daily_logs 에 upsert 한다.
// PK 가 (user_id, log_date) 라서 같은 날짜를 다시 돌리면 자연스럽게 재생성(덮어쓰기)된다
// — experiences 가 불변이라 prompt_version 을 올리고 과거 일기를 다시 만들 수 있다(계획서 05장).
//
// LLM 추가 호출은 이 잡 하나뿐이다(기억·성격·레벨은 규칙 기반). structured output 은
// Experience Engine(apps/web/src/lib/experience-engine.ts)과 동일하게 tool
// use(단일 툴 강제) 방식을 쓴다 — 스키마 위반 자체를 막고, zod 없이 최종 검증한다
// (apps/batch 는 zod 를 직접 의존하지 않는다).

import Anthropic from '@anthropic-ai/sdk';
import { and, gte, lt } from 'drizzle-orm';
import { dailyLogs, experiences, type Db } from '@na/db';
import { diaryTargetKst } from '../kst';

// 저비용 모델. 유저당 1회만 호출되므로 Haiku 로 충분하다 (claude-api 스킬 캐시 기준 모델 ID).
const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'record_diary';

// Haiku 4.5 가격 ($/1M 토큰) — 유저당 비용 로그용. claude-api 스킬 캐시 기준.
const INPUT_PRICE_PER_MTOK = 1.0;
const OUTPUT_PRICE_PER_MTOK = 5.0;

// v1 — 프롬프트를 바꾸면 daily_logs.prompt_version 을 올리고, experiences 가 불변이므로
// 과거 일기 전체를 이 프롬프트로 재생성할지 검토한다.
const DIARY_SYSTEM_PROMPT_V1 = `너는 사용자 개인의 AI 캐릭터다. 오늘 하루 사용자가 겪은 경험
목록을 받아서, 그 캐릭터의 1인칭 시점으로 짧은 일기를 쓴다.

record_diary 툴을 반드시 한 번 호출해서 다음을 채운다.
- summary: 오늘 하루를 2~3문장으로 요약하는 일기. 캐릭터(1인칭 AI)가 쓰는 자연스러운
  한국어 반말체("~했다"가 아니라 "~했어" 같은 구어체)로 쓴다.
- learned: 오늘 새로 배우거나 알게 된 것들의 목록. 없으면 빈 배열.
- emotion: 오늘 하루를 대표하는 감정을 한 단어로.`;

const RECORD_DIARY_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: '오늘 하루의 경험 목록을 바탕으로 캐릭터의 일기를 기록한다. 반드시 이 툴을 호출해서 응답한다.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '캐릭터(1인칭 AI)가 쓰는 오늘 일기. 2~3문장, 반말체.',
      },
      learned: {
        type: 'array',
        description: '오늘 새로 배우거나 알게 된 것 목록. 없으면 빈 배열.',
        items: { type: 'string' },
      },
      emotion: {
        type: 'string',
        description: '오늘 하루를 대표하는 감정 한 단어(예: 뿌듯함, 답답함, 설렘).',
      },
    },
    required: ['summary', 'learned', 'emotion'],
    additionalProperties: false,
  },
};

interface DailyLogOutput {
  summary: string;
  learned: string[];
  emotion: string;
}

// zod 없이 최소 형태만 검증한다(apps/batch 는 zod 를 직접 의존하지 않는다).
function parseDailyLogOutput(input: unknown): DailyLogOutput | null {
  if (typeof input !== 'object' || input === null) return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.summary !== 'string' || obj.summary.length === 0) return null;
  if (!Array.isArray(obj.learned) || !obj.learned.every((x) => typeof x === 'string')) return null;
  if (typeof obj.emotion !== 'string' || obj.emotion.length === 0) return null;
  return { summary: obj.summary, learned: obj.learned as string[], emotion: obj.emotion };
}

interface DayExperienceRow {
  id: string;
  userId: string;
  summary: string;
  detail: string | null;
  category: string;
  outcome: string | null;
}

function buildUserMessage(rows: DayExperienceRow[]): string {
  const list = rows
    .map((e, i) => `${i + 1}. [${e.category}/${e.outcome ?? '-'}] ${e.summary}${e.detail ? ` — ${e.detail}` : ''}`)
    .join('\n');
  return ['## 오늘의 경험 목록', list].join('\n');
}

export async function generateDailyLogs(db: Db): Promise<void> {
  console.log('[daily-logs] start');

  // "어제"가 아니라 "지금 끝나가는/방금 끝난 하루" — 새벽 3시 정규 실행이
  // 경계(4시) 이전이라 yesterdayKstRange 를 쓰면 하루가 밀린다 (kst.ts 참고).
  const { start, end, logDate } = diaryTargetKst();

  const expRows: DayExperienceRow[] = await db
    .select({
      id: experiences.id,
      userId: experiences.userId,
      summary: experiences.summary,
      detail: experiences.detail,
      category: experiences.category,
      outcome: experiences.outcome,
    })
    .from(experiences)
    .where(and(gte(experiences.occurredAt, start), lt(experiences.occurredAt, end)))
    // 정렬이 없으면 프롬프트의 "오늘의 경험 목록" 번호가 Postgres 반환 순서에
    // 좌우된다. 저녁 일이 1번으로 올라오면 하루의 흐름이 뒤집힌 일기가 나온다.
    .orderBy(experiences.occurredAt);

  if (expRows.length === 0) {
    console.log(`[daily-logs] log_date=${logDate} 대상 경험 없음`);
    console.log('[daily-logs] done');
    return;
  }

  const byUser = new Map<string, DayExperienceRow[]>();
  for (const row of expRows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  const client = new Anthropic();
  let succeeded = 0;
  let failed = 0;

  for (const [userId, rows] of byUser) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        // 512 는 부족했다. 하루 경험이 20~30건이면 요약 2~3문장 + learned 5~8개로
        // 넘어가고, tool_use 생성 중 잘리면 input 이 불완전한 객체로 와서
        // 검증 실패 → 그 유저의 그 날짜 일기는 영영 생기지 않는다(다음 실행은
        // 다른 log_date 를 겨냥한다). 복구 경로가 없으니 넉넉히 준다.
        max_tokens: 2048,
        system: DIARY_SYSTEM_PROMPT_V1,
        tools: [RECORD_DIARY_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: buildUserMessage(rows) }],
      });

      // 잘렸으면 검증이 통과하더라도 내용이 반쪽이다. 원인을 로그에 남긴다.
      if (response.stop_reason === 'max_tokens') {
        console.error(`[daily-logs] user=${userId} 출력이 max_tokens 로 잘렸다`);
      }

      const usage = response.usage;
      const costUsd = (usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MTOK + (usage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTOK;
      console.log(
        `[daily-logs] user=${userId} tokens(in=${usage.input_tokens},out=${usage.output_tokens}) cost≈$${costUsd.toFixed(5)}`,
      );

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
      );
      const output = toolUse ? parseDailyLogOutput(toolUse.input) : null;

      if (!output) {
        console.error(`[daily-logs] user=${userId} LLM 출력 검증 실패, 스킵`);
        failed += 1;
        continue;
      }

      const experienceIds = rows.map((r) => r.id);

      await db
        .insert(dailyLogs)
        .values({
          userId,
          logDate,
          summary: output.summary,
          learned: output.learned,
          emotion: output.emotion,
          experienceIds,
          promptVersion: 1,
        })
        .onConflictDoUpdate({
          target: [dailyLogs.userId, dailyLogs.logDate],
          set: {
            summary: output.summary,
            learned: output.learned,
            emotion: output.emotion,
            experienceIds,
            generatedAt: new Date(),
            promptVersion: 1,
          },
        });

      succeeded += 1;
    } catch (err) {
      failed += 1;
      console.error(`[daily-logs] user=${userId} 실패`, err);
    }
  }

  console.log(`[daily-logs] log_date=${logDate} ${succeeded}명 성공, ${failed}명 실패 (대상 ${byUser.size}명)`);
  console.log('[daily-logs] done');
}
