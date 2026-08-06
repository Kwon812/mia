// ============================================================
// Experience Engine — 세션 종료 후 LLM 1회로 "경험"을 추출한다.
//
// POST /api/sessions 가 저장 성공 응답을 보낸 뒤 next/server 의 after() 안에서
// processSession(sessionId, userId) 를 조용히 호출한다. 실패해도 API 응답에는
// 영향이 없고, sessions.processed_at 이 NULL 로 남아 재처리 대상이 된다
// (계획서 05장 "Experience Engine").
//
// thread 부착도 이 안에서 함께 결정한다(계획서 11장 미결정 항목 확정) — LLM 이
// 이미 세션 컨텍스트를 보고 있으니 "이 경험이 기존 작업의 연장인지" 판단에
// 별도 호출이 필요 없다. 기억(memories) 생성은 LLM 호출 없이 규칙 기반이다.
// ============================================================

import 'server-only';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  DIALOGUE_SLOTS,
  EXPERIENCE_OUTCOMES,
  characters,
  dialogues,
  experienceSkills,
  experiences,
  ingestFailures,
  llmOutputs,
  memories,
  sessions,
  threads,
  userSkills,
  users,
} from '@na/db';
import {
  EXPERIENCE_CATEGORIES,
  calculateLevel,
  experienceOutputSchema,
  type ExperienceOutput,
} from '@na/shared';
import { db } from './db';
import {
  effective,
  isCorrected,
  loadCorrectionPatterns,
  loadCorrections,
  type CorrectionPattern,
} from './corrections';
import { calculateMemoryScore, type RecentExperienceSummary } from './memory-score';

// ------------------------------------------------------------
// LLM 호출 설정
// ------------------------------------------------------------

// 저비용 모델. 세션 하나당 1회만 호출되므로 Haiku 로 충분하다 (claude-api 스킬 캐시 기준 모델 ID).
export const MODEL = 'claude-haiku-4-5';

export const TOOL_NAME = 'record_experience';

/** SYSTEM_PROMPT_V4 의 버전 번호. llm_outputs 에 남겨 프롬프트 간 비교의
 *  기준으로 쓴다 — 프롬프트를 고치면 여기도 올린다. */
export const PROMPT_VERSION = 4;

/** 프롬프트에 넣는 보유 스킬 목록의 최대 개수. 판정용 집합과는 다르다. */
const PROMPT_SKILL_LIMIT = 50;

