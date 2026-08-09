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

/**
 * **선택지가 고정된** 교정 필드의 표기 — /diary 칩과 캐릭터 질문이 같이 쓴다.
 *
 * CORRECTION_FIELDS 와 일부러 다르다. 거기엔 thread 가 있지만 여기엔 없다 —
 * 갈래는 선택지가 사용자의 갈래 목록이라 **고정 표가 없다.** 칩으로도 못
 * 그리고 캐릭터가 물어볼 수도 없다("결과가 stuck 이야 success 야?"는 되지만
 * "갈래가 A 야 B 야 C 야 … 열일곱 개 중에?"는 안 된다).
 *
 * 갈래 교정은 지도에서 대상을 직접 집어서 한다(source: 'map').
 */
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

/** 선택지가 고정된 필드만. thread 는 여기 없다 — 위 주석 참고. */
export type ChipField = keyof typeof FIELD_OPTIONS;

/** 이 필드를 칩·질문으로 다룰 수 있는가. 런타임 좁히기용. */
export function isChipField(field: string): field is ChipField {
  return field in FIELD_OPTIONS;
}

export function labelOf(field: ChipField, value: string): string {
  return FIELD_OPTIONS[field].options.find((o) => o.value === value)?.label ?? value;
}
