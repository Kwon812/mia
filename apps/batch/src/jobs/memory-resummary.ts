// memories: 근거가 늘어난 기억을 다시 요약한다.
//
// 기억은 갈래당 하나이고, 그 갈래에서 남을 만한 일이 또 생기면 새로 만드는
// 대신 experience_ids 에 더한다(experience-engine 의 upsertThreadMemory).
// 그러면 제목·본문이 첫 경험만 말하고 있게 되므로 다시 써야 한다.
//
// 왜 여기서 하나: 세션 처리 중에 부르면 "세션당 LLM 1회"가 깨진다. 하루에 같은
// 갈래에 세 번 붙으면 세 번 부르게 되는데(실데이터에 4시간 사이 3건이 있다),
// 밤에 모아 하면 기억당 한 번이면 된다.
//
// 실패해도 다음 밤에 다시 대상이 된다 — needs_resummary 를 성공했을 때만 내린다.
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { experiences, llmOutputs, memories, threads, type Db } from '@na/db';

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'rewrite_memory';
const PROMPT_VERSION = 1;

/** 한 번에 처리할 상한. 밤 배치가 통째로 길어지는 것을 막는다 —
 *  남은 것은 다음 밤에 처리된다(플래그가 안 내려가므로 유실이 아니다). */
const MAX_PER_RUN = 20;

const SYSTEM_PROMPT = `너는 사용자의 브라우징에서 뽑아낸 "기억"을 다시 쓰는 역할이다.

하나의 작업(갈래)에서 남을 만한 일이 여러 번 있었고, 그 근거들이 아래에 모여 있다.
이 사람에게 **무엇이 남았는지**를 다시 정리한다.

- title: 그 작업이 이 사람에게 무엇이었는지를 한 줄로. 명사구가 아니라 문장이어도 된다.
  근거를 나열하지 말고 하나로 꿰어라.
- body: 2~3문장. 무슨 일이 있었고 무엇이 달라졌는지.

사실을 지어내지 않는다. 근거에 없는 도구·성과·감정을 넣지 않는다.
근거가 하나뿐이면 그것만으로 쓴다.`;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: '기억의 제목과 본문을 다시 쓴다. 반드시 이 툴을 호출해서 응답한다.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '한 줄. 이 작업이 무엇이었는지.' },
      body: { type: 'string', description: '2~3문장.' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  },
};

export async function resummarizeMemories(db: Db): Promise<void> {
  console.log('[memory-resummary] start');

  const targets = await db
    .select({
      id: memories.id,
      userId: memories.userId,
      threadId: memories.threadId,
      title: memories.title,
      experienceIds: memories.experienceIds,
      triggers: memories.triggers,
    })
    .from(memories)
    .where(eq(memories.needsResummary, true))
    .limit(MAX_PER_RUN);

  if (targets.length === 0) {
    console.log('[memory-resummary] 대상 없음');
    console.log('[memory-resummary] done');
    return;
  }

  const client = new Anthropic();
  let ok = 0;

  for (const m of targets) {
    try {
      const rows = await db
        .select({ summary: experiences.summary, detail: experiences.detail, occurredAt: experiences.occurredAt })
        .from(experiences)
        .where(inArray(experiences.id, m.experienceIds));

      // 근거가 없으면 다시 쓸 것도 없다. 플래그만 내려 다음 밤에 또 집지 않게 한다.
      if (rows.length === 0) {
        await db.update(memories).set({ needsResummary: false }).where(eq(memories.id, m.id));
        continue;
      }

      const [thread] = m.threadId
        ? await db.select({ title: threads.title }).from(threads).where(eq(threads.id, m.threadId))
        : [];

      const ordered = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      const content = [
        `작업 이름: ${thread?.title ?? m.title}`,
        `남은 이유: ${m.triggers.join(', ')}`,
        '',
        '근거가 된 경험들 (시간순):',
        ...ordered.map((e, i) => `${i + 1}. ${e.summary}${e.detail ? ` — ${e.detail}` : ''}`),
      ].join('\n');

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        // 같은 근거는 같은 요약을 내야 한다. 밤마다 문장이 흔들리면 어제 읽은
        // 기억이 오늘 다른 말을 한다.
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content }],
      });

      const tu = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
      );
      const out = tu?.input as { title?: string; body?: string } | undefined;

      // 원본 출력을 남긴다. 검증 실패분도 함께 — 무엇을 뱉었는지 못 물으면
      // 실패 원인을 영영 알 수 없다. 로깅 실패가 처리를 막으면 안 되니 삼킨다.
      try {
        await db.insert(llmOutputs).values({
          userId: m.userId,
          kind: 'memory_resummary',
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          output: tu?.input ?? null,
          stopReason: res.stop_reason ?? null,
          valid: Boolean(out?.title && out?.body),
        });
      } catch (logErr) {
        console.error('[memory-resummary] llm_outputs 기록 실패', m.id, logErr);
      }

      if (!out?.title || !out?.body) {
        console.error('[memory-resummary] 출력 부적합', m.id);
        continue; // 플래그를 안 내린다 — 다음 밤에 다시 시도한다
      }

      await db
        .update(memories)
        .set({ title: out.title, body: out.body, needsResummary: false })
        .where(and(eq(memories.id, m.id), eq(memories.needsResummary, true)));
      ok += 1;
    } catch (err) {
      console.error('[memory-resummary] 실패', m.id, err);
    }
  }

  console.log(`[memory-resummary] ${ok}/${targets.length} 갱신`);
  console.log('[memory-resummary] done');
}
