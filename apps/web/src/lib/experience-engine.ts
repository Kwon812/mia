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
import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
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
  DORMANT_DAYS,
  EXPERIENCE_CATEGORIES,
  MAX_DIALOGUE_LEN,
  calculateLevel,
  clampSentence,
  experienceOutputSchema,
  type ExperienceCategory,
  type ExperienceOutput,
  type SkillDomain,
} from '@na/shared';
import { db } from './db';
import {
  effective,
  isCorrected,
  loadCorrectionPatterns,
  loadCorrections,
  type CorrectionPattern,
} from './corrections';
import {
  MEMORY_SCORE_THRESHOLD,
  calculateMemoryScore,
  clampImportance,
  memoryImportance,
  type RecentExperienceSummary,
} from './memory-score';

// ------------------------------------------------------------
// LLM 호출 설정
// ------------------------------------------------------------

// 저비용 모델. 세션 하나당 1회만 호출되므로 Haiku 로 충분하다 (claude-api 스킬 캐시 기준 모델 ID).
export const MODEL = 'claude-haiku-4-5';

export const TOOL_NAME = 'record_experience';

/** SYSTEM_PROMPT 의 버전 번호. llm_outputs 에 남겨 프롬프트 간 비교의
 *  기준으로 쓴다 — 프롬프트를 고치면 여기도 올린다.
 *  v5: 스킬마다 domain 을 모델이 직접 고른다(예전에는 코드가 세션 category 를 복사).
 *  v6: thread.completed 를 아예 안 묻는다(사람이 표시) + 잠긴 작업 후보를 준다.
 *  v7: 압축 로그가 구간별 체류 시간(sec)·곁가지(via)·앞부분 요약(earlier)을 싣는다.
 *      예전에는 상한 20칸이 1분 미만 경유지로 차서 긴 세션의 앞부분이 통째로
 *      잘려나갔다(실측 14/18 세션, 241분 중 234분이 안 보인 경우까지). 그 상태의
 *      판정은 세션이 아니라 끝자락에 대한 판정이다. */
export const PROMPT_VERSION = 7;

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
export const SYSTEM_PROMPT_V7 = `너는 사용자의 브라우징 세션 하나를 "경험" 하나로 압축하는 엔진이다.

사용자 메시지로 이번 세션의 압축 로그(compressed_log)·카테고리·길이(분)·방문 도메인과,
이 사용자의 기존 컨텍스트(보유 스킬 목록, 최근 경험 3건, 진행 중인 작업 목록)를 함께 받는다.

compressed_log 에는 구간(segments)마다 도메인·카테고리·시각 외에 그 구간에서 관측된
페이지 제목(title)과 경로 예시(paths)가, 그리고 세션 전체의 검색어(queries)가 들어있다.
검색 쿼리는 사용자가 무엇을 궁금해했는지, 페이지 제목은 무엇을 읽었는지 알려준다.

구간에 **sec 이 있으면 시간은 그것으로 읽어라. start~end 가 아니다.**
start~end 는 그 구간의 첫 관측과 마지막 관측 사이일 뿐이라, 관측이 한 번뿐이면 0 이 된다 —
2분을 머물러도 start 와 end 가 같다. 실제 체류 시간은 sec(초)다. (옛 세션에는 이 값이
없을 수 있고, 그때는 지금까지처럼 시각으로 어림잡는다.)

via 가 있으면 그 구간에 딸린 **1분도 안 머물고 스쳐간 곳**이다("도메인 · 제목" 꼴). 별도
구간을 차지할 만큼은 아니지만 무엇을 거쳤는지는 알려준다 — 잠깐 열어본 문서·대시보드 같은 것.

earlier 가 있으면 그건 **이 세션의 앞부분**이고, 길어서 상세를 다 싣지 못해 합계만 남긴
것이다. top 의 각 항목은 "무엇을 몇 초" 이고 **i 는 segments 에서 이어지는 구간 번호**라,
segment_ids 에 그대로 쓸 수 있다. segments 는 그 뒤의 최근 구간들이다.
**earlier 가 있으면 세션은 segments 에 보이는 것보다 훨씬 길다.** 요약할 때 앞부분을 빼고
"마지막에 한 일"만 말하지 마라 — earlier 의 시간이 segments 보다 클 수도 있다.

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
                    배포 콘솔·CI 대시보드·DB 콘솔에서 빌드를 돌리거나 롤백을
                    실행한 것도 dev 다 — 도구가 코드 편집기가 아니어도 하는 일이
                    소프트웨어를 굴리는 것이면 dev 다(productivity 가 아니다).
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
  **마무리를 판단하는 기준**은 둘이다. 무엇이 끝났는지 한 문장으로 말할 수 없으면
  (여러 주제를 오갔다면) 마무리된 것이 아니고, 읽거나 알아보기만 하고 적용하지
  않은 것도 마무리가 아니다.
- is_first_time: 기존 스킬 목록에 없던 것을 이번에 처음 시도했으면 true.
- skills: 이번에 사용하거나 습득한 스킬과 비중(weight, 1~10). 기존 스킬 목록과 이름이
  겹치면 반드시 동일한 표기를 재사용한다 — "TS"·"타입스크립트"처럼 같은 스킬을 다른
  이름으로 만들어내지 않는다.
  각 스킬에 domain 을 붙인다 — **그 스킬 자체가 어느 갈래의 능력인지**를 본다.
  이번 세션이 무엇이었는지는 근거가 아니다.
    programming : 소프트웨어를 만들고 돌리는 능력. 언어·프레임워크·DB·인프라·
                  버전관리·배포·코딩 보조 도구.
    art         : 만들어내는 능력. 디자인·그림·영상·사진·작곡·편집 도구.
    life        : 그 밖의 생활·업무 능력. 메모·협업·문서·가계·학습 도구.
  같은 세션에서 나온 스킬이라도 갈래는 서로 다를 수 있다 — 개발하다 Figma 를 썼으면
  그 Figma 는 art 다. 애매하면 life 로 둔다.
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
  영원히 분리되지 않지만, 잘못 나누면 나중에 사람이 합칠 수 있다.

  "잠긴 작업" 목록이 함께 오면 거기에도 attach 할 수 있다. 그 일을 **다시
  시작한 게 분명할 때만** 붙인다 — 도구나 사이트가 같다는 것만으로는 부족하고,
  그때 하다 만 것("마지막:" 줄)의 다음 단계여야 한다.

  작업이 끝났는지는 판단하지 않는다. 그건 사람이 직접 표시한다.
- segment_ids: 위 summary 가 어느 구간들에서 나왔는지, 구간 번호(i)를 적는다.
  세션 전체가 하나의 일이었으면 빈 배열로 둔다.
- also: 같은 세션에 **뚜렷이 다른 작업**이 더 있었으면 그것만큼 더 적는다.

## 한 세션에 일이 둘일 때

세션은 분야가 바뀔 때 끊긴 관측 단위일 뿐이라, 그 안에 서로 다른 작업이 섞일 수 있다.
**대상이 다른지는 도메인이 아니라 제목으로 본다** — 같은 localhost 라도 제목이
"Project NA" 와 "SOLDIER : A DAY" 면 다른 일이고, 반대로 저장소·배포·로컬·DB 콘솔은
도메인이 달라도 한 프로젝트의 다른 표면이라 **같은 일**이다.

**기본은 나누지 않는 것이다.** 애매하면 하나로 두고 부수적인 것은 detail 에 한 줄로
적는다. 나눌 때는 구간을 배타적으로 배정하고(한 구간은 한 경험에만), 어느 쪽인지
모르는 구간은 **아무 데도 넣지 않는다.** 검색은 대개 수단이라 앞뒤 대상 구간에 붙인다.
earlier 의 항목에도 번호(i)가 있어 배정할 수 있다.`;

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
            domain: {
              type: 'string',
              enum: ['programming', 'art', 'life'],
              description:
                '이 스킬 자체가 어느 갈래의 능력인가. 이번 세션이 무엇이었는지가 아니라 스킬의 성격으로 정한다.',
            },
          },
          required: ['name', 'weight', 'domain'],
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
        },
        required: ['action', 'existing_thread_id', 'title'],
        additionalProperties: false,
      },
      segment_ids: {
        type: 'array',
        description:
          '이 경험이 나온 compressed_log.segments 의 번호(i). 세션 전체가 하나의 일이면 빈 배열.',
        items: { type: 'integer' },
      },
      also: {
        type: 'array',
        description:
          '같은 세션에 **뚜렷이 다른 작업**이 더 있었으면 그것들. 대개 빈 배열이다.',
        items: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '그 일을 한 문장으로. "~했다"체.' },
            detail: { type: 'string', description: '2~3문장. 없어도 된다.' },
            category: { type: 'string', enum: [...EXPERIENCE_CATEGORIES] },
            outcome: { type: 'string', enum: [...EXPERIENCE_OUTCOMES] },
            is_first_time: { type: 'boolean' },
            skills: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  weight: { type: 'integer' },
                  domain: { type: 'string', enum: ['programming', 'art', 'life'] },
                },
                required: ['name', 'weight', 'domain'],
                additionalProperties: false,
              },
            },
            thread: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['attach', 'new'] },
                existing_thread_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['action', 'existing_thread_id', 'title'],
              additionalProperties: false,
            },
            segment_ids: {
              type: 'array',
              description: '이 일이 벌어진 구간 번호. 반드시 채운다 — 시간을 여기서 계산한다.',
              items: { type: 'integer' },
            },
          },
          required: [
            'summary', 'category', 'outcome', 'is_first_time', 'skills', 'thread', 'segment_ids',
          ],
          additionalProperties: false,
        },
      },
    },
    // segment_ids 와 also 는 **required 가 아니다.**
    //
    // 둘을 required 로 뒀을 때 골든셋이 15/17 → 13/17 로 내려갔다. 실패한 것이
    // 분할과 무관한 항목들(success·category 재판정·잠긴 갈래 부활)이라, 매
    // 호출에서 두 필드를 반드시 채우게 만든 것이 다른 판정을 밀어낸 것으로 본다.
    // 나누지 않는 세션에서는 이 둘이 아예 없는 게 맞기도 하다 — 기본은 나누지
    // 않는 것이니 "빈 값을 채우는 일"조차 없어야 한다.
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