// 프롬프트에 넣는 날짜는 KST 달력일로 — UTC slice 를 쓰면 KST 새벽 사용이
// 하루 이르게 표기되어 LLM 이 "어제 썼다"를 "그저께 썼다"로 오해한다.
function kstYmd(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// v3 — 두 가지를 고쳤다. 둘 다 "기준을 안 주면 모델은 가장 안전한 값으로 도망간다"는
//      같은 실패였다.
//      (1) is_first_time 판정 완화. v2 까지는 이 값이 거의 true 로 나오지 않아
//          (실측: 6건 연속 false) 기억 생성 경로가 사실상 막혀 있었다.
//      (2) outcome 판정 기준 명시. v2 까지는 값 네 개를 나열만 하고 언제 무엇을
//          고를지 한 마디도 없었다 — 실측 6건 중 5건이 explore 로 쏠렸고
//          success/stuck 이 하나도 나오지 않아, 이 값에 의존하는 감정 판정과
//          '막힘 돌파' 기억 규칙이 통째로 죽어 있었다.
// v4 — 사람 판단(declared)을 도입했다. 이전까지 이 프롬프트가 받는 값은 전부
//      모델 자신이 만든 것(inferred)이라 "무엇을 믿을지"라는 문제 자체가 없었다.
//      이제 /diary 의 판정 교정과 캐릭터 질문의 답이 들어오므로, 충돌 시
//      우선순위를 명시하지 않으면 모델이 사람이 고쳐놓은 값을 자기 추론으로
//      다시 덮는다 — 그러면 교정은 아무 데도 쓰이지 않는 라벨 더미가 된다.
//      (assertion class: packages/shared/src/assertion.ts)
// v2 — compressed_log 에 검색 쿼리(queries)와 페이지 제목(segments[].title),
// 경로 예시(segments[].paths)가 추가됨에 따라 이를 활용하도록 지시를 보강했다
// (v1: 도메인·시간만으로 추측 → v2: 무엇을 검색·열람했는지까지 반영).
// 프롬프트를 바꾸면 버전을 올리고 dailyLogs.promptVersion 처럼 이력을 남길지 검토한다.
export const SYSTEM_PROMPT_V4 = `너는 사용자의 브라우징 세션 하나를 "경험" 하나로 압축하는 엔진이다.

사용자 메시지로 이번 세션의 압축 로그(compressed_log)·카테고리·길이(분)·방문 도메인과,
이 사용자의 기존 컨텍스트(보유 스킬 목록, 최근 경험 3건, 진행 중인 작업 목록)를 함께 받는다.

compressed_log 에는 구간(segments)마다 도메인·카테고리·시각 외에 그 구간에서 관측된
페이지 제목(title)과 경로 예시(paths)가, 그리고 세션 전체의 검색어(queries)가 들어있다.
검색 쿼리는 사용자가 무엇을 궁금해했는지, 페이지 제목은 무엇을 읽었는지 알려준다.

**모든 시각은 KST(+09:00) 다.** 새벽·심야 여부를 판단할 때 그대로 읽으면 된다.

## 무엇을 믿을 것인가

네가 받는 정보는 출처가 세 종류이고, 충돌하면 **아래 순서대로** 믿는다.

  1. **사람이 정한 것(확정)** — 최근 경험 목록에서 [사람이 고침] 이 붙은 값.
     사용자가 직접 보고 고른 값이라 **논박 대상이 아니다.** 네 추론과 어긋나도
     사람 쪽이 맞다. 특히 그 값을 근거로 이번 세션을 판단할 때, "지난번 것도
     사실은 달랐을 것"이라고 되짚지 마라.
  2. **관측된 것(사실)** — 세션 길이, 방문 도메인, 검색어와 반복 횟수, 페이지
     제목, 종료 사유. 센서가 본 값이라 확실하다.
  3. **네가 추론하는 것** — summary·outcome·category 등 지금 만들 값 전부.

사람이 고친 값이 있다는 것은 **그 종류의 판정에서 네가 틀린 적이 있다**는
뜻이다. 같은 실수를 반복하지 마라 — 예를 들어 사람이 지난 경험의 outcome 을
explore 에서 stuck 으로 고쳤다면, 이번에도 비슷한 상황에서 explore 로
도망가고 있지 않은지 다시 보라.

"### 네가 바로잡힌 판정" 이 있으면 그건 **네 판정 버릇의 통계**다. 개별 경험이
아니라 "무엇을 무엇으로 몇 번 고쳤는가"의 분포이므로, 이번 세션의 내용과
직접 연결짓지 마라. 대신 그 방향으로 기울어 있지 않은지 자신을 점검하는 데
쓴다 — "outcome: explore → stuck (3회)" 라면, 이번에도 explore 를 고르려는
순간 "정말 목표가 없었나, 아니면 판단이 안 서서 도망가는 중인가"를 되묻는다.
횟수가 많을수록 그 버릇이 굳어 있다는 뜻이다.

queries 는 문자열 목록이 아니라 {q, n, first, last} 객체 목록이다 — q 는 검색어, **n 은 그
검색어가 반복된 횟수**, first/last 는 처음·마지막 등장 시각이다. **n 이 크고 first~last
구간이 길다는 것은 같은 것을 오래 붙들고 있었다는 뜻**이고, outcome 판정의 직접적인
근거다(예: n=8, 14:02~14:41 → 40분간 여덟 번 같은 걸 물었다 → stuck 쪽). 반대로
n=1 이고 그 뒤에 문서·적용이 이어지면 찾던 것을 찾은 것이다. 이걸 근거로 summary·detail·skills 를 "github.com 에 90분 머물렀다" 같은
막연한 도메인 요약이 아니라 구체적인 내용으로 만들어라(예: 검색어가
"redis cache invalidation" 이고 이어서 GitHub 이슈·MDN 페이지 제목이 보이면 "Redis
캐시 무효화 방법을 찾아봤다"처럼). 단, title/paths 에 개인정보(이름·계좌번호·주문번호
등으로 보이는 문자열)가 보이면 그 값을 요약·detail 에 그대로 옮기지 말고 일반화해서
서술한다.

기존 컨텍스트를 반드시 참고해서 다음 두 가지를 구분해야 한다.
  "TypeScript로 기능을 구현했다"   ← 기존 스킬 목록에 이미 있던 것 (늘 하던 것)
  "처음으로 TypeScript를 써봤다"   ← 기존 스킬 목록에 없던 것 (신규 스킬 획득, is_first_time=true)

is_first_time 을 지나치게 인색하게 매기지 마라. 도구뿐 아니라 주제·방식·환경도
대상이다 — 처음 다뤄보는 서비스, 처음 붙여보는 연동, 처음 시도하는 방법이면
true 다. 기준은 하나다: 보유 스킬 목록에 없던 것을 이번에 다뤘는가.
목록에 없는 것을 다뤘는데도 망설여진다면 true 쪽으로 판단한다.

record_experience 툴을 반드시 한 번 호출해서 다음을 채운다.
- summary: 이 세션을 한 문장으로, "~했다"체로 요약한다.
- detail: 2~3문장으로 조금 더 자세히 설명한다 (선택).
- category: 아래 열셋 중 하나를 고른다. "이번 세션" 에 적힌 카테고리는 방문 도메인을
  사전에서 조회한 결과일 뿐 판정이 아니다 — 참고만 하고, 실제로 무엇을 했는지로
  다시 고른다. 도메인이 아니라 행위를 보라. 같은 github.com 이라도 코드를 고쳤으면
  dev 이고 남의 코드를 읽으며 배우기만 했으면 study 다.
    dev           : 코드를 쓰거나 고치거나 돌렸다. 배포·설정·디버깅 포함.
    study         : 배우려고 읽었다. 강의·튜토리얼·개념 학습. 만들지는 않았다.
    docs          : 레퍼런스를 찾아봤다. API 문서, 매뉴얼, 스펙 확인.
    ai            : AI 도구 자체를 쓰거나 다뤘다. 대화, 프롬프트, 모델 설정.
    community     : 사람들의 글을 읽거나 썼다. 포럼, 커뮤니티, SNS, 이슈 스레드.
    entertainment : 재미로 봤다. 영상, 웹툰, 게임.
    music         : 음악을 들었다.
    news          : 뉴스·시사를 읽었다.
    shopping      : 물건을 보거나 샀다.
    finance       : 금융·투자를 봤다.
    productivity  : 문서·일정·할 일을 정리했다. 노션, 캘린더, 메일 정리.
    search        : 검색만 하고 어디에도 도달하지 못했다. 무엇을 했는지 말할 수
                    없을 때만 쓴다 — 검색은 대개 수단이지 분야가 아니다.
    etc           : 위 어디에도 안 들어간다. 마지막 수단이다.
- outcome: 아래 기준으로 넷 중 하나를 고른다. 판단이 서지 않는다고 explore 로
  도망가지 마라 — explore 는 "목표가 없었다"는 적극적인 판정이지 기본값이 아니다.
    success : 찾던 것을 찾았거나 하려던 것을 해냈다. 검색 → 문서·해답 → **적용·확인**
              으로 이어진다. 배포 확인, 설정 완료, 문제 해결.
              **적용한 흔적이 곧 해결 신호다.** 마지막 구간이 그 주제라도 그게
              적용·확인이면(문서를 보고 코드를 고치고 결과를 확인한 흐름) success 다.
              반대로 마지막까지 **답을 찾고 있었다면**(검색어 반복, Q&A·이슈 문서를
              계속 오감) success 가 아니다. "어떻게 끝났나"가 잘렸다고 말하면 더욱 아니다.
    partial : 세션 안에 주제가 둘 이상이고, 그중 하나는 해결 신호(그 주제가 후반에
              사라짐)를 보이는데 다른 하나는 끝까지 남았다.
              세션이 한 주제로만 이뤄졌다면 partial 이 아니다 — 그 하나가 풀렸으면
              success, 안 풀렸으면 stuck 이다. 애매하다고 partial 로 도망가지 마라.
    stuck   : **세션 전체가 하나의 미해결 문제**일 때다. 같은 주제의 검색어가
              반복되고(n 이 크다), Q&A·이슈 문서를 오가며 끝난다. **적용한 흔적이 없다.**
              한 주제만 다뤘다는 것은 stuck 의 근거가 아니다 — 해결 신호(적용·확인)가
              없어야 stuck 이다.
              **한 주제가 반복돼도, 같은 세션에 적용·확인까지 간 다른 주제가 있으면
              partial 이다.** 하나라도 끝냈으면 세션 전체가 막힌 것은 아니다.
    explore : 정해진 목표 없이 둘러봤다. 검색어가 넓고 얕으며 한 주제에 오래 머물지
              않는다. 특정 주제를 파고든 흔적이 있으면 explore 가 아니다.
- is_first_time: 기존 스킬 목록에 없던 것을 이번에 처음 시도했으면 true.
- skills: 이번에 사용하거나 습득한 스킬과 비중(weight, 1~10). 기존 스킬 목록과 이름이
  겹치면 반드시 동일한 표기를 재사용한다 — "TS"·"타입스크립트"처럼 같은 스킬을 다른
  이름으로 만들어내지 않는다.
- dialogues: **반드시 4개** — morning, afternoon, evening, night 슬롯당 정확히 하나씩.
  하나라도 빠뜨리면 안 된다. 각각 이번 세션 내용을 반영해 캐릭터가 사용자에게 건네는
  자연스러운 한국어 반말 한 마디, 80자 이내. 시간대에 맞는 어감으로 쓴다
  (아침이면 하루를 여는 톤, 밤이면 하루를 돌아보는 톤).
- thread: 이 경험이 진행 중인 작업의 연장인지 판정한다.
    attach : 목록의 그 작업과 **같은 대상**을 계속 다뤘을 때만 고른다.
             같은 저장소, 같은 기능, 같은 문서, 같은 버그, 같은 강의.
             existing_thread_id 에 목록에 있는 id 를 그대로 적는다
             (목록에 없는 id 를 만들어내지 않는다).
    new    : 위에 해당하지 않으면 전부 new. 목록이 비었으면 무조건 new.
             title 은 그 작업을 부르는 짧은 명사구 — **무엇을 다루는지가
             제목에 드러나야 한다**("Redis 캐싱 도입", "Army Sim 배포 설정").
             "개발", "공부", "작업" 같은 분야명은 제목이 아니다.

  **분야(category)가 같다는 것은 attach 의 근거가 아니다.** 목록에
  "프로젝트 A 개발"이 있고 이번에 프로젝트 B 를 개발했다면 둘 다 dev 지만
  서로 다른 작업이다 — 이때는 new 다. 목록 항목의 "최근:" 줄에 그 작업에서
  마지막으로 한 일이 적혀 있으니, 이번 세션이 그 일의 다음 단계인지로 판단하라.
  애매하면 new 로 간다. 잘못 붙이면 서로 다른 두 작업이 한 덩어리로 뭉쳐
  영원히 분리되지 않지만, 잘못 나누면 나중에 사람이 합칠 수 있다. completed 는 그 작업에 **더 할 일이 남지 않았을 때만** true 다.
  배포가 끝나 동작을 확인했다, 기능을 붙이고 테스트가 통과했다처럼 마무리가
  분명해야 한다. **완결은 드문 일이다 — 대부분의 세션은 진행 중이다.**
  다음은 완결이 아니다:
    · 무엇이 끝났는지 한 문장으로 말할 수 없는 세션(여러 주제를 오간 경우)
    · 읽거나 알아보기만 하고 적용하지 않은 것
    · 이번에 처음 시작한 일 — 시작과 완결이 같은 세션인 경우는 드물다
  특히 action="new" 이면서 completed=true 는 다시 생각하라. 방금 만든 작업을
  그 자리에서 끝내는 셈이다. 정말 한 세션에 시작하고 끝냈는지 확인하라.`;

// strict: true 로 스키마 위반 자체를 막는다. 그래도 최종 검증은 항상
// experienceOutputSchema.safeParse 로 한다 (weight 범위 등 strict 가 못 잡는 제약도 있다).
export const RECORD_EXPERIENCE_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    '이번 브라우징 세션을 "경험" 하나로 압축한 결과를 기록한다. 반드시 이 툴을 호출해서 응답한다.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '세션을 한 문장으로 요약. "~했다"체로 끝낸다. 100자 이내.',
      },
      detail: {
        type: 'string',
        description: '2~3문장으로 조금 더 자세히 설명. 없어도 된다.',
      },
      category: {
        type: 'string',
        enum: [...EXPERIENCE_CATEGORIES],
        description:
          '이 경험의 카테고리. 세션에 적힌 카테고리는 도메인 사전 조회 결과일 뿐이니 내용으로 다시 판정한다.',
      },
      outcome: {
        type: 'string',
        enum: [...EXPERIENCE_OUTCOMES],
        description:
          'success: 하려던 것을 해냈다 / partial: 일부만 됐다 / stuck: 같은 문제를 붙들고 끝났다 / ' +
          'explore: 목표 없이 둘러봤다. 애매하다고 explore 를 고르지 않는다.',
      },
      is_first_time: {
        type: 'boolean',
        description: '기존 스킬 목록에 없던 것을 이번에 처음 시도했는가.',
      },
      skills: {
        type: 'array',
        description:
          '이번에 사용/습득한 스킬 목록. 기존 스킬 목록과 이름이 겹치면 동일 표기를 재사용한다.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '스킬 이름. 기존 표기와 일치시킨다.' },
            weight: { type: 'integer', description: '이 경험에서 이 스킬의 비중. 1~10.' },
          },
          required: ['name', 'weight'],
          additionalProperties: false,
        },
      },
      dialogues: {
        type: 'array',
        description:
          '반드시 4개 — morning/afternoon/evening/night 슬롯당 정확히 하나씩. 각 80자 이내 반말.',
        items: {
          type: 'object',
          properties: {
            slot: { type: 'string', enum: [...DIALOGUE_SLOTS] },
            text: { type: 'string', description: '80자 이내 반말 대사.' },
          },
          required: ['slot', 'text'],
          additionalProperties: false,
        },
      },
      thread: {
        type: 'object',
        description:
          '이 경험이 기존 진행 중 작업(thread)의 연장인지, 새 작업인지 판단한 결과.',
        properties: {
          action: {
            type: 'string',
            enum: ['attach', 'new'],
            description:
              'attach: "진행 중인 작업 목록"에 있는 기존 작업의 연장. new: 새로운 작업의 시작.',
          },
          existing_thread_id: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'action이 attach일 때 "진행 중인 작업 목록"에서 고른 thread의 id 를 그대로 적는다. new일 때는 null.',
          },
          title: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'action이 new일 때 이 작업을 부르는 짧은 명사구 제목("Redis 캐싱 도입" 같은). attach일 때는 null.',
          },
          completed: {
            type: 'boolean',
            description: '이 경험으로 그 작업이 완결됐다고 볼 수 있는가.',
          },
        },
        required: ['action', 'existing_thread_id', 'title', 'completed'],
        additionalProperties: false,
      },
    },
    required: ['summary', 'category', 'outcome', 'is_first_time', 'skills', 'dialogues', 'thread'],
    additionalProperties: false,
  },
};

