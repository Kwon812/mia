// ============================================================
// Assertion class — 어떤 데이터가 "사실"이고 어떤 게 "해석"인가
//
// 이 시스템의 데이터는 출처가 세 종류인데 지금까지 스키마가 그걸 구분하지
// 않았다. experiences.summary(Haiku 가 추론한 값)와 experiences.occurred_at
// (관측된 값)이 같은 행에 평평하게 들어 있다.
//
// 구분이 없으면 두 가지가 깨진다.
//
//  1) 판정. git 커밋("커밋했다" = 관측)과 검색어 반복 추정("막혀 있었다" = 추론)이
//     충돌할 때 무엇을 믿을지 규칙을 세울 수가 없다. 프롬프트에 "facts 를 우선하라"
//     라고 쓰려면 무엇이 fact 인지가 데이터에 있어야 한다.
//
//  2) 학습. 모델 출력을 다시 학습 데이터로 쓰면 그 모델을 복제할 뿐이고,
//     세대를 거듭하면 무너진다(model collapse). 1년 뒤 데이터셋을 뽑을 때
//     inferred 를 걸러낼 수 없으면 코퍼스 전체를 못 쓴다.
//
// W3C PROV 계열의 표준 구분이고, 같은 문제를 푸는 다른 구현(leesj10147/automation
// 의 assertion class)도 같은 삼분법을 쓴다.
// ============================================================

/**
 * - `observed`  : 센서가 본 것. 브라우저 활동, git 커밋, 셸 종료 코드.
 *                 **confidence 가 없다** — 사실에는 확신도를 매기지 않는다.
 * - `declared`  : 사람이 선언한 것. 일기 화면의 판정 교정, 캐릭터 질문에 대한 답.
 *                 관측과 충돌하면 사람이 이긴다.
 * - `inferred`  : 모델이 추론한 것. experiences·dialogues·daily_logs 전부.
 *                 **여기에만 confidence 가 붙는다.**
 *
 * 충돌 시 우선순위: declared > observed > inferred.
 */
export const ASSERTION_CLASSES = ['observed', 'declared', 'inferred'] as const;
export type AssertionClass = (typeof ASSERTION_CLASSES)[number];

/**
 * 원본 이벤트 봉투의 스키마 버전.
 *
 * 콜드 스토리지(Supabase Storage)의 객체는 **불변**이라 나중에 필드를 소급
 * 주입할 수 없다. 1년 뒤 재압축기는 여러 버전이 섞인 파일을 읽게 되므로
 * 줄마다 버전이 박혀 있어야 한다. 봉투를 바꾸면 이 숫자를 올린다.
 */
export const RAW_ENVELOPE_VERSION = 1;

/**
 * 원본 이벤트의 출처. 지금은 브라우저 확장 하나뿐이지만, 같은 스토어에
 * 데스크톱 수집기(git 커밋·셸 명령)가 들어올 자리를 미리 비워둔다 —
 * 봉투가 같아야 1년 뒤 한 번에 읽는다.
 */
export const RAW_SOURCES = ['browser', 'git', 'shell', 'desktop'] as const;
export type RawSource = (typeof RAW_SOURCES)[number];

/**
 * 콜드 스토리지 JSONL 한 줄의 형태.
 *
 * ⚠️ 확장(apps/extension)은 @na/shared 를 의존하지 않는다(번들 크기 — categories.ts
 * 주석의 같은 이유). 확장 쪽 봉투 생성은 apps/extension/src/raw.ts 에 있고
 * 이 타입의 사본이 아니라 **리터럴**로 적혀 있다. 이 파일이 정본이므로
 * 여기를 바꾸면 저기도 바꾼다.
 */
export interface RawEnvelope {
  /** RAW_ENVELOPE_VERSION */
  v: number;
  /** 항상 'observed' — 원본 스토어에는 관측만 들어간다.
   *  declared 는 corrections 테이블로, inferred 는 Postgres 로 간다. */
  class: AssertionClass;
  source: RawSource;
  /** epoch ms */
  at: number;
  /** 소속 세션 id */
  session_id: string;
  kind: string;
  domain: string;
  payload: Record<string, unknown>;
}