/** 갈래에 경험이 이만큼 쌓이면 그 자체로 기억이 된다(trigger='deepened').
 *  6개월치 분포에서 상위 21%. 자세한 근거는 사용처 주석에 있다. */
const DEEPENED_THREAD_EXPERIENCES = 6;

/** 경험 하나에 붙일 수 있는 스킬 수. 넘치면 비중 높은 것부터 남긴다. */
const MAX_SKILLS_PER_EXPERIENCE = 10;
/** 갈래 제목 상한. 제목은 짧은 명사구라 이 이상 길면 목록이 무너진다.
 *  **요약과 기억 제목은 자르지 않는다** — 저장 시점에 자르면 상세 화면에서
 *  복구할 방법이 없다(원문은 llm_outputs 에만 남는다). 좁은 자리(지도 판독값)
 *  에서 표시할 때만 줄인다. 저장 상한은 zod 의 summary max(600) 이 맡는다. */
const MAX_THREAD_TITLE_LEN = 100;

// 이 기간 이상 안 쓴 스킬이 다시 나오면 "휴면 스킬 재등장"으로 본다.
// lib/emotion.ts 의 '그리움' 판정과 같은 값을 쓴다 — 같은 현상을 감정과 기억이
// 각각 다르게 부르면 사용자가 둘을 연결하지 못한다.
const DORMANT_SKILL_DAYS = DORMANT_DAYS;

/** 모든 가산항이 참일 때의 점수. 중요도 스케일의 위쪽 끝이다.
 *  50(새 스킬) + 40(처음) + 35(돌파) + 30(복귀) + 25(묵힌 스킬) + 20(긴 세션) */

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

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// 스킬의 domain 은 **LLM 이 스킬마다 직접 고른다**(experienceSkillSchema.domain).
// 여기 남은 건 모델이 그 칸을 빠뜨렸을 때의 대비책 하나뿐이다.
//
// 예전에는 경험의 category 를 키워드로 훑어 그 세션 스킬 **전부에 같은 값**을
// 찍었다. 두 가지가 동시에 틀렸다. (1) 스킬을 아예 안 봐서 dev 세션의 Figma 가
// programming 이 됐고, (2) 키워드 목록에 실제로 걸리는 category 는 'dev' 와
// 'music' 뿐이라 나머지 열하나는 전부 'life' 로 떨어졌다.
//
// 대신 도구 이름 사전을 코드에 박는 방법도 있었지만 그건 사람이 새 도구가
// 나올 때마다 목록을 채워야 한다 — 이름을 뱉은 주체가 갈래도 안다.
//
// 열셋 enum 을 남김없이 적는다. Record<ExperienceCategory, …> 라 category 가
// 하나 늘면 타입이 빠진 칸을 짚어준다.
// docs 를 programming 으로 두는 건 판단이다(이 제품에서 문서는 대체로 기술
// 문서다). study 는 어학·자격증도 섞여서 life 로 둔다.
const CATEGORY_DOMAIN: Record<ExperienceCategory, SkillDomain> = {
  dev: 'programming',
  ai: 'programming',
  docs: 'programming',
  study: 'life',
  music: 'art',
  design: 'art',
  entertainment: 'life',
  community: 'life',
  news: 'life',
  finance: 'life',
  shopping: 'life',
  productivity: 'life',
  search: 'life',
  etc: 'life',
};

