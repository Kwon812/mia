// 갈래 부착 시험용 세션 열을 **생성**한다. 정답을 알고 만든다.
//
// 손으로 쓴 픽스처 열두 개로는 부족하다 — 우연히 맞거나 우연히 틀린 것을
// 가릴 수가 없고, 함정 유형마다 표본이 한둘이라 통계가 안 된다.
// 여기서는 프로젝트·행사·딴짓 풀에서 조합해 원하는 만큼 찍는다.
//
// 정답은 구간마다 붙는 `owner` 다. 세션을 조립할 때 정해두므로 채점이 확실하다.

export type Target = {
  key: string;            // 정답 키
  /** 이 대상의 표면들 — 도메인이 달라도 한 프로젝트다 */
  surfaces: { domain: string; title: string }[];
  category: string;
};

/** 프로젝트 — 여러 표면을 가진다(로컬·DB·배포·저장소). */
const PROJECTS: Target[] = [
  { key:'알파', category:'dev', surfaces:[
    { domain:'localhost:3000', title:'알파 — 대시보드' },
    { domain:'localhost:3000', title:'알파 — 설정' },
    { domain:'db.example.com', title:'users | Table Editor | alpha-db' },
    { domain:'deploy.example.com', title:'alpha-web — Deployments' },
    { domain:'git.example.com', title:'team/alpha-web · main' },
  ]},
  { key:'알파-리포트', category:'dev', surfaces:[   // 이름이 알파와 비슷하다 (함정)
    { domain:'localhost:3100', title:'알파-리포트 — 관리자' },
    { domain:'localhost:3100', title:'알파-리포트 — 통계' },
    { domain:'db.example.com', title:'stats | Table Editor | report-db' },  // 같은 DB 콘솔 (함정)
  ]},
  { key:'베타', category:'dev', surfaces:[
    { domain:'localhost:4000', title:'베타 스토어 — 상품' },
    { domain:'db.example.com', title:'products | Table Editor | beta-db' },
    { domain:'deploy.example.com', title:'beta-store — Deployments' },
  ]},
  { key:'감마문서', category:'docs', surfaces:[
    { domain:'wiki.example.net', title:'감마 문서 · API 레퍼런스' },
    { domain:'wiki.example.net', title:'감마 문서 · 마이그레이션 가이드' },
  ]},
];

/** 행사 — 표면이 하나뿐이고 개발이 아니다. 이름이 개발처럼 요약되기 쉽다(함정). */
const EVENTS: Target[] = [
  { key:'컨퍼런스A', category:'dev', surfaces:[
    { domain:'conf-a.example.com', title:'A 컨퍼런스 2026 | 세션 목록' },
    { domain:'conf-a.example.com', title:'A 컨퍼런스 2026 | 온라인 부스' },
  ]},
  { key:'컨퍼런스B', category:'dev', surfaces:[   // A 와 어휘가 겹친다 (함정)
    { domain:'conf-b.example.org', title:'B 컨퍼런스 | 프로그램' },
    { domain:'conf-b.example.org', title:'B 컨퍼런스 | 부스 안내' },
  ]},
];

/** 딴짓 — 개발 세션에 섞인다. 문턱을 넘으면 갈라져야 한다. */
const DETOURS: Target[] = [
  { key:'쇼핑', category:'shopping', surfaces:[
    { domain:'shop.example.com', title:'러닝화 — 온라인 스토어' }]},
  { key:'커뮤니티', category:'community', surfaces:[
    { domain:'forum.example.net', title:'취미 게시판 — 커뮤니티' }]},
];

const ALL = [...PROJECTS, ...EVENTS, ...DETOURS];
const byKey = new Map(ALL.map(t => [t.key, t]));

/** 결정적 난수 — 같은 seed 면 같은 세션 열이 나온다(재현성). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export type GenSession = {
  name: string;
  expect: string[];                 // 이 세션에서 나와야 할 갈래 키들(시간 많은 순)
  /** 구간마다의 정답 소유자. segments 와 같은 순서 — 프롬프트에는 안 들어간다. */
  owners: string[];
  session: { primaryCategory:string; durationMin:number; closeReason:string;
             activityScore:number; domains:Record<string,number>; compressedLog:unknown };
};

