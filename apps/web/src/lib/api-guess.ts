import 'server-only';

// ============================================================
// 모르는 사이트의 API 를 물어본다.
//
// 엿듣기가 실패하는 화면이 있다 — SSR 로 값이 오면 API 호출 자체가 없다.
// 그때까지는 엔드포인트를 코드에 박아둔 표에 기대야 했는데, 그러면 등록한
// 서비스에서만 되고 새 사이트마다 코드를 고쳐야 한다.
//
// 대신 묻는다. 모델은 널리 쓰이는 서비스의 API 주소를 안다.
//
// **지어낼 수 있다.** 그건 사실이고, 오늘 셀렉터를 지어냈다가 절차를 멈추게
// 한 것과 같은 종류의 위험이다. 다만 여기서는 **호출해보면 바로 드러난다** —
// 200 이 오고 JSON 이 오고 집은 값이 그 안에 있으면 맞은 것이고, 아니면
// 틀린 것이다. 확장이 그 검증을 한 뒤에만 저장한다.
//
// 검증이 안 되는 것도 있다: 키 발급 주소. 그건 열어보기 전엔 모른다.
// 링크 하나라 틀려도 손해가 적어서 받되, 맞다고 보증하지는 않는다.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

const TOOL = {
  name: 'name_api',
  description: '이 서비스의 공개 API 로 값을 읽는 방법을 알려준다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      known: {
        type: 'boolean',
        description:
          '이 서비스의 공개 API 를 실제로 아는가. **모르면 false 다.** ' +
          '그럴듯한 주소를 지어내는 것보다 모른다고 하는 편이 낫다 — ' +
          '지어낸 주소는 호출해봐야 틀린 것이 드러나고, 그동안 사람이 기다린다.',
      },
      label: { type: 'string', description: '서비스 이름 (예: Render)' },
      base: { type: 'string', description: 'API 기본 주소 (예: https://api.render.com/v1)' },
      probes: {
        type: 'array',
        description:
          '값이 있을 만한 GET 경로들. 목록·상태·사용량처럼 대시보드가 보여주는 것을 ' +
          '주는 경로를 고른다. 많아야 셋.',
        items: { type: 'string' },
      },
      auth: {
        type: 'string',
        enum: ['bearer', 'header', 'none'],
        description: '인증 방식. bearer 면 Authorization: Bearer <키>.',
      },
      authHeader: {
        type: 'string',
        description: 'auth 가 header 일 때 그 헤더 이름 (예: X-API-Key).',
      },
      keyUrl: {
        type: 'string',
        description: '키를 발급받는 화면 주소. 확실하지 않으면 그 서비스의 설정 화면이라도.',
      },
      keyHint: { type: 'string', description: '어디서 받는지 한 줄 (예: 계정 설정 → API Keys)' },
    },
    required: ['known'],
  },
};

const SYSTEM = `너는 어떤 웹 서비스의 공개 API 를 아는지 답한다.

지켜야 할 것:

- **모르면 모른다고 한다.** known=false 다. 이건 실패가 아니라 답이다 —
  지어낸 주소는 호출해봐야 틀린 것이 드러나고, 그동안 사람이 기다린다.
- 자체 제작 서비스, 사내 도구, 개인 프로젝트는 공개 API 가 없는 것이 보통이다.
  도메인이 낯설면 known=false 로 답한다.
- 읽기만 하는 GET 경로를 고른다. 무언가를 바꾸는 경로는 절대 넣지 않는다.
- 경로는 확실한 것만. 셋보다 적어도 된다.`;

export type ApiGuess =
  | { known: false }
  | {
      known: true;
      label: string;
      base: string;
      probes: string[];
      auth: 'bearer' | 'header' | 'none';
      authHeader?: string;
      keyUrl?: string;
      keyHint?: string;
    };

/**
 * 이 도메인의 API 를 물어본다.
 *
 * 실패하면 `{ known: false }` 다 — 던지지 않는다. 이건 곁들이지 본체가
 * 아니고, 모르면 화면에서 읽으면 된다.
 */
export async function guessApi(domain: string): Promise<ApiGuess> {
  const host = domain.split(':')[0];
  // 로컬은 물어볼 것도 없다. 모델이 알 리 없고, 물어보면 그럴듯한 답을 지어낸다.
  if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(host)) return { known: false };

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: `${host} 의 공개 API 를 아는가?` }],
    });
    const out = res.content.find((b) => b.type === 'tool_use');
    if (!out || out.type !== 'tool_use') return { known: false };
    const v = out.input as Record<string, unknown>;
    if (v.known !== true || typeof v.base !== 'string' || !Array.isArray(v.probes)) {
      return { known: false };
    }
    // https 만 받는다. 모델이 http 를 답하는 일은 드물지만, 키를 실어 보내는
    // 요청이라 평문으로 나갈 여지를 남기지 않는다.
    if (!v.base.startsWith('https://')) return { known: false };

    return {
      known: true,
      label: typeof v.label === 'string' ? v.label : host,
      base: v.base.replace(/\/+$/, ''),
      probes: v.probes.filter((p): p is string => typeof p === 'string').slice(0, 3),
      auth: v.auth === 'header' ? 'header' : v.auth === 'none' ? 'none' : 'bearer',
      authHeader: typeof v.authHeader === 'string' ? v.authHeader : undefined,
      keyUrl: typeof v.keyUrl === 'string' && v.keyUrl.startsWith('https://') ? v.keyUrl : undefined,
      keyHint: typeof v.keyHint === 'string' ? v.keyHint : undefined,
    };
  } catch (err) {
    console.error('[api-guess] 실패', err);
    return { known: false };
  }
}
