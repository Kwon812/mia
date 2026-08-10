import { describe, expect, it } from 'vitest';

import {
  bandwidthTargets,
  briefBody,
  dayStartUtc,
  groupByRegion,
  formatBytes,
  formatUsd,
  monthStartUtc,
  normalize,
  parseAnthropicCosts,
  parseOpenAiCosts,
  parseRenderMetric,
  parseRenderServices,
  usageErrorFor,
} from '../usage';

// 2026-08-10T05:00:00Z — 한국 시각으로는 14시, 즉 UTC 와 날짜가 갈리는 구간이
// 아니다. 날짜 경계 시험은 아래에서 따로 한다.
const NOW = Date.UTC(2026, 7, 10, 5, 0, 0);

describe('기간', () => {
  it('이번 달 1일 00:00 UTC 로 자른다', () => {
    expect(monthStartUtc(NOW)).toBe(Date.UTC(2026, 7, 1));
  });

  it('로컬 자정이 아니라 UTC 자정이다 — 한국 시각 오전 8시는 아직 어제 UTC', () => {
    // 2026-08-11 08:00 KST = 2026-08-10 23:00 UTC
    const kstMorning = Date.UTC(2026, 7, 10, 23, 0, 0);
    expect(dayStartUtc(kstMorning)).toBe(Date.UTC(2026, 7, 10));
  });
});

describe('표기', () => {
  it('작은 금액을 0 으로 뭉개지 않는다', () => {
    // $0.004 를 "$0.00" 으로 적으면 안 쓰고 있다고 읽힌다
    expect(formatUsd(0.004)).toBe('$0.0040');
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(12.3456)).toBe('$12.35');
    expect(formatUsd(1234.5)).toBe('$1,235');
  });

  it('바이트를 사람 단위로', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024 * 1024 * 1536)).toBe('1.5 GB');
  });

  it('막대는 최댓값 기준으로 정규화하고, 다 0 이면 안 그린다', () => {
    expect(normalize([1, 2, 4])).toEqual([0.25, 0.5, 1]);
    expect(normalize([0, 0, 0])).toEqual([]);
    expect(normalize([])).toEqual([]);
  });

  it('꼬리만 본다 — 한 달치를 다 그리면 막대가 뭉갠다', () => {
    expect(normalize([1, 1, 1, 1, 9], 2)).toEqual([1 / 9, 1]);
  });
});

describe('OpenAI Costs 응답', () => {
  const sample = {
    object: 'page',
    data: [
      {
        object: 'bucket',
        start_time: Math.floor(Date.UTC(2026, 7, 9) / 1000),
        results: [{ object: 'organization.costs.result', amount: { value: 0.06, currency: 'usd' } }],
      },
      {
        object: 'bucket',
        start_time: Math.floor(Date.UTC(2026, 7, 10) / 1000),
        // 한 버킷에 항목이 여럿일 수 있다 — 더해야 그날 총액이다
        results: [{ amount: { value: 1.5 } }, { amount: { value: 0.25 } }],
      },
    ],
  };

  it('버킷을 달러 그대로 읽는다', () => {
    expect(parseOpenAiCosts(sample)).toEqual([
      { at: Date.UTC(2026, 7, 9), usd: 0.06 },
      { at: Date.UTC(2026, 7, 10), usd: 1.75 },
    ]);
  });

  it('안 쓴 날은 results 가 비어 오고, 그건 0 이다', () => {
    const got = parseOpenAiCosts({ data: [{ start_time: 1, results: [] }] });
    expect(got).toEqual([{ at: 1000, usd: 0 }]);
  });

  it('모양이 어긋나도 안 터진다', () => {
    expect(parseOpenAiCosts(null)).toEqual([]);
    expect(parseOpenAiCosts({})).toEqual([]);
    expect(parseOpenAiCosts({ data: 'nope' })).toEqual([]);
    expect(parseOpenAiCosts({ data: [{ results: [{ amount: null }] }] })).toEqual([{ at: 0, usd: 0 }]);
  });

  // ── 회귀 ──
  //
  // **실제 응답은 value 가 문자열이다.** 문서 예시는 `"value": 0.06` 이라고
  // 숫자로 적혀 있어서 그 말을 믿었더니, 조직이 $1.88 을 쓴 달에 팝업이 $0 을
  // 띄웠다. 타입이 안 맞으면 그냥 건너뛰니 오류도 안 나고 조용히 0 이 된다.
  //
  // 아래는 실계정에서 그대로 받은 응답을 줄인 것이다.
  it('value 가 문자열로 와도 읽는다 — $1.88 이 $0 으로 사라졌던 자리', () => {
    const real = {
      object: 'page',
      has_more: false,
      next_page: null,
      data: [
        {
          object: 'bucket',
          start_time: 1786060800,
          start_time_iso: '2026-08-07T00:00:00+00:00',
          results: [],
        },
        {
          object: 'bucket',
          start_time: 1786147200,
          // 실측에서 이 버킷만 타임존 접미사가 빠져 왔다. start_time(epoch)
          // 을 쓰므로 영향이 없다는 것까지 여기서 못 박는다.
          start_time_iso: '2026-08-08T00:00:00',
          results: [
            {
              object: 'organization.costs.result',
              amount: { value: '1.880642850000000000000000000', currency: 'usd' },
              project_name: 'Default Project',
              organization_name: 'KDP',
            },
          ],
        },
      ],
    };

    const days = parseOpenAiCosts(real);
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({ at: 1786060800000, usd: 0 });
    expect(days[1].at).toBe(1786147200000);
    expect(days[1].usd).toBeCloseTo(1.88064285, 8);
    // 대시보드가 보여주던 값과 같아야 한다
    expect(formatUsd(days.reduce((a, d) => a + d.usd, 0))).toBe('$1.88');
  });
});

