import 'server-only';

// ============================================================
// SKILL.md 생성 — 승인된 절차에만.
//
// 후보 찾기는 전부 코드다. LLM 은 여기 한 군데뿐이고, 그것도 사람이 승인한
// 것에만 돈다. 절차가 평생 열 개쯤 생긴다면 호출도 열 번이다.
//
// **필수 경로가 아니다.** 이름 짓기가 실패해도 steps 는 멀쩡하고 실행도 된다.
// 이름이 못생길 뿐이다. 반대로 LLM 이 실행 명세를 만드는 구조였으면 호출
// 실패가 곧 기능 정지다.
//
// 후조건을 같이 뽑는 게 핵심이다. "성공했다는 걸 무엇으로 아나" — 이게
// 있어야 나중에 리플레이·검증자를 붙일 수 있고, 없으면 그때 절차를 전부
// 다시 써야 한다. 그래서 지금 넣는다.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { Step } from './procedure';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1200;

const TOOL = {
  name: 'write_skill',
  description: '관측된 조작 열을 사람과 에이전트가 읽는 절차 문서로 옮긴다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description: '이 절차가 무엇을 이루는 일인지 한 문장. 조작의 나열이 아니라 목적.',
      },
      steps: {
        type: 'array',
        description:
          '사람이 읽는 단계. 관측된 조작 수와 같아야 하고 순서도 같아야 한다. ' +
          '"버튼을 누른다"가 아니라 "무엇을 하려고 누르는지"를 적는다.',
        items: { type: 'string' },
      },
      params: {
        type: 'array',
        description: '매번 달라지는 입력. 실행할 때 사람에게 물어볼 것들이다.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '짧은 이름 (예: 시작일)' },
            hint: { type: 'string', description: '무엇을 넣어야 하는지' },
          },
          required: ['name', 'hint'],
        },
      },
      postcondition: {
        type: 'string',
        description:
          '성공했다는 것을 무엇으로 아는가. **확인 가능한 상태**여야 한다 — ' +
          '"잘 됐다"가 아니라 "다운로드 폴더에 csv 가 생겼다", "목록에 새 행이 보인다" 처럼. ' +
          '바꾸는 조작이 없는 절차라면 "화면에 무엇이 보인다" 꼴이 된다.',
      },
    },
    required: ['summary', 'steps', 'params', 'postcondition'],
  },
};

const SYSTEM = `너는 관측된 브라우저 조작 열을 절차 문서로 옮긴다.

주어지는 것은 사람이 실제로 한 클릭과 입력의 순서다. 도메인, 눌린 요소의
보이는 텍스트, 그것이 무언가를 바꾸는 조작인지, 직전 단계로부터 몇 초가
흘렀는지가 들어 있다.

지켜야 할 것:

- **조작을 그대로 옮기지 말고 뜻을 적는다.** "필터 버튼을 누른다"가 아니라
  "기간을 좁힌다"다. 이 문서를 읽는 쪽은 화면이 조금 바뀌어도 같은 일을
  해내야 하고, 버튼 이름을 외운 문서는 그걸 못 한다.
- **단계 수와 순서는 관측과 같아야 한다.** 합치거나 나누지 않는다.
- **입력값은 주어지지 않는다.** 무엇을 넣었는지는 기록하지 않기 때문이다.
  자리와 종류만 안다. 그러니 매개변수는 "무엇을 넣을 자리인지"로만 적는다.
- **후조건은 확인 가능해야 한다.** 사람이 눈으로든 코드로든 참·거짓을
  가릴 수 있는 상태여야 한다. "성공적으로 완료된다"는 후조건이 아니다.
- 짧게. 이 문서는 읽히려고 있는 것이지 설명되려고 있는 게 아니다.`;

export type SkillDoc = { markdown: string; postcondition: string };

function describeSteps(steps: Step[]): string {
  return steps
    .map((s, i) => {
      const bits = [`${i + 1}. ${s.domain}`];
      if (s.label) bits.push(`"${s.label}"`);
      else if (s.sel) bits.push(s.sel);
      else bits.push(s.tag);
      if (s.isInput) bits.push('[입력 — 매번 다른 값]');
      if (s.mut) bits.push('[무언가를 바꾼다]');
      if (s.dt >= 2) bits.push(`(앞 단계로부터 ${Math.round(s.dt)}초)`);
      return bits.join(' · ');
    })
    .join('\n');
}

/**
 * 승인된 절차의 설명을 쓴다.
 *
 * 실패해도 던지지 않고 null 을 준다 — 이건 곁들이지 본체가 아니다. 설명이
 * 없어도 절차는 돌아간다.
 */
export async function writeSkillDoc(input: {
  name: string;
  steps: Step[];
  runs: number;
  medianSec: number;
}): Promise<SkillDoc | null> {
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            `사람이 이 절차를 "${input.name}" 라고 불렀다.`,
            `${input.runs}번 되풀이했고 매번 ${Math.round(input.medianSec)}초쯤 걸렸다.`,
            '',
            '관측된 조작:',
            describeSteps(input.steps),
          ].join('\n'),
        },
      ],
    });

    const out = res.content.find((b) => b.type === 'tool_use');
    if (!out || out.type !== 'tool_use') return null;
    const v = out.input as {
      summary?: string;
      steps?: string[];
      params?: { name: string; hint: string }[];
      postcondition?: string;
    };
    if (!v.summary || !Array.isArray(v.steps) || !v.postcondition) return null;

    const md = [
      `# ${input.name}`,
      '',
      v.summary,
      '',
      ...(v.params && v.params.length > 0
        ? ['## 넣어야 하는 것', ...v.params.map((p) => `- **${p.name}** — ${p.hint}`), '']
        : []),
      '## 순서',
      ...v.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
      '## 다 됐는지 어떻게 아나',
      v.postcondition,
      '',
      `_${input.runs}번 되풀이한 것에서 뽑았다. 매번 ${Math.round(input.medianSec)}초쯤 걸렸다._`,
    ].join('\n');

    return { markdown: md, postcondition: v.postcondition };
  } catch (err) {
    console.error('[skill-md] 실패', err);
    return null;
  }
}
