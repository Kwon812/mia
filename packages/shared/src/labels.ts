// 화면·대사에 쓰는 한국어 표기.
//
// DB 에는 영문 열거값이 그대로 들어가고(experiences.category / outcome) 여기는
// 표기 전용이다 — 라벨을 저장하면 표기를 바꿀 때마다 과거 데이터가 어긋난다.
//
// @na/shared 에 두는 이유: 웹(/diary 칩)과 배치(캐릭터 질문 문장)가 둘 다 쓴다.
// 한쪽에만 두고 복사하면 언젠가 "개발"과 "dev"가 화면마다 다르게 나온다.

import { EXPERIENCE_CATEGORIES, EXPERIENCE_OUTCOMES } from './experience';

export const OUTCOME_LABEL: Record<(typeof EXPERIENCE_OUTCOMES)[number], string> = {
  success: '해냄',
  partial: '일부',
  stuck: '막힘',
  explore: '둘러봄',
};

export const CATEGORY_LABEL: Record<(typeof EXPERIENCE_CATEGORIES)[number], string> = {
  dev: '개발',
  study: '공부',
  docs: '문서',
  ai: 'AI',
  search: '검색',
  community: '커뮤니티',
  entertainment: '오락',
  music: '음악',
  shopping: '쇼핑',
  productivity: '정리',
  news: '뉴스',
  finance: '금융',
  etc: '기타',
};

export const FIRST_TIME_LABEL: Record<'true' | 'false', string> = {
  true: '처음',
  false: '해본 것',
};

/** 목록에 없는 값(예전 데이터, 표기 흔들림)이 들어와도 화면이 안 깨지게 한다. */
export function categoryLabel(value: string): string {
  return CATEGORY_LABEL[value as keyof typeof CATEGORY_LABEL] ?? value;
}

export function outcomeLabel(value: string): string {
  return OUTCOME_LABEL[value as keyof typeof OUTCOME_LABEL] ?? value;
}