describe('Anthropic Cost Report 응답', () => {
  it('**센트로 온다.** 100 으로 나눠야 달러다', () => {
    const got = parseAnthropicCosts({
      data: [
        {
          starting_at: '2026-08-01T00:00:00Z',
          ending_at: '2026-08-02T00:00:00Z',
          results: [{ amount: '123.45', currency: 'USD' }],
        },
      ],
    });
    // 문서: "123.45" in "USD" represents $1.23
    expect(got).toEqual([{ at: Date.UTC(2026, 7, 1), usd: 1.2345 }]);
  });

  it('group_by 로 항목이 쪼개져 와도 더한다', () => {
    const got = parseAnthropicCosts({
      data: [
        {
          starting_at: '2026-08-01T00:00:00Z',
          results: [
            { amount: '100', token_type: 'uncached_input_tokens' },
            { amount: '250', token_type: 'output_tokens' },
          ],
        },
      ],
    });
    expect(got[0].usd).toBeCloseTo(3.5, 10);
  });

  it('시간순으로 정렬한다 — 막대가 뒤집히면 안 된다', () => {
    const got = parseAnthropicCosts({
      data: [
        { starting_at: '2026-08-03T00:00:00Z', results: [{ amount: '300' }] },
        { starting_at: '2026-08-01T00:00:00Z', results: [{ amount: '100' }] },
      ],
    });
    expect(got.map((d) => d.usd)).toEqual([1, 3]);
  });

  it('amount 가 숫자로 와도 읽는다 — 문자열만 받으면 같은 사고가 반대로 난다', () => {
    const got = parseAnthropicCosts({
      data: [{ starting_at: '2026-08-01T00:00:00Z', results: [{ amount: 250 }] }],
    });
    expect(got[0].usd).toBeCloseTo(2.5, 10);
  });

  it('모양이 어긋나도 안 터진다', () => {
    expect(parseAnthropicCosts(undefined)).toEqual([]);
    expect(parseAnthropicCosts({ data: [{ starting_at: 'x', results: [{ amount: 'abc' }] }] })).toEqual([
      { at: 0, usd: 0 },
    ]);
  });
});