// ------------------------------------------------------------
// Memory Engine — thread 완결과 별개로 memory_score 가 이 임계값을 넘으면
// memories 를 하나 더 남긴다. 어느 트리거인지는 breakdown 에서 어느 규칙이
// 발동했는지로 정한다 ('new_skill' | 'breakthrough' | 'revival' | 'comeback').
// ------------------------------------------------------------
// 80 이었을 때는 "신규 스킬 + 첫 시도"가 겹치는 경우 말고는 넘을 길이 사실상
// 없었다(50/40/30/20 조합상 두 개가 겹쳐야만 도달). is_first_time 이 잘 안 뜨면
// 그 유일한 길마저 막혀서 하루 여섯 경험에 기억 0건이 나온다. 60 으로 낮추면
// 신규 스킬 하나만으로는 여전히 부족하지만(50), 거기에 뭐라도 하나 겹치면 남는다.
const MEMORY_SCORE_THRESHOLD = 60;

/** 경험 하나에 붙일 수 있는 스킬 수. 넘치면 비중 높은 것부터 남긴다. */
const MAX_SKILLS_PER_EXPERIENCE = 10;
/** 요약 표시 상한. 넘치면 자른다 — 길다고 경험을 버리지 않는다. */
const MAX_SUMMARY_LEN = 100;