/** 모델이 domain 을 안 준 스킬의 대비책. */
function fallbackDomain(category: string): SkillDomain {
  return CATEGORY_DOMAIN[category as ExperienceCategory] ?? 'life';
}

// LLM 이 같은 스킬을 중복으로 낼 수 있으니 이름으로 합치고 weight 는 1~10 으로 clamp 한다.
function dedupeSkills(
  skills: ExperienceOutput['skills'],
  category: string,
): { name: string; weight: number; domain: SkillDomain }[] {
  const merged = new Map<string, { weight: number; domain: SkillDomain | undefined }>();
  for (const s of skills) {
    const clamped = Math.min(10, Math.max(1, Math.round(s.weight)));
    const prev = merged.get(s.name);
    merged.set(s.name, {
      weight: Math.min(10, (prev?.weight ?? 0) + clamped),
      // 같은 스킬이 두 번 나오면서 갈래가 엇갈리면 먼저 나온 판단을 지킨다.
      // 둘 다 없으면 아래에서 category 로 물러난다.
      domain: prev?.domain ?? s.domain,
    });
  }
  return Array.from(merged.entries()).map(([name, v]) => ({
    name,
    weight: v.weight,
    domain: v.domain ?? fallbackDomain(category),
  }));
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

/** tsquery 에 넣지 않는 말. 흔해서 어느 갈래에나 걸린다. */
const CANDIDATE_STOPWORDS = new Set([
  'the', 'and', 'com', 'www', 'https', 'http', 'notion', 'figma', 'github', 'google',
  '확인', '상태', '프로젝트', '작업', '페이지',
]);

/** 후보로 뽑힌 잠긴 작업. ActiveThreadRow 에 방치 기간만 더한 모양이다. */
export interface DormantThreadRow extends ActiveThreadRow {
  idleDays: number;
}

/**
 * 이번 세션과 어휘가 겹치는 잠긴 작업 셋.
 *
 * 신호는 **페이지 제목과 검색어**다. 도메인은 못 쓴다 — github.com 은 모든 dev
 * 갈래에 겹쳐서 변별력이 없다. 반대로 제목에는 프로젝트·도구 이름이 그대로
 * 뜨고("kt cloud TECH UP 2기", "Project NA") 그 표기는 잘 안 바뀐다.
 *
 * 매칭은 Postgres 가 한다. 갈래 쪽에 토큰을 저장해두지 않는 대신, 이미 있는 글
 * (threads.title 과 그 갈래에 붙은 experiences.summary)을 GIN 인덱스가 색인하고
 * 있어서 토큰 목록만 던지면 어느 갈래가 걸리는지 안다. 앱은 이긴 세 행만 받는다
 * — 950개 시점에도 요약 텍스트를 통째로 끌어오는 일이 없다.
 *
 * 뜻이 비슷해도 단어가 다르면 못 찾는다("Redis 캐싱" ↔ "메모리 히트율"). 그건
 * 임베딩의 영역인데, pgvector 와 세션당 임베딩 호출이 새로 붙는다. 이 데이터는
 * 고유명사가 제목에 그대로 뜨므로 단어 일치로 대부분 잡힌다 — 안 잡히는 게 눈에
 * 띄면 이 함수만 갈아끼우면 된다.
 */
/**
 * 기억을 갈래에 **모은다**. 이미 있으면 새로 만들지 않고 근거를 더한다.
 *
 * 예전에는 조건을 넘길 때마다 기억이 따로 생겼다. 그래서 같은 갈래에 기억이
 * 셋씩 붙었고(실데이터: 경험 9건 → 기억 3개) 셋 다 누르면 같은 위성 9건이 떴다.
 * 결국 같은 주제인데 제목만 다른 화면이 셋이었다.
 *
 * 제목·본문은 여기서 안 고친다. 근거가 늘었다는 표시(needs_resummary)만 세우고
 * 밤 배치가 한 번에 다시 쓴다 — 세션 처리 중에 LLM 을 부르면 "세션당 1회"가
 * 깨지고, 하루에 세 번 붙으면 세 번 부르게 된다.
 */
async function upsertThreadMemory(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    userId: string;
    threadId: string;
    experienceId: string;
    occurredAt: Date;
    title: string;
    body: string;
    trigger: string;
    /** 그 갈래에 지금까지 쌓인 경험 수. 중요도의 '얼마나 오래 붙들었나' 항이다. */
    threadExperienceCount: number;
  },
): Promise<'created' | 'appended'> {
  const [existing] = await tx
    .select({
      id: memories.id,
      experienceIds: memories.experienceIds,
      triggers: memories.triggers,
      importance: memories.importance,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, args.userId),
        eq(memories.threadId, args.threadId),
        isNull(memories.forgottenAt),
      ),
    )
    .limit(1);

  /** 근거들의 점수. 중요도는 이걸로 매번 다시 잰다. */
  async function scoresOf(ids: string[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({ s: experiences.memoryScore })
      .from(experiences)
      .where(inArray(experiences.id, ids));
    return rows.map((r) => r.s);
  }

  if (!existing) {
    await tx.insert(memories).values({
      userId: args.userId,
      threadId: args.threadId,
      experienceId: args.experienceId,
      experienceIds: [args.experienceId],
      occurredAt: args.occurredAt,
      title: args.title,
      body: args.body,
      importance: memoryImportance({
        evidenceScores: await scoresOf([args.experienceId]),
        threadExperienceCount: args.threadExperienceCount,
      }),
      trigger: args.trigger,
      triggers: [args.trigger],
    });
    return 'created';
  }

  // 같은 경험이 두 규칙에 동시에 걸릴 수 있다(6건째인데 점수도 높은 경우).
  // 그때는 근거가 하나 늘어난 게 아니라 이유가 하나 더 붙은 것이다.
  const ids = existing.experienceIds.includes(args.experienceId)
    ? existing.experienceIds
    : [...existing.experienceIds, args.experienceId];
  const trs = existing.triggers.includes(args.trigger)
    ? existing.triggers
    : [...existing.triggers, args.trigger];

  await tx
    .update(memories)
    .set({
      experienceIds: ids,
      triggers: trs,
      // 더하지 않고 **다시 잰다**. 예전에는 붙을 때마다 +1 이라 올라가기만 했고,
      // 근거의 세기와 무관해서 20점짜리 여덟 개가 110점짜리 하나보다 무거웠다.
      importance: memoryImportance({
        evidenceScores: await scoresOf(ids),
        threadExperienceCount: args.threadExperienceCount,
      }),
      // occurred_at 은 안 건드린다. 그 일이 처음 남을 만해진 순간이고,
      // 지도의 반경(나이)이 그 값이라 덮으면 오래된 일이 최근으로 보인다.
      needsResummary: true,
    })
    .where(eq(memories.id, existing.id));
  return 'appended';
}