describe('Render 응답', () => {
  it('메트릭 시리즈를 전부 더한다 — 서비스마다 하나씩 온다', () => {
    const got = parseRenderMetric([
      { unit: 'bytes', values: [{ timestamp: 't', value: 100 }, { timestamp: 't2', value: 50 }] },
      { unit: 'bytes', values: [{ timestamp: 't', value: 25 }] },
    ]);
    expect(got).toBe(175);
  });

  it('메트릭이 비거나 모양이 어긋나면 0', () => {
    expect(parseRenderMetric([])).toBe(0);
    expect(parseRenderMetric({ nope: 1 })).toBe(0);
    expect(parseRenderMetric([{ values: [{ value: 'x' }] }])).toBe(0);
  });

  it('서비스 목록은 {service} 로 한 겹 싸여 온다', () => {
    const got = parseRenderServices([
      { service: { id: 'srv-a', type: 'web_service', suspended: 'not_suspended', serviceDetails: { region: 'oregon' } }, cursor: 'c1' },
      { service: { id: 'srv-b', type: 'web_service', suspended: 'suspended', serviceDetails: { region: 'oregon' } }, cursor: 'c2' },
    ]);
    expect(got).toEqual([
      { id: 'srv-a', suspended: false, region: 'oregon', type: 'web_service' },
      { id: 'srv-b', suspended: true, region: 'oregon', type: 'web_service' },
    ]);
  });

  it('리전은 serviceDetails 안에 있기도 하고 위에 붙기도 한다', () => {
    const got = parseRenderServices([
      { service: { id: 'a', serviceDetails: { region: 'singapore' } } },
      { service: { id: 'b', region: 'frankfurt' } },
      // 정적 사이트처럼 리전이 없는 것도 있다
      { service: { id: 'c' } },
    ]);
    expect(got.map((s) => s.region)).toEqual(['singapore', 'frankfurt', '']);
  });

  it('싸여 있지 않은 모양도 읽는다', () => {
    expect(parseRenderServices([{ id: 'srv-c' }])).toEqual([{ id: 'srv-c', suspended: false, region: '', type: '' }]);
    expect(parseRenderServices(null)).toEqual([]);
  });

  // ── 회귀 ──
  //
  // 리전을 섞어 한 번에 물으면 Render 가 400 을 낸다:
  //   "querying resources from multiple regions is not supported"
  // 실계정(서비스 6개, 리전 2개)에서 대역폭이 통째로 안 나온 원인이었다.
  it('리전별로 갈라 묶는다 — 섞어 물으면 400 이다', () => {
    const g = groupByRegion([
      { id: 'a', suspended: false, region: 'oregon', type: 'web_service' },
      { id: 'b', suspended: false, region: 'singapore', type: 'web_service' },
      { id: 'c', suspended: false, region: 'oregon', type: 'web_service' },
    ]);
    expect(g.size).toBe(2);
    expect(g.get('oregon')).toEqual(['a', 'c']);
    expect(g.get('singapore')).toEqual(['b']);
  });

  // ── 회귀 ──
  //
  // 크론 잡을 같이 물었더니 `not found: crn-…` 로 **그 리전 전체가 404** 였다.
  // 하나라도 지원 안 되는 게 섞이면 부분 응답이 아니라 전부 실패다.
  it('대역폭이 없는 리소스는 빼고 묻는다 — 섞이면 요청 전체가 404 다', () => {
    const got = bandwidthTargets([
      { id: 'srv-web1', suspended: false, region: 'oregon', type: 'web_service' },
      { id: 'crn-d9ou0qbm8hqs739t2kpg', suspended: false, region: 'oregon', type: 'cron_job' },
      { id: 'dpg-pg1', suspended: false, region: 'oregon', type: 'postgres' },
      { id: 'red-r1', suspended: false, region: 'singapore', type: 'redis' },
      { id: 'srv-web2', suspended: false, region: 'singapore', type: 'static_site' },
    ]);
    expect(got.map((s) => s.id)).toEqual(['srv-web1', 'srv-web2']);
  });

  it('리전이 하나뿐이면 요청도 하나다', () => {
    const g = groupByRegion([
      { id: 'a', suspended: false, region: 'oregon', type: 'web_service' },
      { id: 'b', suspended: false, region: 'oregon', type: 'web_service' },
    ]);
    expect([...g.keys()]).toEqual(['oregon']);
  });
});

describe('오류 본문 요약', () => {
  it('Render 처럼 {message} 로 오면 그것만 뽑는다', () => {
    expect(briefBody('{"message":"querying resources from multiple regions is not supported"}')).toBe(
      'querying resources from multiple regions is not supported',
    );
  });

  it('OpenAI 처럼 {error:{message}} 로 와도 뽑는다', () => {
    expect(briefBody('{"error":{"message":"Missing bearer","type":"invalid_request_error"}}')).toBe(
      'Missing bearer',
    );
  });

  it('JSON 이 아니면 원문을 줄여서 쓴다', () => {
    expect(briefBody('  <html>\n  Bad   Gateway\n</html> ')).toBe('<html> Bad Gateway </html>');
    expect(briefBody('   ')).toBe('');
  });

  it('아무리 길어도 화면을 안 밀어낸다', () => {
    expect(briefBody('x'.repeat(500)).length).toBe(160);
  });
});

describe('오류 문장', () => {
  it('401 은 "키 종류"를 짚어준다 — 같은 키를 다시 넣어보게 하지 않으려고', () => {
    expect(usageErrorFor('openai', 401)).toContain('sk-admin');
    expect(usageErrorFor('anthropic', 401)).toContain('sk-ant-admin');
  });

  it('Render 는 일반 키라 문장이 다르다', () => {
    expect(usageErrorFor('render', 403)).toContain('rnd_');
    expect(usageErrorFor('render', 403)).not.toContain('일반 키로는');
  });

  it('그 밖의 코드도 사람이 읽을 문장이 있다', () => {
    expect(usageErrorFor('openai', 429)).toContain('429');
    expect(usageErrorFor('openai', 503)).toContain('503');
  });
});