// 이 기간 이상 안 쓴 스킬이 다시 나오면 "휴면 스킬 재등장"으로 본다.
// lib/emotion.ts 의 '그리움' 판정과 같은 값을 쓴다 — 같은 현상을 감정과 기억이
// 각각 다르게 부르면 사용자가 둘을 연결하지 못한다.
const DORMANT_SKILL_DAYS = 30;

/** 모든 가산항이 참일 때의 점수. 중요도 스케일의 위쪽 끝이다.
 *  50(새 스킬) + 40(처음) + 35(돌파) + 30(복귀) + 25(묵힌 스킬) + 20(긴 세션) */
const MAX_MEMORY_SCORE = 200;

/** 점수 → 중요도(1~10).
 *
 *  score/10 은 쓸 수 없다. 기억은 60점 문턱을 넘어야 생기므로 그 변환은
 *  6~10 만 만들어내고 **1~5 는 수학적으로 존재할 수 없었다** — 10단계 스케일의
 *  절반이 죽어 있었고, 지도의 크기(4 + importance*0.8)도 설계된 폭의 절반만
 *  써서 "크기가 중요도다"가 눈에 안 들어왔다.
 *  문턱~최대(60~200)를 1~10 에 편다.
 *
 *  문턱을 거치지 않는 thread_complete 기억은 60 미만일 수 있어 1 로 떨어진다 —
 *  다른 신호 없이 작업만 끝낸 기억이므로 그게 맞다. */