async function findDormantCandidates(
  userId: string,
  session: SessionRow,
): Promise<DormantThreadRow[]> {
  // queries 는 지금 {q, n, first, last} 객체 목록이다(builder.ts 의 CompressedQuery).
  // 옛 세션에는 문자열 배열로 들어 있어 둘 다 받는다 — 객체를 그대로 join 하면
  // 검색어가 통째로 "[object Object]" 가 되어 이 후보 검색에서 사라진다.
  const log = session.compressedLog as
    | { segments?: { title?: string }[]; queries?: (string | { q?: string })[] }
    | null;
  const text = [
    ...(log?.segments ?? []).map((g) => g.title ?? ''),
    ...(log?.queries ?? []).map((q) => (typeof q === 'string' ? q : (q?.q ?? ''))),
  ].join(' ');

  const tokens = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9가-힣]+/)
        .filter((w) => w.length >= 2 && !CANDIDATE_STOPWORDS.has(w)),
    ),
  ].slice(0, 40);
  if (tokens.length === 0) return [];

  // OR 로 잇는다. tsquery 문법에 쓰이는 글자는 위 split 이 이미 걸러냈다.
  const query = tokens.join(' | ');

  const rows = await db.execute<{
    id: string;
    title: string;
    category: string;
    experience_count: number;
    idle_days: number;
    last_summary: string | null;
  }>(sql`
    select t.id, t.title, t.category, t.experience_count,
           extract(day from now() - t.last_activity_at)::int as idle_days,
           (select e2.summary from ${experiences} e2
             where e2.thread_id = t.id order by e2.occurred_at desc limit 1) as last_summary
      from ${threads} t
      join ${experiences} e on e.thread_id = t.id
     where t.user_id = ${userId}
       and t.status = 'abandoned'
       and (to_tsvector('simple', e.summary) @@ to_tsquery('simple', ${query})
         or to_tsvector('simple', t.title)  @@ to_tsquery('simple', ${query}))
     group by t.id, t.title, t.category, t.experience_count, t.last_activity_at
     order by sum(ts_rank(to_tsvector('simple', e.summary), to_tsquery('simple', ${query}))) desc
     limit 3`);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    experienceCount: r.experience_count,
    idleDays: r.idle_days,
    lastSummary: r.last_summary ?? undefined,
  }));
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

/** 잠긴 작업 한 줄. 진행 중 목록과 같은 모양에 **방치 기간**만 더한다.
 *  그게 없으면 모델이 "1년 넘게 안 만진 일"인 줄 모르고 가볍게 붙인다. */
function buildDormantThreadsList(rows: DormantThreadRow[]): string {
  return rows
    .map((t, i) => {
      const head = `${i + 1}. id=${t.id} · "${t.title}" (카테고리: ${t.category}, 경험 ${t.experienceCount}건, 마지막 활동 ${t.idleDays}일 전)`;
      return t.lastSummary ? `${head}\n   마지막: ${t.lastSummary}` : head;
    })
    .join('\n');
}

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
  /** 어휘가 겹쳐 후보로 뽑힌 잠긴 작업. 없으면 프롬프트에 절이 안 들어간다. */
  dormantThreads: DormantThreadRow[] = [],
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
    // 잠긴 작업은 후보가 있을 때만 넣는다. 없으면 절 자체가 사라져 지금까지와
    // 똑같은 프롬프트가 된다 — 있지도 않은 선택지를 보여주면 억지로 붙일
    // 구실만 준다.
    ...(dormantThreads.length > 0
      ? ['### 잠긴 작업(thread) — 30일 넘게 손 안 댔다', buildDormantThreadsList(dormantThreads), '']
      : []),
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

// ------------------------------------------------------------
// 한 세션이 여러 경험으로 나뉠 때
//
// 모델은 **어느 구간이 어느 일이었나**만 배정하고, 시간과 문턱은 여기서 잰다.
// 모델에게 분 단위 합산을 시키면 틀리고, 틀린 채로 저장되면 되돌릴 수 없다.
// ------------------------------------------------------------

/** 나눌 값어치가 있는 최소 시간. 전송 필터의 "10분 미만은 경험 하나로 부를
 *  만한 길이가 아니다"와 **같은 기준**이다 — 같은 말을 두 층에서 쓴다.
 *  다만 성격이 다르다: 저쪽은 버리는 문턱이고 여기는 나누는 문턱이라,
 *  못 넘으면 버리지 않고 주된 경험 안에 서술로 남는다. */
const MIN_SPLIT_SEC = 10 * 60;

/** 한 세션에서 만들 수 있는 경험 수. 넘치면 오래 머문 것부터 남긴다.
 *  세션 하나가 정말로 네 가지 일이었다면 그건 세션 분할 규칙의 문제지
 *  경험 분할로 풀 문제가 아니다. */
const MAX_ITEMS_PER_SESSION = 3;

interface LogSegment {
  start?: string;
  end?: string;
  /** 귀속 체류 시간(초). 옛 세션에는 없다. */
  sec?: number;
}

/**
 * 배정 가능한 구간 목록.
 *
 * 앞부분 요약(earlier)의 항목들도 **번호가 이어지므로 함께 담는다.** 상세는
 * 없지만 "무엇을 몇 분" 은 알고 있어서 시간 배분에 쓸 수 있다 — 이게 없으면
 * 긴 세션의 앞부분에서 오래 한 일은 영영 따로 떼어낼 수 없다.
 */
