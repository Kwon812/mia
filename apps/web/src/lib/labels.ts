import {
  CATEGORY_LABEL,
  EXPERIENCE_CATEGORIES,
  EXPERIENCE_OUTCOMES,
  FIRST_TIME_LABEL,
  OUTCOME_LABEL,
} from "@na/shared";

// 라벨 표는 @na/shared 가 정본이다 — 배치(캐릭터 질문 문장)도 같은 표를 쓴다.
// 여기는 화면용 선택지 조립만 담당한다.
export { CATEGORY_LABEL, OUTCOME_LABEL, FIRST_TIME_LABEL };

/** 교정 가능한 필드별 선택지와 표기 — /diary 칩과 캐릭터 질문이 같은 표를 쓴다. */
export const FIELD_OPTIONS = {
  outcome: {
    title: "결과",
    options: EXPERIENCE_OUTCOMES.map((v) => ({ value: v, label: OUTCOME_LABEL[v] })),
  },
  category: {
    title: "분야",
    options: EXPERIENCE_CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABEL[v] })),
  },
  is_first_time: {
    title: "처음인가",
    options: [
      { value: "true", label: FIRST_TIME_LABEL.true },
      { value: "false", label: FIRST_TIME_LABEL.false },
    ],
  },
} as const;

export function labelOf(field: keyof typeof FIELD_OPTIONS, value: string): string {
  return FIELD_OPTIONS[field].options.find((o) => o.value === value)?.label ?? value;
}

/** 필드 이름 표기. FIELD_OPTIONS 와 따로 두는 것은 thread 때문이다 — 값이
 *  열거가 아니라 갈래 제목이라 선택지 표를 못 만든다. */
export const FIELD_TITLE = {
  outcome: "결과",
  category: "분야",
  is_first_time: "처음인가",
  thread: "갈래",
} as const;

/** 갈래가 아직 안 붙은 경험도 있다. 칩에 빈 문자열을 쓰면 누를 데가 없어진다. */
export const NO_THREAD_LABEL = "갈래 없음";