function clampImportance(score: number): number {
  const t = (score - MEMORY_SCORE_THRESHOLD) / (MAX_MEMORY_SCORE - MEMORY_SCORE_THRESHOLD);
  return Math.min(10, Math.max(1, 1 + Math.round(t * 9)));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// category → user_skills.domain 간단 매핑. 애매하면 'life'.
// domain 은 스킬이 "처음 생성"될 때만 정해지고, 이후 upsert 에서는 바뀌지 않는다.
// ------------------------------------------------------------
const PROGRAMMING_KEYWORDS = [
  '개발',
  '코딩',
  '코드',
  '프로그래밍',
  '디버그',
  '리팩토링',
  '버그',
  '엔지니어링',
  'dev',
  'code',
  'coding',
  'program',
  'engineer',
  'debug',
  'refactor',
  'backend',
  'frontend',
  'api',
  'typescript',
  'javascript',
  'python',
];

const ART_KEYWORDS = [
  '디자인',
  '그림',
  '음악',
  '작곡',
  '사진',
  '영상',
  '편집',
  '창작',
  '드로잉',
  'design',
  'art',
  'music',
  'drawing',
  'paint',
  'photo',
  'illustration',
];

function mapCategoryToDomain(category: string): 'programming' | 'art' | 'life' {
  const c = category.toLowerCase();
  if (PROGRAMMING_KEYWORDS.some((k) => c.includes(k))) return 'programming';
  if (ART_KEYWORDS.some((k) => c.includes(k))) return 'art';
  return 'life';
}

// LLM 이 같은 스킬을 중복으로 낼 수 있으니 이름으로 합치고 weight 는 1~10 으로 clamp 한다.
function dedupeSkills(skills: ExperienceOutput['skills']): { name: string; weight: number }[] {
  const merged = new Map<string, number>();
  for (const s of skills) {
    const clamped = Math.min(10, Math.max(1, Math.round(s.weight)));
    merged.set(s.name, Math.min(10, (merged.get(s.name) ?? 0) + clamped));
  }
  return Array.from(merged.entries()).map(([name, weight]) => ({ name, weight }));
}

// ------------------------------------------------------------
// 프롬프트 조립
// ------------------------------------------------------------

interface SessionRow {
  primaryCategory: string;
  durationMin: number;
  /** 세션이 어떻게 끝났는지. outcome 판정의 강력한 근거인데 빠져 있었다. */
  closeReason: string;
  /** 스크롤·클릭·키의 가중합. "40분 정독"과 "40분 열어둠"을 가른다. */
  activityScore: number;
  domains: Record<string, number>;
  compressedLog: unknown;
}

export interface ExistingSkillRow {
  name: string;
  lastUsedAt: Date;
}

interface RecentExperienceRow {
  summary: string;
  category: string;
  outcome: string | null;
  /** 목록에 함께 적는다. 안 적으면 이 값만 교정됐을 때 [사람이 고침] 표시는
   *  붙는데 줄에는 바뀐 게 하나도 안 보여, 모델이 무엇이 고쳐졌는지 알 수 없다.
   *  is_first_time 은 기억(memories) 생성 경로를 여닫는 값이고 v3 에서 판정
   *  기준을 완화한 자리라, 사람 교정이 특히 값진 필드이기도 하다. */
  isFirstTime?: boolean;
  /** 이 경험의 판정을 사람이 고쳤는가. 프롬프트에서 declared 로 표시된다 —
   *  표시가 없으면 모델은 자기가 예전에 낸 값과 구분하지 못한다. */
  corrected?: boolean;
}

interface ActiveThreadRow {
  id: string;
  title: string;
  category: string;
  experienceCount: number;
  /** 그 작업에서 마지막으로 한 일. 제목만으로는 무엇을 하던 작업인지 모른다. */
  lastSummary?: string;
}

/** close_reason 을 LLM 이 쓸 수 있는 말로 옮긴다. 'maxlen' 은 특히 중요하다 —
 *  4시간에 잘렸다는 것은 하던 일이 끝나지 않았다는 뜻이라 success 의 반증이다. */
const CLOSE_REASON_HINT: Record<string, string> = {
  idle: '하던 것을 놓고 자리를 떴다 (30분 무활동)',
  switch: '다른 분야로 넘어갔다',
  maxlen: '4시간 상한에 잘렸다 — 하던 일이 끝나서 끝난 게 아니다',
  day: '새벽 4시 경계를 넘겼다 — 잘린 것이지 끝난 게 아니다',
  shutdown: '브라우저를 껐다',
};

function buildActiveThreadsList(activeThreads: ActiveThreadRow[]): string {
  if (activeThreads.length === 0) return '(진행 중인 작업 없음)';
  // 제목만 주면 그 작업이 무엇을 하던 것인지 알 수 없어, 분야만 같아도 붙이게
  // 된다. 마지막으로 한 일을 함께 줘야 "이번 세션이 그 다음 단계인가"를 볼 수 있다.
  return activeThreads
    .map((t, i) => {
      const head = `${i + 1}. id=${t.id} · "${t.title}" (카테고리: ${t.category}, 경험 ${t.experienceCount}건)`;
      return t.lastSummary ? `${head}\n   최근: ${t.lastSummary}` : head;
    })
    .join('\n');
}

export function buildUserMessage(
  session: SessionRow,
  existingSkills: ExistingSkillRow[],
  recentExperiences: RecentExperienceRow[],
  activeThreads: ActiveThreadRow[],
  /** 사람이 바로잡은 판정의 집계. 기본값이 빈 배열인 것은 재처리·평가
   *  스크립트가 이 인자를 넘기지 않아도 돌게 하기 위함이다. */
  correctionPatterns: CorrectionPattern[] = [],
): string {
  const skillsList =
    existingSkills.length > 0
      ? existingSkills.map((s) => `- ${s.name} (마지막 사용: ${kstYmd(s.lastUsedAt)})`).join('\n')
      : '(아직 기록된 스킬 없음)';

  const recentList =
    recentExperiences.length > 0
      ? recentExperiences
          .map((e, i) => {
            // [사람이 고침] 표시가 이 목록의 핵심이다. 이게 없으면 모델은
            // 사람이 정정한 값과 자기가 예전에 낸 값을 구분하지 못하고,
            // 프롬프트의 우선순위 규칙이 걸릴 대상 자체가 사라진다.
            const mark = e.corrected ? ' [사람이 고침]' : '';
            // 교정 가능한 세 필드를 전부 적는다. 하나라도 빠지면 그 필드만
            // 고쳤을 때 표시는 붙는데 줄은 그대로라, 무엇이 고쳐졌는지 알 수 없다.
            const first = e.isFirstTime === undefined ? '' : `/${e.isFirstTime ? '처음' : '해봄'}`;
            return `${i + 1}. [${e.category}/${e.outcome ?? '-'}${first}]${mark} ${e.summary}`;
          })
          .join('\n')
      : '(아직 기록된 경험 없음)';

  // 개별 경험이 아니라 분포다. 최근 경험 3건 창에 교정이 갇히는 문제를 푼다 —
  // 여긴 안 늙어서, 사흘 전에 고친 것도 계속 보인다.
  const patternList =
    correctionPatterns.length > 0
      ? correctionPatterns
          .map((p) => `- ${p.field}: ${p.from} → ${p.to} (${p.count}회)`)
          .join('\n')
      : null;

  return [
    '## 기존 컨텍스트',
    '### 보유 스킬 목록',
    skillsList,
    '',
    '### 최근 경험 3건 (최신순)',
    recentList,
    '',
    ...(patternList
      ? ['### 네가 바로잡힌 판정 (사람이 고친 것)', patternList, '']
      : []),
    '### 진행 중인 작업(thread) 목록 (최근 활동순, 최대 5개)',
    buildActiveThreadsList(activeThreads),
    '',
    '## 이번 세션',
    `- 카테고리: ${session.primaryCategory}`,
    `- 길이: ${session.durationMin}분`,
    `- 어떻게 끝났나: ${CLOSE_REASON_HINT[session.closeReason] ?? session.closeReason}`,
    `- 활동량: ${session.activityScore} (스크롤·클릭·키의 가중합. 분당 10 이상이면 손이 바빴다는 뜻)`,
    `- 방문 도메인(도메인별 체류 시간 등): ${JSON.stringify(session.domains)}`,
    '- 압축 로그(타임라인):',
    JSON.stringify(session.compressedLog),
  ].join('\n');
}

// ------------------------------------------------------------
// 메인 파이프라인
// ------------------------------------------------------------

/** 동시 처리로 이 세션의 경험이 이미 만들어졌을 때. 트랜잭션을 실제로 롤백시키려고
 *  던지는 전용 오류 — 바깥에서 이것만은 조용히 넘긴다(재처리 대상으로 남길 필요가 없다). */
class SessionAlreadyProcessedError extends Error {
  constructor(sessionId: string) {
    super(`session already processed: ${sessionId}`);
    this.name = 'SessionAlreadyProcessedError';
  }
}

export async function processSession(sessionId: string, userId: string): Promise<void> {
  try {
    // 1. 멱등 가드
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!session || session.processedAt) return;

    // 2. 컨텍스트 로드
    // 전부 가져온다. 예전에는 limit(50) 이었는데, 이 집합이 프롬프트용 목록일
    // 뿐 아니라 hasNewSkill 과 dormantSkillReturned 판정의 유일한 근거였다.
    // 그래서 51번째로 오래된 스킬을 다시 쓰면 "처음 해봤다"(new_skill, +50)로
    // 기록됐다 — 하필 정확히 휴면 상태인 스킬만 골라서 오판하므로 revival
    // 트리거는 스킬이 50개를 넘은 시점부터 사실상 영구히 발동 불가였다.
    // 스킬 수는 사용자당 수십~수백이라 전량 조회가 비싸지 않다.
    const existingSkillRows = await db
      .select({ name: userSkills.skillName, lastUsedAt: userSkills.lastUsedAt })
      .from(userSkills)
      .where(eq(userSkills.userId, userId))
      .orderBy(desc(userSkills.lastUsedAt));
    const existingSkillNames = new Set(existingSkillRows.map((s) => s.name));
    // 프롬프트에는 최근 것만 넣는다(토큰). 판정은 위 전체 집합으로 한다.
    const skillRowsForPrompt = existingSkillRows.slice(0, PROMPT_SKILL_LIMIT);

    const recentExperienceRows = await db
      .select({
        id: experiences.id,
        summary: experiences.summary,
        category: experiences.category,
        outcome: experiences.outcome,
        isFirstTime: experiences.isFirstTime,
        occurredAt: experiences.occurredAt,
      })
      .from(experiences)
      // **이 세션보다 앞선 것만.** 확장이 오프라인이었다가 사흘 뒤에 세션을
      // 보내면, 유저 조건만 걸었을 때 "최근 경험 3건"에 그 세션보다 나중에
      // 일어난 경험이 들어간다 — 모델이 미래를 보고 판정하는 셈이다.
      // dry-reprocess.mts 는 이미 같은 필터를 걸고 있어서, 이게 없으면
      // 같은 세션을 재처리했을 때 라이브 때와 다른 컨텍스트로 판정된다.
      .where(and(eq(experiences.userId, userId), lt(experiences.occurredAt, session.startedAt)))
      .orderBy(desc(experiences.occurredAt))
      .limit(3);

    // 사람이 고친 판정을 겹친다. experiences 는 불변이라 저장된 값이 모델 값
    // 그대로고, 유효값은 읽을 때 만든다(lib/corrections.ts). 이걸 안 하면
    // 사용자가 어제 고쳐놓은 outcome 을 모델이 오늘 다시 자기 값으로 보고
    // 같은 실수를 반복한다 — 교정이 아무 데도 안 쓰이는 라벨 더미가 된다.
    const [recentCorrections, correctionPatterns] = await Promise.all([
      loadCorrections(recentExperienceRows.map((e) => e.id)),
      loadCorrectionPatterns(userId),
    ]);
    const recentForPrompt: RecentExperienceRow[] = recentExperienceRows.map((e) => ({
      summary: e.summary,
      category: effective(recentCorrections, e.id, 'category', e.category),
      outcome: effective(recentCorrections, e.id, 'outcome', e.outcome ?? ''),
      isFirstTime:
        effective(recentCorrections, e.id, 'is_first_time', String(e.isFirstTime)) === 'true',
      corrected:
        isCorrected(recentCorrections, e.id, 'category') ||
        isCorrected(recentCorrections, e.id, 'outcome') ||
        isCorrected(recentCorrections, e.id, 'is_first_time'),
    }));

    // 최근 경험 3건 각각의 "주요 스킬"(weight 최댓값) — 반복 패턴 판정용.
    const primarySkillByExperienceId = new Map<string, string | null>();
    if (recentExperienceRows.length > 0) {
      const skillRows = await db
        .select({
          experienceId: experienceSkills.experienceId,
          skillName: experienceSkills.skillName,
          weight: experienceSkills.weight,
        })
        .from(experienceSkills)
        .where(
          inArray(
            experienceSkills.experienceId,
            recentExperienceRows.map((e) => e.id),
          ),
        );

      const bestPerExperience = new Map<string, { name: string; weight: number }>();
      for (const row of skillRows) {
        const current = bestPerExperience.get(row.experienceId);
        if (!current || row.weight > current.weight) {
          bestPerExperience.set(row.experienceId, { name: row.skillName, weight: row.weight });
        }
      }
      for (const exp of recentExperienceRows) {
        primarySkillByExperienceId.set(exp.id, bestPerExperience.get(exp.id)?.name ?? null);
      }
    }

    // 최근 20개 세션(이번 세션 제외)의 duration_min — 평균 대비 2배 판정용.
    const recentSessionRows = await db
      .select({ durationMin: sessions.durationMin })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)))
      .orderBy(desc(sessions.startedAt))
      .limit(20);

    const [userRow] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);

    // 활성 thread 최대 5개 — "이 경험이 기존 진행 중 작업의 연장인지" 판단용 컨텍스트.
    const activeThreadRows = await db
      .select({
        id: threads.id,
        title: threads.title,
        category: threads.category,
        experienceCount: threads.experienceCount,
      })
      .from(threads)
      .where(and(eq(threads.userId, userId), eq(threads.status, 'active')))
      .orderBy(desc(threads.lastActivityAt))
      .limit(5);

    // 3. LLM 1회 호출 — structured output 은 tool use(단일 툴 강제) 방식.
    const client = new Anthropic();

    const sessionForPrompt: SessionRow = {
      primaryCategory: session.primaryCategory,
      durationMin: session.durationMin,
      closeReason: session.closeReason,
      activityScore: session.activityScore,
      domains: session.domains,
      compressedLog: session.compressedLog,
    };

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // 판정 작업이다. 기본값 1.0 으로는 같은 세션을 두 번 돌리면 outcome 이
      // 바뀐다 — 실제로 explore↔success↔partial 이 4/7 건 흔들렸다.
      // 창작(대사)도 같은 호출에 섞여 있지만, 흔들려선 안 되는 쪽을 우선한다.
      temperature: 0,
      system: SYSTEM_PROMPT_V4,
      tools: [RECORD_EXPERIENCE_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: buildUserMessage(
            sessionForPrompt,
            skillRowsForPrompt,
            recentForPrompt,
            activeThreadRows,
            correctionPatterns,
          ),
        },
      ],
    });

    // 무슨 일이 있었든 원본 출력을 남긴다. 검증 실패분도 valid=false 로 함께
    // 남겨야 "모델이 무엇을 뱉었나"를 나중에 물을 수 있다 — ingest_failures 는
    // 운영 알림용이라 성공한 판정의 근거가 어디에도 안 남았다.
    // 로깅 실패가 처리 자체를 막으면 안 되므로 삼킨다.
    const recordOutput = async (payload: unknown, valid: boolean) => {
      try {
        await db.insert(llmOutputs).values({
          userId,
          kind: 'experience',
          sessionId,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          output: payload,
          stopReason: response.stop_reason ?? null,
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          valid,
        });
      } catch (err) {
        console.error('[engine] llm_outputs 기록 실패', err);
      }
    };

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
    );

    if (!toolUse) {
      await recordOutput(null, false);
      await db.insert(ingestFailures).values({
        userId,
        sessionId,
        reason: 'llm_output_invalid: no tool_use block in response',
        payload: response.content,
      });
      return;
    }

    // 4. 출력 검증
    const parsed = experienceOutputSchema.safeParse(toolUse.input);
    await recordOutput(toolUse.input, parsed.success);
    if (!parsed.success) {
      await db.insert(ingestFailures).values({
        userId,
        sessionId,
        reason: `llm_output_invalid: ${parsed.error.message}`,
        payload: toolUse.input,
      });
      return;
    }

    const output = parsed.data;
    // 스키마 상한을 넉넉히 푼 만큼 여기서 자른다. 개수가 많다고 경험 전체를
    // 버리는 것보다, 합치고 상위만 남기는 편이 손실이 적다.
    const dedupedSkills = dedupeSkills(output.skills)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_SKILLS_PER_EXPERIENCE);
    const hasNewSkill = dedupedSkills.some((s) => !existingSkillNames.has(s.name));
    const primarySkillName = dedupedSkills.length > 0 ? [...dedupedSkills].sort((a, b) => b.weight - a.weight)[0].name : null;

    // thread 부착 판정 — LLM 환각 방어: 목록에 없는 existing_thread_id 면 new 로 강등.
    const activeThreadsById = new Map(activeThreadRows.map((t) => [t.id, t]));
    let threadAction: 'attach' | 'new' = output.thread.action;
    let attachTargetId = output.thread.existing_thread_id;
    // 강등 여부를 기억해둔다. completed 플래그를 그대로 살리면 안 되기 때문이다.
    let threadDemoted = false;
    if (threadAction === 'attach' && (!attachTargetId || !activeThreadsById.has(attachTargetId))) {
      threadAction = 'new';
      attachTargetId = null;
      threadDemoted = true;
    }

    const threadId = threadAction === 'new' ? randomUUID() : attachTargetId!;
    const threadTitle =
      threadAction === 'new'
        ? output.thread.title?.trim() || output.summary.slice(0, MAX_SUMMARY_LEN)
        : (activeThreadsById.get(threadId)?.title ?? output.summary.slice(0, MAX_SUMMARY_LEN));

    // 6. Memory Engine 점수 (순수 함수, LLM 재호출 없음)
    const daysSinceLastExperience =
      recentExperienceRows.length > 0
        ? Math.floor((session.startedAt.getTime() - recentExperienceRows[0].occurredAt.getTime()) / DAY_MS)
        : null;

    const recentExperienceSummaries: RecentExperienceSummary[] = recentExperienceRows.map((e) => ({
      category: e.category,
      primarySkillName: primarySkillByExperienceId.get(e.id) ?? null,
    }));

    // 막혔던 것을 뚫었는가 — 직전 경험이 stuck 인데 이번이 success.
    const brokeThrough =
      recentExperienceRows[0]?.outcome === 'stuck' && output.outcome === 'success';

    // 오래 묵혀둔 스킬이 돌아왔는가. existingSkillRows 에 이미 lastUsedAt 이
    // 실려 있어 추가 쿼리가 필요 없다.
    const lastUsedByName = new Map(existingSkillRows.map((r) => [r.name, r.lastUsedAt]));
    const dormantSkillReturned = dedupedSkills.some((sk) => {
      const last = lastUsedByName.get(sk.name);
      if (!last) return false; // 신규 스킬은 여기 해당 없음(그건 hasNewSkill 이 잡는다)
      return session.startedAt.getTime() - last.getTime() >= DORMANT_SKILL_DAYS * DAY_MS;
    });

    const memoryScoreResult = calculateMemoryScore({
      hasNewSkill,
      isFirstTime: output.is_first_time,
      brokeThrough,
      dormantSkillReturned,
      daysSinceLastExperience,
      durationMin: session.durationMin,
      recentSessionDurations: recentSessionRows.map((r) => r.durationMin),
      category: output.category,
      primarySkillName,
      recentExperiences: recentExperienceSummaries,
    });

    // 5. 저장 (트랜잭션)
    const now = new Date();
    const domain = mapCategoryToDomain(output.category);

    await db.transaction(async (tx) => {
      // action='new' 인 thread 는 experiences.thread_id FK 때문에 experience insert 보다
      // 먼저 만들어야 한다(참조 대상이 존재해야 FK 를 통과한다). 'attach' 는 기존 thread 를
      // 그대로 참조하므로 여기서 할 일이 없고, 카운트 갱신은 insertedExperience 확인 후로 미룬다
      // — 그래야 동시 처리로 experience insert 가 취소될 때 기존 thread 카운트가 잘못 증가하지 않는다.
      if (threadAction === 'new') {
        await tx.insert(threads).values({
          id: threadId,
          userId,
          title: threadTitle,
          category: output.category,
          status: 'active',
          startedAt: session.startedAt,
          lastActivityAt: session.startedAt,
          experienceCount: 1,
        });
      }

      const [insertedExperience] = await tx
        .insert(experiences)
        .values({
          userId,
          sessionId,
          threadId, // insert 시점에 부착 — 이렇게 하면 "유일한 UPDATE 대상"이던 thread_id 에 대한 UPDATE 자체가 없어진다.
          occurredAt: session.startedAt,
          summary: output.summary.slice(0, MAX_SUMMARY_LEN),
          detail: output.detail ?? null,
          category: output.category,
          outcome: output.outcome,
          isFirstTime: output.is_first_time,
          memoryScore: memoryScoreResult.score,
        })
        .onConflictDoNothing({ target: experiences.sessionId })
        .returning({ id: experiences.id });

      // experiences.session_id 는 UNIQUE — 동시 처리로 이미 만들어졌다.
      //
      // 여기서 `return` 하면 안 된다. postgres-js 의 client.begin 은 콜백이 정상
      // resolve 하면 COMMIT 한다 — return 은 롤백이 아니라 "건너뛰고 커밋"이다.
      // 그래서 위에서 만든 thread 행이 고아로 커밋되고, processed_at 도 안 채워지고,
      // ingest_failures 도 안 남는다. 그 조합이 최악이다: 재처리 스윕은
      // processed_at IS NULL 로 뽑는데 실패 기록이 없으니 백오프에 영영 안 걸려,
      // 스윕을 돌릴 때마다 LLM 을 한 번씩 태우고 고아 thread 를 하나씩 더 쌓는다.
      // 던져서 실제로 롤백시키고, 바깥 catch 가 ingest_failures 에 남기게 한다.
      if (!insertedExperience) {
        throw new SessionAlreadyProcessedError(sessionId);
      }

      if (dedupedSkills.length > 0) {
        await tx
          .insert(experienceSkills)
          .values(dedupedSkills.map((s) => ({ experienceId: insertedExperience.id, skillName: s.name, weight: s.weight })))
          .onConflictDoNothing({ target: [experienceSkills.experienceId, experienceSkills.skillName] });

        for (const skill of dedupedSkills) {
          await tx
            .insert(userSkills)
            .values({
              userId,
              skillName: skill.name,
              domain,
              points: skill.weight,
              useCount: 1,
              // "사용자가 실제로 쓴 시각" 기준 — experiences.occurred_at 과 마찬가지로
              // session.startedAt 을 쓴다(서버가 처리한 시각 `now` 가 아니다).
              firstUsedAt: session.startedAt,
              lastUsedAt: session.startedAt,
            })
            .onConflictDoUpdate({
              target: [userSkills.userId, userSkills.skillName],
              set: {
                points: sql`${userSkills.points} + ${skill.weight}`,
                useCount: sql`${userSkills.useCount} + 1`,
                // GREATEST 로 역행을 막는다 — 세션은 며칠 늦게 도착할 수 있어서
                // (예: 8/1 세션이 8/4 에 뒤늦게 도착) startedAt 을 무조건 덮어쓰면
                // 이미 8/3 으로 가 있던 lastUsedAt 이 8/1 로 되돌아간다.
                // 이 값은 프롬프트 컨텍스트("마지막 사용: ...")와 감정 판정
                // ("오래 안 쓴 스킬 재등장 → 그리움")에 그대로 쓰이므로 정확해야 한다.
                // (sql 템플릿에 Date 객체를 그대로 넣으면 컬럼 직렬화를 안 거쳐서
                // Date.toString() 형태로 바인딩되는 문제가 있어 ISO 문자열 + 명시적
                // 캐스트로 넘긴다.)
                lastUsedAt: sql`GREATEST(${userSkills.lastUsedAt}, ${session.startedAt.toISOString()}::timestamptz)`,
              },
            });
        }
      }

      for (const d of output.dialogues) {
        // DB CHECK(char_length <= 80) 이 막기 전에 서버에서 먼저 절단한다.
        const text = d.text.slice(0, 80);
        await tx
          .insert(dialogues)
          .values({ userId, slot: d.slot, text, sourceSessionId: sessionId })
          .onConflictDoUpdate({
            target: [dialogues.userId, dialogues.slot],
            set: { text, sourceSessionId: sessionId, generatedAt: now },
          });
      }

      // thread 부착 — action='new' 는 위에서 이미 만들었으니, 'attach' 인 경우만
      // 활동시각·경험수를 갱신한다.
      if (threadAction === 'attach') {
        await tx
          .update(threads)
          .set({
            // GREATEST 로 역행을 막는다 — 바로 위 userSkills upsert 와 같은 이유다.
            // 세션은 며칠 늦게 도착할 수 있는데(오프라인 버퍼링), 무조건 덮어쓰면
            // 어제까지 활동하던 thread 의 last_activity_at 이 두 달 전으로
            // 되돌아간다. 그러면 (a) 오늘 밤 배치가 살아있는 작업을 abandoned 로
            // 전이시키고 — 되돌리는 코드 경로가 없다 — (b) 활성 목록(최근순 5개)
            // 에서 밀려나 이후 경험이 붙을 수 없게 되며 (c) 성격의 완결형 축이
            // 오염된다.
            lastActivityAt: sql`GREATEST(${threads.lastActivityAt}, ${session.startedAt.toISOString()}::timestamptz)`,
            experienceCount: sql`${threads.experienceCount} + 1`,
            // 분야를 다시 센다 — 갈래의 category 는 "연 첫 경험의 판정"이 아니라
            // "지금까지 무엇을 한 작업인가"여야 한다.
            //
            // attach 판정 기준은 카테고리가 아니라 **대상**이다(프롬프트: "분야가
            // 같다는 것은 attach 의 근거가 아니다"). 그래서 한 갈래 안에 여러
            // 분야가 섞이는 게 정상이고, 첫 판정으로 고정하면 어긋난다 —
            // 문서만 읽으며 시작한 개발 작업이 영원히 docs 로 남는다.
            //
            // 이 값은 프롬프트의 활성 갈래 목록에도 그대로 실린다. 화면에서만
            // 고치면 모델은 계속 옛 값을 본다.
            //
            // 방금 INSERT 한 경험이 같은 트랜잭션 안에 있으므로 이번 것까지 세어진다.
            // 동률이면 이름순 — 매번 같은 값이 나와야 색이 흔들리지 않는다.
            category: sql`coalesce((
              select e.category from ${experiences} e
              where e.thread_id = ${threadId}
              group by e.category
              order by count(*) desc, e.category asc
              limit 1
            ), ${threads.category})`,
          })
          .where(eq(threads.id, threadId));
      }

      // thread 완결 → status 전이 + 기억 생성. thread 완결과 별개로 memory_score
      // 임계값을 넘으면 'new_skill'/'comeback' 기억을 하나 더 남긴다(둘 다 발생 가능).
      let newMemoriesCount = 0;

      // 강등된 attach 의 completed 는 무시한다. LLM 은 "그 기존 작업이 끝났다"고
      // 말한 것인데 그 작업은 존재하지 않았다 — 방금 만든 새 thread 를 즉시
      // 완결시키면 존재한 적 없는 작업의 완결 기억이 생기고 완결형 축이 부푼다.
      if (output.thread.completed && !threadDemoted) {
        await tx.update(threads).set({ status: 'completed', completedAt: now }).where(eq(threads.id, threadId));

        await tx.insert(memories).values({
          userId,
          threadId,
          experienceId: insertedExperience.id,
          occurredAt: session.startedAt,
          title: threadTitle,
          body: output.detail ?? output.summary,
          importance: clampImportance(memoryScoreResult.score),
          trigger: 'thread_complete',
        });
        newMemoriesCount += 1;
      }

      if (memoryScoreResult.score >= MEMORY_SCORE_THRESHOLD) {
        // 어느 규칙이 이 기억을 만들었는지가 곧 trigger 다. 위에서부터 먼저 맞는 것.
        const bd = memoryScoreResult.breakdown;
        const trigger = bd.hasNewSkill || bd.isFirstTime
          ? 'new_skill'
          : bd.brokeThrough
            ? 'breakthrough'
            : bd.dormantSkillReturned
              ? 'revival'
              : 'comeback';

        await tx.insert(memories).values({
          userId,
          threadId,
          experienceId: insertedExperience.id,
          occurredAt: session.startedAt,
          // experiences.summary 와 같은 상한으로 자른다. 안 그러면 같은 문장이
          // 경험에는 100자, 기억에는 600자로 저장돼 두 화면이 다른 길이를 보여준다.
          title: output.summary.slice(0, MAX_SUMMARY_LEN),
          body: output.detail ?? output.summary,
          importance: clampImportance(memoryScoreResult.score),
          trigger,
        });
        newMemoriesCount += 1;
      }

      const [{ count: skillCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userSkills)
        .where(eq(userSkills.userId, userId));

      const [characterRow] = await tx
        .select({
          experienceCount: characters.experienceCount,
          memoryCount: characters.memoryCount,
          oldestMemoryAt: characters.oldestMemoryAt,
        })
        .from(characters)
        .where(eq(characters.userId, userId))
        .for('update');

      const newExperienceCount = (characterRow?.experienceCount ?? 0) + 1;
      const daysSinceSignup = userRow ? Math.floor((now.getTime() - userRow.createdAt.getTime()) / DAY_MS) : 0;
      const newLevel = calculateLevel({
        experienceCount: newExperienceCount,
        skillCount,
        daysSinceCreated: daysSinceSignup,
      });

      const newMemoryCount = (characterRow?.memoryCount ?? 0) + newMemoriesCount;
      const existingOldestMemoryAt = characterRow?.oldestMemoryAt ?? null;
      const newOldestMemoryAt =
        newMemoriesCount > 0
          ? existingOldestMemoryAt && existingOldestMemoryAt < session.startedAt
            ? existingOldestMemoryAt
            : session.startedAt
          : existingOldestMemoryAt;

      await tx
        .update(characters)
        .set({
          experienceCount: newExperienceCount,
          skillCount,
          level: newLevel,
          memoryCount: newMemoryCount,
          oldestMemoryAt: newOldestMemoryAt,
          lastComputedAt: now,
        })
        .where(eq(characters.userId, userId));

      await tx.update(sessions).set({ processedAt: now }).where(eq(sessions.id, sessionId));
    });
  } catch (err) {
    console.error('[processSession] failed', sessionId, err);
    try {
      await db.insert(ingestFailures).values({
        userId,
        sessionId,
        reason: `experience_engine_error: ${err instanceof Error ? err.message : String(err)}`,
        payload: null,
      });
    } catch (logErr) {
      console.error('[processSession] failed to record ingest_failures', sessionId, logErr);
    }
  }
}