export function segmentsOf(log: unknown): LogSegment[] {
  const l = log as {
    segments?: LogSegment[];
    earlier?: { start?: string; top?: { i: number; sec: number }[] };
  } | null;
  const segs = Array.isArray(l?.segments) ? [...l.segments] : [];
  const top = l?.earlier?.top;
  if (Array.isArray(top)) {
    for (const p of top) {
      if (typeof p?.i !== 'number' || typeof p?.sec !== 'number') continue;
      // 앞부분은 시각을 하나로 본다 — 어차피 순서를 잃은 합계다.
      segs[p.i] = { start: l?.earlier?.start, end: l?.earlier?.start, sec: p.sec };
    }
  }
  return segs;
}

/** 구간의 체류 시간. sec 이 없는 옛 세션은 시각 차이로 어림잡는다 —
 *  그 값은 실제보다 작지만(관측이 하나뿐인 구간은 0), 비율로만 쓰므로
 *  없는 것보다 낫다. */
function secOf(seg: LogSegment | undefined): number {
  if (!seg) return 0;
  if (typeof seg.sec === 'number' && seg.sec >= 0) return seg.sec;
  if (!seg.start || !seg.end) return 0;
  const ms = new Date(seg.end).getTime() - new Date(seg.start).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
}

/** 저장 직전 형태로 정리된 경험 하나. */
export interface PlannedItem {
  summary: string;
  detail?: string;
  category: ExperienceCategory;
  outcome: ExperienceOutput['outcome'];
  is_first_time: boolean;
  skills: ExperienceOutput['skills'];
  thread: ExperienceOutput['thread'];
  /** 배정된 구간 번호. 안 나뉘었으면 빈 배열(= 세션 전체). */
  segmentIds: number[];
  occurredAt: Date;
  durationMin: number;
}

/**
 * 모델 출력 → 저장할 경험들.
 *
 * 나누지 않는 쪽이 기본이다. 아래 중 하나라도 걸리면 **통째로 안 나눈다** —
 * 나누다 어긋나느니 지금까지와 같은 결과가 낫다.
 *   · 구간 번호가 범위를 벗어나거나 두 경험에 겹쳐 배정됐다
 *   · 갈라진 것에 배정이 하나도 없다(시간을 잴 수 없다)
 *   · 구간 시간의 총합이 0 이다(옛 세션이라 잴 것이 없다)
 *
 * 문턱(10분)을 못 넘긴 것은 **버리지 않고** 주된 경험에 흡수한다. 요약은
 * detail 뒤에 붙이고 스킬과 구간도 합친다 — 지금도 detail 에 그렇게 적히고
 * 있으므로, 나누기 시작했다고 그 정보가 사라지면 퇴보다.
 */
