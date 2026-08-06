import { EXPERIENCE_CATEGORIES, EXPERIENCE_OUTCOMES } from "@na/shared";

// 화면에 쓰는 한국어 표기. DB 에는 영문 열거값이 그대로 들어가고
// (experiences.category / outcome), 여기는 표기 전용이다 — 라벨을 저장하면
// 표기를 바꿀 때마다 과거 데이터가 어긋난다.

export const OUTCOME_LABEL: Record<(typeof EXPERIENCE_OUTCOMES)[number], string> = {
  success: "해냄",
  partial: "일부",
  stuck: "막힘",
  explore: "둘러봄",
};

export const CATEGORY_LABEL: Record<(typeof EXPERIENCE_CATEGORIES)[number], string> = {
  dev: "개발",
  study: "공부",
  docs: "문서",
  ai: "AI",
  search: "검색",
  community: "커뮤니티",
  entertainment: "오락",
  music: "음악",
  shopping: "쇼핑",
  productivity: "정리",
  news: "뉴스",
  finance: "금융",
  etc: "기타",
};

export const FIRST_TIME_LABEL: Record<"true" | "false", string> = {
  true: "처음",
  false: "해본 것",
};

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
