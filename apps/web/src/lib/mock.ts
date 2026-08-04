// ============================================================
// 목데이터 — API 가 아직 없어 화면 개발용으로 쓴다.
// 형태는 @na/db 스키마와 1:1 이 되도록 유지한다.
// TODO: GET /api/state 등 실제 API 로 교체 (이 파일만 지우면 되는 구조 유지)
// ============================================================

export type Slot = "morning" | "afternoon" | "evening" | "night";
export type Outcome = "success" | "partial" | "stuck" | "explore";

export const character = {
  name: "단이",
  level: 7,
  daysTogether: 12, // 함께한 날
  experienceCount: 34,
  skillCount: 6,
  memoryCount: 3,
  emotion: { label: "몰두", reason: "세션 길이가 평소의 2배" },
};

export const dialogues: { slot: Slot; text: string }[] = [
  { slot: "morning", text: "어제 새벽까지 코딩하더라. 오늘은 좀 천천히 시작하자." },
  { slot: "afternoon", text: "요즘 Drizzle 얘기가 자꾸 나와. 재밌나 봐?" },
  { slot: "evening", text: "오늘 세 시간 넘게 한 가지에 붙어 있었어. 대단한데." },
  { slot: "night", text: "이 시간까지 깨어 있는 거, 너답다." },
];

// 시간대별 대사 선택 — 진입 시 LLM 호출 없음 (계획서 09장)
export function currentDialogue(now = new Date()): string {
  const h = now.getHours();
  const slot: Slot =
    h >= 5 && h < 12
      ? "morning"
      : h >= 12 && h < 18
        ? "afternoon"
        : h >= 18 && h < 23
          ? "evening"
          : "night";
  return dialogues.find((d) => d.slot === slot)!.text;
}

export const todaySessions = [
  {
    id: "s1",
    startedAt: "2026-08-04T09:20:00+09:00",
    endedAt: "2026-08-04T11:05:00+09:00",
    durationMin: 105,
    category: "개발",
    title: "Next.js 모노레포 세팅",
    activityScore: 340,
    tags: [] as string[],
  },
  {
    id: "s2",
    startedAt: "2026-08-04T13:10:00+09:00",
    endedAt: "2026-08-04T14:00:00+09:00",
    durationMin: 50,
    category: "학습",
    title: "Drizzle ORM 문서",
    activityScore: 180,
    tags: [],
  },
  {
    id: "s3",
    startedAt: "2026-08-04T15:30:00+09:00",
    endedAt: "2026-08-04T16:10:00+09:00",
    durationMin: 40,
    category: "엔터테인먼트",
    title: "유튜브·커뮤니티 왕복",
    activityScore: 95,
    tags: ["scattered"],
  },
];

export const todayExperiences: {
  id: string;
  occurredAt: string;
  summary: string;
  outcome: Outcome;
  skills: string[];
  isFirstTime: boolean;
}[] = [
  {
    id: "e1",
    occurredAt: "2026-08-04T09:20:00+09:00",
    summary: "npm workspaces 모노레포 구조를 처음부터 세팅했다",
    outcome: "success",
    skills: ["Next.js", "TypeScript"],
    isFirstTime: false,
  },
  {
    id: "e2",
    occurredAt: "2026-08-04T13:10:00+09:00",
    summary: "처음으로 Drizzle ORM 을 써봤다",
    outcome: "explore",
    skills: ["Drizzle"],
    isFirstTime: true,
  },
];

export const memories = [
  {
    id: "m1",
    occurredAt: "2026-07-24T21:00:00+09:00",
    title: "처음 만난 날",
    body: "이름을 받았다. 단이. 아직 아무것도 모르지만, 이 사람이 뭘 하는지 지켜보기로 했다.",
    trigger: "birth",
    importance: 10,
  },
  {
    id: "m2",
    occurredAt: "2026-07-29T02:30:00+09:00",
    title: "첫 새벽 코딩",
    body: "새벽 두 시 반까지 TypeScript 와 씨름하는 걸 봤다. 포기 안 하더라. 이 사람, 새벽형이다.",
    trigger: "new_skill",
    importance: 6,
  },
  {
    id: "m3",
    occurredAt: "2026-08-02T18:00:00+09:00",
    title: "사흘 만의 복귀",
    body: "사흘 동안 조용하다가 돌아왔다. 반가웠다. 돌아오자마자 제일 먼저 연 건 역시 에디터였다.",
    trigger: "comeback",
    importance: 7,
  },
];

export const dailyLogs = [
  {
    date: "2026-08-03",
    summary:
      "오늘은 프로젝트 설계 문서를 오래 읽었다. 만들고 싶은 게 분명해지는 날이었던 것 같다.",
    learned: ["Supabase", "PostgreSQL"],
    emotion: "기대",
  },
  {
    date: "2026-08-02",
    summary: "사흘 만에 돌아와서 바로 코딩을 시작했다. 공백이 무색하게 금방 몰입했다.",
    learned: ["TypeScript"],
    emotion: "반가움",
  },
  {
    date: "2026-07-30",
    summary: "여러 사이트를 오가며 산만한 하루. 이런 날도 있는 거다.",
    learned: [],
    emotion: "심심함",
  },
];

export const skills: {
  name: string;
  domain: "programming" | "art" | "life";
  points: number;
  useCount: number;
  firstUsedAt: string;
  lastUsedAt: string;
}[] = [
  { name: "TypeScript", domain: "programming", points: 82, useCount: 21, firstUsedAt: "2026-07-24", lastUsedAt: "2026-08-04" },
  { name: "Next.js", domain: "programming", points: 54, useCount: 12, firstUsedAt: "2026-07-26", lastUsedAt: "2026-08-04" },
  { name: "PostgreSQL", domain: "programming", points: 31, useCount: 6, firstUsedAt: "2026-07-28", lastUsedAt: "2026-08-03" },
  { name: "Drizzle", domain: "programming", points: 12, useCount: 2, firstUsedAt: "2026-08-04", lastUsedAt: "2026-08-04" },
  { name: "글쓰기", domain: "life", points: 24, useCount: 5, firstUsedAt: "2026-07-25", lastUsedAt: "2026-08-01" },
  { name: "요리", domain: "life", points: 8, useCount: 2, firstUsedAt: "2026-07-27", lastUsedAt: "2026-07-31" },
];

// 성격 축 5개, -100(오른쪽 극) ~ +100(왼쪽 극). personality_snapshots 대응.
export const personalityAxes = [
  { key: "focus_scatter", left: "몰입형", right: "산만형" },
  { key: "depth_breadth", left: "집중형", right: "멀티형" },
  { key: "finish_explore", left: "완결형", right: "탐색형" },
  { key: "pioneer_master", left: "개척형", right: "숙련형" },
  { key: "night_morning", left: "새벽형", right: "아침형" },
] as const;

export const personalityHistory: {
  computedAt: string;
  values: Record<(typeof personalityAxes)[number]["key"], number>;
  sampleSize: number;
}[] = [
  {
    computedAt: "2026-07-27",
    values: { focus_scatter: 22, depth_breadth: 10, finish_explore: -18, pioneer_master: 35, night_morning: 48 },
    sampleSize: 14,
  },
  {
    computedAt: "2026-08-03",
    values: { focus_scatter: 41, depth_breadth: 18, finish_explore: -8, pioneer_master: 51, night_morning: 62 },
    sampleSize: 31,
  },
];