export function planItems(
  output: ExperienceOutput,
  segList: LogSegment[],
  sessionDurationMin: number,
): PlannedItem[] {
  const head = {
    summary: output.summary,
    detail: output.detail,
    category: output.category,
    outcome: output.outcome,
    is_first_time: output.is_first_time,
    skills: [...output.skills],
    thread: output.thread,
    ids: [...(output.segment_ids ?? [])],
  };
  const rest = (output.also ?? []).map((a) => ({
    summary: a.summary,
    detail: a.detail,
    category: a.category,
    outcome: a.outcome,
    is_first_time: a.is_first_time,
    skills: [...a.skills],
    thread: a.thread,
    ids: [...(a.segment_ids ?? [])],
  }));

  const totalSec = segList.reduce((acc, s) => acc + secOf(s), 0);

  const seen = new Set<number>();
  const assignable =
    rest.length > 0 &&
    totalSec > 0 &&
    rest.every((r) => r.ids.length > 0) &&
    [head, ...rest].every((it) =>
      it.ids.every((i) => {
        if (!Number.isInteger(i) || i < 0 || i >= segList.length || seen.has(i)) return false;
        seen.add(i);
        return true;
      }),
    );

  const single = (): PlannedItem[] => {
    // 나누지 않으면 구간 배정도 남기지 않는다 — 세션 전체라는 뜻이다.
    const merged = [head, ...rest];
    const detail = merged
      .map((m) => m.detail ?? (m === head ? undefined : m.summary))
      .filter(Boolean)
      .join(' ');
    return [
      {
        summary: head.summary,
        detail: detail || undefined,
        category: head.category,
        outcome: head.outcome,
        is_first_time: head.is_first_time,
        skills: merged.flatMap((m) => m.skills),
        thread: head.thread,
        segmentIds: [],
        occurredAt: new Date(NaN), // 호출부가 세션 시작으로 채운다
        durationMin: sessionDurationMin,
      },
    ];
  };

  if (!assignable) return single();

  const secOfIds = (ids: number[]) => ids.reduce((acc, i) => acc + secOf(segList[i]), 0);

  // 문턱을 못 넘긴 갈래는 주된 경험으로 되돌린다. 오래 머문 것부터 보고,
  // 개수 상한을 넘긴 것도 같은 자리로 돌아간다 — 버리지 않는다.
  const kept: typeof rest = [];
  for (const r of [...rest].sort((a, b) => secOfIds(b.ids) - secOfIds(a.ids))) {
    if (secOfIds(r.ids) >= MIN_SPLIT_SEC && kept.length < MAX_ITEMS_PER_SESSION - 1) {
      kept.push(r);
      continue;
    }
    head.detail = [head.detail, r.summary].filter(Boolean).join(' ');
    head.skills.push(...r.skills);
    head.ids.push(...r.ids);
  }
  if (kept.length === 0) return single();

  const toItem = (it: (typeof head) | (typeof rest)[number]): PlannedItem => {
    const ids = [...it.ids].sort((a, b) => a - b);
    const starts = ids
      .map((i) => segList[i].start)
      .filter((v): v is string => typeof v === 'string')
      .map((v) => new Date(v).getTime())
      .filter((n) => Number.isFinite(n));
    return {
      summary: it.summary,
      detail: it.detail,
      category: it.category,
      outcome: it.outcome,
      is_first_time: it.is_first_time,
      skills: it.skills,
      thread: it.thread,
      segmentIds: ids,
      occurredAt: starts.length > 0 ? new Date(Math.min(...starts)) : new Date(NaN),
      // 세션 길이를 구간 시간의 비율로 나눈다. 배정 안 된 구간의 몫은 어느
      // 경험에도 안 간다 — 세션은 관측이고 경험은 해석이라, 해석이 관측
      // 전부를 덮을 필요가 없다. "197분 중 설명되는 건 27분"이 사실 그대로다.
      durationMin: Math.max(1, Math.round((sessionDurationMin * secOfIds(ids)) / totalSec)),
    };
  };

  // 시간순으로 둔다. 주된 경험이 뒤일 수도 있지만, 점수 규칙(공백·돌파)은
  // 배열 첫 항목을 "주된 것"으로 보므로 head 를 앞에 유지한다.
  return [toItem(head), ...kept.map(toItem)];
}

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

    // 잠긴 작업 후보. 3년 전 갈래도 다시 이어질 수 있어야 한다 —
    // 사람 기억에 "끝"은 드물고, 대개는 한동안 안 건드릴 뿐이다.
    //
    // 전부 보내지는 않는다. 갈래는 하루 8세션이면 1년에 950개쯤 쌓이는데(새 갈래
    // 생성률 33%), 그 목록을 통째로 주면 판정이 나빠진다 — 프롬프트가 "애매하면
    // new" 라고 못 박아뒀으니 목록이 길수록 오히려 새 갈래가 늘어난다.
    //
    // 그래서 코드가 셋으로 줄이고 판정만 모델이 한다. 겹침은 유사도지 정체성이
    // 아니라서(같은 도구를 쓰는 다른 일이 흔하다) 코드가 결정하면 안 된다.
    // 스킬이 문자열 일치로 신규/휴면을 코드가 확정하는 것과 반대 방향이다.
    const dormantThreadRows = await findDormantCandidates(userId, session);

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
      system: SYSTEM_PROMPT_V7,
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
            dormantThreadRows,
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

    // ── 이 세션에서 나온 일들 ──
    //
    // 최상위가 주된 경험이고, also 는 갈라져 나온 것이다(대개 비어 있다).
    // 나누는 판단은 모델이 하고, **시간과 문턱은 코드가** 잰다 — 모델은 분 단위
    // 합산을 못 믿는다. 배정이 어긋나면 나누지 않고 주된 것 하나로 돌아간다.
    const segList = segmentsOf(session.compressedLog);
    const items: PlannedItem[] = planItems(output, segList, session.durationMin).map((it) => ({
      ...it,
      // 구간에서 시각을 못 얻은 경우(안 나뉘었거나 옛 세션) 세션 시작을 쓴다.
      occurredAt: Number.isNaN(it.occurredAt.getTime()) ? session.startedAt : it.occurredAt,
    }));

    // 갈래 후보 — 이번에 **실제로 보낸** 목록이 곧 붙일 수 있는 대상이다.
    // 살아있는 것과 후보로 준 잠긴 것 둘 다 허용하고, 목록에 없는 id 를 지어내면
    // new 로 강등한다(LLM 환각 방어).
    const offeredThreadsById = new Map<string, { id: string; title: string }>([
      ...activeThreadRows.map((t) => [t.id, t] as const),
      ...dormantThreadRows.map((t) => [t.id, t] as const),
    ]);

    const recentExperienceSummaries: RecentExperienceSummary[] = recentExperienceRows.map((e) => ({
      category: e.category,
      primarySkillName: primarySkillByExperienceId.get(e.id) ?? null,
    }));
    const lastUsedByName = new Map(existingSkillRows.map((r) => [r.name, r.lastUsedAt]));

    /** 이 세션 안에서 이미 "처음"으로 쳐준 스킬. 같은 스킬이 두 경험에 걸쳐
     *  나와도 신규는 한 번이다 — 안 그러면 한 번 배운 것으로 +50 을 두 번 받는다. */
    const claimedNewSkills = new Set<string>();

    /** 저장 직전까지 계산이 끝난 경험 하나. */
    interface Prepared {
      item: PlannedItem;
      skills: { name: string; weight: number; domain: SkillDomain }[];
      isFirstTime: boolean;
      score: ReturnType<typeof calculateMemoryScore>;
      thread: { id: string; title: string; action: 'attach' | 'new' };
    }

    const prepared: Prepared[] = items.map((item, index) => {
      // 스키마 상한을 넉넉히 푼 만큼 여기서 자른다. 개수가 많다고 경험 전체를
      // 버리는 것보다, 합치고 상위만 남기는 편이 손실이 적다.
      const skills = dedupeSkills(item.skills, item.category)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_SKILLS_PER_EXPERIENCE);

      const newSkillNames = skills
        .filter((s) => !existingSkillNames.has(s.name) && !claimedNewSkills.has(s.name))
        .map((s) => s.name);
      for (const n of newSkillNames) claimedNewSkills.add(n);
      const hasNewSkill = newSkillNames.length > 0;
      const primarySkillName = skills.length > 0 ? skills[0].name : null;

      /**
       * "이번에 처음 다뤘나" — **규칙이 먼저고 모델이 보탠다.**
       *
       * 프롬프트가 이 값의 기준을 "보유 스킬 목록에 없던 것을 다뤘는가"로
       * 정의했는데, 그건 추론이 아니라 **비교 연산**이다. 그런데 모델에게
       * 물어보니 실측 5/5 로 어긋났다 — 심지어 보유 목록이 **텅 빈 첫 경험**
       * 에서도 false 를 냈다. 규칙대로면 무조건 true 여야 하는 자리다.
       *
       * 그 결과 이 컬럼에 매달린 것들이 전부 죽어 있었다 — 기억 점수 +40 이
       * 안 붙고, 감정 '흥분'이 발동하지 않고, 성격의 개척형↔숙련형 축이 늘
       * 숙련형 극단에 고정된다(사흘에 스킬 8개가 는 사용자가 "숙련형"으로 찍혔다).
       *
       * 프롬프트를 또 고치는 건 이미 한 번 실패한 방법이라, 확실히 아는 부분은
       * 규칙이 채우고 모델은 규칙이 못 보는 것(주제·방식·환경)만 보탠다.
       */
      const isFirstTime = hasNewSkill || item.is_first_time;

      const dormantSkillReturned = skills.some((sk) => {
        const last = lastUsedByName.get(sk.name);
        if (!last) return false; // 신규 스킬은 여기 해당 없음(그건 hasNewSkill 이 잡는다)
        return item.occurredAt.getTime() - last.getTime() >= DORMANT_SKILL_DAYS * DAY_MS;
      });

      // 아래 둘은 **주된 경험에만** 준다.
      //
      // 직전 경험은 세션 전체에 하나뿐인데, 갈라진 것들에 똑같이 주면 한 번의
      // 공백·돌파로 +30·+35 를 두 번 받는다. 시간순으로도 두 번째 경험의 "직전"은
      // 첫 번째 경험이라 공백이 0 이다.
      const isPrimary = index === 0;
      const daysSinceLastExperience =
        isPrimary && recentExperienceRows.length > 0
          ? Math.floor((session.startedAt.getTime() - recentExperienceRows[0].occurredAt.getTime()) / DAY_MS)
          : null;
      const brokeThrough =
        isPrimary && recentExperienceRows[0]?.outcome === 'stuck' && item.outcome === 'success';

      const score = calculateMemoryScore({
        hasNewSkill,
        isFirstTime,
        brokeThrough,
        dormantSkillReturned,
        daysSinceLastExperience,
        // 나눴으면 제 몫만. 197분 세션을 둘로 쪼개고 각자에게 197분을 주면
        // '평소보다 긴 세션'(+20)을 둘 다 받는다.
        durationMin: item.durationMin,
        recentSessionDurations: recentSessionRows.map((r) => r.durationMin),
        category: item.category,
        primarySkillName,
        recentExperiences: recentExperienceSummaries,
      });

      // 갈래 판정 — 경험마다 따로 한다. 나뉘었다는 건 대상이 다르다는 뜻이라
      // 같은 갈래에 붙으면 애초에 나눌 이유가 없었던 것이다.
      let action: 'attach' | 'new' = item.thread.action;
      let targetId = item.thread.existing_thread_id;
      if (action === 'attach' && (!targetId || !offeredThreadsById.has(targetId))) {
        action = 'new';
        targetId = null;
      }
      const threadId = action === 'new' ? randomUUID() : targetId!;
      const threadTitle =
        action === 'new'
          ? item.thread.title?.trim() || clampSentence(item.summary, MAX_THREAD_TITLE_LEN)
          : (offeredThreadsById.get(threadId)?.title ?? clampSentence(item.summary, MAX_THREAD_TITLE_LEN));

      return { item, skills, isFirstTime, score, thread: { id: threadId, title: threadTitle, action } };
    });

    // 5. 저장 (트랜잭션)
    const now = new Date();

    await db.transaction(async (tx) => {
      // 처리 권리를 **먼저 선점한다.**
      //
      // 예전에는 experiences.session_id 의 UNIQUE 가 이 방어를 겸했다 — 동시
      // 처리로 두 번째 INSERT 가 막히면 그걸 신호로 롤백했다. 한 세션에서 경험이
      // 여럿 나올 수 있게 되면서 그 제약을 풀었으니, 방어를 여기로 옮긴다.
      // 조건부 UPDATE 라 두 번째 실행은 0행을 받고, 잠금이 세션 한 행에 걸린다.
      const claimed = await tx
        .update(sessions)
        .set({ processedAt: now })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.processedAt)))
        .returning({ id: sessions.id });

      // 여기서 `return` 하면 안 된다. postgres-js 의 client.begin 은 콜백이 정상
      // resolve 하면 COMMIT 한다 — return 은 롤백이 아니라 "건너뛰고 커밋"이다.
      // 던져서 실제로 롤백시키고, 바깥 catch 가 조용히 넘긴다.
      if (claimed.length === 0) throw new SessionAlreadyProcessedError(sessionId);

      let newMemoriesCount = 0;
      let oldestNewMemoryAt: Date | null = null;

      for (const p of prepared) {
        const { item, skills, isFirstTime, score, thread } = p;

        // action='new' 인 갈래는 experiences.thread_id FK 때문에 경험보다 먼저
        // 만들어야 한다(참조 대상이 존재해야 FK 를 통과한다).
        if (thread.action === 'new') {
          await tx.insert(threads).values({
            id: thread.id,
            userId,
            title: thread.title,
            category: item.category,
            status: 'active',
            startedAt: item.occurredAt,
            lastActivityAt: item.occurredAt,
            experienceCount: 1,
          });
        }

        const [insertedExperience] = await tx
          .insert(experiences)
          .values({
            userId,
            sessionId,
            threadId: thread.id,
            occurredAt: item.occurredAt,
            // 자르지 않는다 — 잘라 저장하면 상세에서 되살릴 수 없다.
            summary: item.summary,
            detail: item.detail ?? null,
            category: item.category,
            outcome: item.outcome,
            isFirstTime,
            memoryScore: score.score,
            segmentIds: item.segmentIds,
            durationMin: item.durationMin,
          })
          .returning({ id: experiences.id });

        if (skills.length > 0) {
          await tx
            .insert(experienceSkills)
            .values(
              skills.map((s) => ({
                experienceId: insertedExperience.id,
                skillName: s.name,
                weight: s.weight,
                domain: s.domain,
              })),
            )
            .onConflictDoNothing({ target: [experienceSkills.experienceId, experienceSkills.skillName] });

          for (const skill of skills) {
            await tx
              .insert(userSkills)
              .values({
                userId,
                skillName: skill.name,
                domain: skill.domain,
                points: skill.weight,
                useCount: 1,
                // "사용자가 실제로 쓴 시각" 기준 — 서버가 처리한 시각이 아니다.
                firstUsedAt: item.occurredAt,
                lastUsedAt: item.occurredAt,
              })
              .onConflictDoUpdate({
                target: [userSkills.userId, userSkills.skillName],
                set: {
                  // domain 은 그 스킬이 쓰인 **모든 경험의 최빈값**으로 다시 계산한다.
                  // 처음 만들어질 때의 값으로 고정하면 나중에 백 번 다르게 써도
                  // 안 바뀌고, 마지막 세션 값으로 덮으면 판단이 흔들릴 때마다
                  // 값이 왔다갔다 한다. 최빈값은 순서와 무관해서 재구축해도 같다.
                  domain: sql`coalesce((
                    select es.domain from ${experienceSkills} es
                    join ${experiences} e on e.id = es.experience_id
                    where es.skill_name = ${skill.name}
                      and e.user_id = ${userId}
                      and es.domain is not null
                    group by es.domain
                    order by count(*) desc, es.domain asc
                    limit 1
                  ), ${userSkills.domain})`,
                  points: sql`${userSkills.points} + ${skill.weight}`,
                  useCount: sql`${userSkills.useCount} + 1`,
                  // GREATEST 로 역행을 막는다 — 세션은 며칠 늦게 도착할 수 있어서
                  // (오프라인 버퍼링) 무조건 덮어쓰면 이미 8/3 으로 가 있던
                  // lastUsedAt 이 8/1 로 되돌아간다. 이 값은 프롬프트 컨텍스트와
                  // 감정 판정('오래 안 쓴 스킬 재등장 → 그리움')에 그대로 쓰인다.
                  lastUsedAt: sql`GREATEST(${userSkills.lastUsedAt}, ${item.occurredAt.toISOString()}::timestamptz)`,
                },
              });
          }
        }

        // 갈래 부착 — 'new' 는 위에서 이미 만들었으니 'attach' 만 갱신한다.
        let attachedCount: number | null = null;
        if (thread.action === 'attach') {
          const [updated] = await tx
            .update(threads)
            .set({
              // GREATEST 로 역행 방지 — 위 userSkills 와 같은 이유다. 무조건
              // 덮어쓰면 어제까지 활동하던 갈래가 두 달 전으로 되돌아가고,
              // 그러면 오늘 밤 배치가 살아있는 작업을 abandoned 로 넘긴다.
              lastActivityAt: sql`GREATEST(${threads.lastActivityAt}, ${item.occurredAt.toISOString()}::timestamptz)`,
              experienceCount: sql`${threads.experienceCount} + 1`,
              // 잠긴 갈래에 붙었으면 되살아난다. abandoned 는 무덤이 아니라
              // 잠금이다. completed 는 안 건드린다 — 사람이 선언한 값이라
              // 모델이 뒤집으면 declared 위계가 거꾸로 선다.
              status: sql`case when ${threads.status} = 'abandoned' then 'active' else ${threads.status} end`,
              // 분야를 다시 센다 — 갈래의 category 는 "연 첫 경험의 판정"이 아니라
              // "지금까지 무엇을 한 작업인가"여야 한다. 동률이면 이름순(결정적).
              category: sql`coalesce((
                select e.category from ${experiences} e
                where e.thread_id = ${thread.id}
                group by e.category
                order by count(*) desc, e.category asc
                limit 1
              ), ${threads.category})`,
            })
            .where(eq(threads.id, thread.id))
            .returning({ n: threads.experienceCount });
          attachedCount = updated?.n ?? null;
        }

        // 완결 분기는 여기 없다. thread_complete 기억은 사람이 지도에서
        // 직접 표시할 때만 생긴다(app/actions.ts 의 completeThread).
        //
        // 오래 붙들고 있는 일은 그 자체로 남을 만하다 — 매 세션은 특별할 게
        // 없는데 몇 달째 이어지는 갈래는 기억이 하나도 안 생기던 구멍을 메운다.
        // 문턱 6은 6개월치 분포의 상위 21%(평균 3.5건)이고, === 6 이라 자연히
        // 한 번만 발동한다.
        if (attachedCount === DEEPENED_THREAD_EXPERIENCES) {
          const r = await upsertThreadMemory(tx, {
            userId,
            threadId: thread.id,
            experienceId: insertedExperience.id,
            occurredAt: item.occurredAt,
            title: thread.title,
            body: item.detail ?? item.summary,
            trigger: 'deepened',
            threadExperienceCount: attachedCount,
          });
          if (r === 'created') newMemoriesCount += 1;
        }

        if (score.score >= MEMORY_SCORE_THRESHOLD) {
          const bd = score.breakdown;
          // 어느 규칙이 이 기억을 만들었는지가 곧 trigger 다. 위에서부터 먼저 맞는 것.
          const trigger = bd.hasNewSkill || bd.isFirstTime
            ? 'new_skill'
            : bd.brokeThrough
              ? 'breakthrough'
              : bd.dormantSkillReturned
                ? 'revival'
                : 'comeback';

          const r = await upsertThreadMemory(tx, {
            userId,
            threadId: thread.id,
            experienceId: insertedExperience.id,
            occurredAt: item.occurredAt,
            // 제목은 요약만(자르지 않는다). 근거(무슨 스킬이 처음이었나)는 화면이
            // 칩으로 따로 보여준다 — user_skills.first_used_at 이 그 경험 시각과
            // 같으면 그때 처음 쓴 스킬이라, 추가 저장 없이 정확히 가려낼 수 있다.
            title: item.summary,
            body: item.detail ?? item.summary,
            trigger,
            // 'new' 로 만든 갈래면 이번이 첫 경험이다.
            threadExperienceCount: attachedCount ?? 1,
          });
          if (r === 'created') newMemoriesCount += 1;
        }

        if (newMemoriesCount > 0 && (!oldestNewMemoryAt || item.occurredAt < oldestNewMemoryAt)) {
          oldestNewMemoryAt = item.occurredAt;
        }
      }

      // ── 여기부터는 세션에 한 번 ──

      // 대사는 슬롯당 하나라 경험 단위가 아니다. 세션이 몇 개로 나뉘든 4개다.
      for (const d of output.dialogues) {
        // DB CHECK(char_length <= 80) 이 막기 전에 서버에서 먼저 절단한다.
        // 문장 경계에서 자른다 — 한복판에서 끊으면 화면에 그대로 드러난다.
        const text = clampSentence(d.text, MAX_DIALOGUE_LEN);
        await tx
          .insert(dialogues)
          .values({ userId, slot: d.slot, text, sourceSessionId: sessionId })
          .onConflictDoUpdate({
            target: [dialogues.userId, dialogues.slot],
            set: { text, sourceSessionId: sessionId, generatedAt: now },
          });
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

      const newExperienceCount = (characterRow?.experienceCount ?? 0) + prepared.length;
      const daysSinceSignup = userRow ? Math.floor((now.getTime() - userRow.createdAt.getTime()) / DAY_MS) : 0;
      const newLevel = calculateLevel({
        experienceCount: newExperienceCount,
        skillCount,
        daysSinceCreated: daysSinceSignup,
      });

      const newMemoryCount = (characterRow?.memoryCount ?? 0) + newMemoriesCount;
      const existingOldestMemoryAt = characterRow?.oldestMemoryAt ?? null;
      const newOldestMemoryAt =
        oldestNewMemoryAt !== null
          ? existingOldestMemoryAt && existingOldestMemoryAt < oldestNewMemoryAt
            ? existingOldestMemoryAt
            : oldestNewMemoryAt
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