/**
 * 세션 열을 만든다.
 *
 * 섞는 규칙:
 *   60%  대상 하나        — 나누면 안 된다
 *   30%  대상 둘          — 나뉘어야 한다
 *   10%  대상 셋          — 셋으로
 * 대상마다 12~45분을 주므로 전부 문턱(7분)을 넘는다 — 즉 "나눠야 하는데
 * 시간이 모자라서 못 나눈 것"과 "판단을 못 한 것"이 섞이지 않는다.
 */
export function generate(n: number, seed = 42): GenSession[] {
  const r = rng(seed);
  const pickFrom = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const out: GenSession[] = [];
  let day = 6, hour = 9;

  for (let i = 0; i < n; i++) {
    const roll = r();
    const count = roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3;
    // 대상 고르기 — 프로젝트를 주로, 가끔 행사, 둘 이상이면 딴짓이 낄 수 있다
    const chosen: Target[] = [];
    while (chosen.length < count) {
      const pool = chosen.length === 0
        ? (r() < 0.75 ? PROJECTS : EVENTS)
        : (r() < 0.45 ? PROJECTS : r() < 0.65 ? EVENTS : DETOURS);
      const t = pickFrom(pool);
      if (!chosen.some(c => c.key === t.key)) chosen.push(t);
    }

    // 시간 배분 — 각 대상 12~45분, 표면을 2~3개 오간다
    const segments: any[] = [];
    const owners: string[] = [];
    const mins = new Map<string, number>();
    let m = 0;
    const blocks: { t: Target; dur: number }[] = [];
    for (const t of chosen) {
      // 조각을 잘게 낸다 — 실데이터의 세션은 구간이 9~15개다. 조각이 적으면
      // 모델이 "도메인 두 개뿐이니 한 덩어리"로 뭉개는 쉬운 문제가 되어버린다.
      const parts = 2 + Math.floor(r() * 4);          // 표면 조각 수 2~5
      for (let p = 0; p < parts; p++) blocks.push({ t, dur: 4 + Math.floor(r() * 12) });
    }
    // 섞는다 — 실제로는 대상을 오간다
    for (let k = blocks.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1)); [blocks[k], blocks[j]] = [blocks[j], blocks[k]];
    }
    for (const b of blocks) {
      const sf = pickFrom(b.t.surfaces);
      const at = new Date(Date.UTC(2026, 7, day, hour - 9, m));
      segments.push({ domain: sf.domain, category: b.t.category, title: sf.title,
        start: at.toISOString().replace('Z','+09:00'),
        end: new Date(at.getTime() + b.dur*60000).toISOString().replace('Z','+09:00'),
        sec: b.dur * 60 });
      owners.push(b.t.key);
      mins.set(b.t.key, (mins.get(b.t.key) ?? 0) + b.dur);
      m += b.dur;
    }

    const domains: Record<string, number> = {};
    for (const s of segments) domains[s.domain] = (domains[s.domain] ?? 0) + s.sec;
    // 문턱(7분)을 넘는 대상만 정답이다 — 못 넘은 것은 흡수되는 게 맞다
    const ranked = [...mins.entries()].sort((a,b) => b[1]-a[1]);
    // 문턱(7분)을 넘는 대상만 정답이다 — 못 넘은 것은 흡수되는 게 맞다.
    // 다만 전부 못 넘어도 세션은 경험 하나를 남긴다: 최다 시간 대상이 정답이다.
    const over = ranked.filter(([,v]) => v >= 7).map(([k]) => k);
    const expect = over.length ? over : [ranked[0][0]];

    out.push({
      name: `${String(i+1).padStart(2,'0')} · ${[...mins.entries()].map(([k,v])=>`${k}${v}분`).join(' + ')}`,
      expect, owners,
      session: { primaryCategory: chosen[0].category, durationMin: m, closeReason: 'idle',
                 activityScore: m * 12, domains, compressedLog: { tags: [], queries: [], segments } },
    });

    hour += 3; if (hour > 20) { hour = 9; day += 1; }
  }
  return out;
}

export { byKey };
