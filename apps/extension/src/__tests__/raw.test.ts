import { describe, expect, it } from 'vitest';
import { buildJsonl } from '../raw';
import type { ArchivedRawEvent } from '../db';

const row = (at: number, extra: Partial<ArchivedRawEvent> = {}): ArchivedRawEvent => ({
  id: at,
  sessionId: '11111111-1111-4111-8111-111111111111',
  at,
  kind: 'activity',
  domain: 'github.com',
  payload: { scrolls: 1, title: 'Issue #1' },
  uploaded: 0,
  ...extra,
});

describe('buildJsonl', () => {
  it('줄마다 봉투를 씌운다 — v/class/source 가 박혀야 1년 뒤에 읽을 수 있다', () => {
    const [line] = buildJsonl([row(1000)]).split('\n');
    const parsed = JSON.parse(line);

    expect(parsed.v).toBe(1);
    // 이 스토어에는 관측만 들어간다. inferred(모델 출력)가 섞이면 1년 뒤
    // 학습 데이터를 뽑을 때 모델을 다시 학습시키게 된다.
    expect(parsed.class).toBe('observed');
    expect(parsed.source).toBe('browser');
    expect(parsed.session_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(parsed.domain).toBe('github.com');
    expect(parsed.payload).toEqual({ scrolls: 1, title: 'Issue #1' });
  });

  it('시간순으로 고정한다 — IndexedDB 반환 순서에 맡기면 재압축 때 구간이 어긋난다', () => {
    const jsonl = buildJsonl([row(300), row(100), row(200)]);
    const ats = jsonl.split('\n').map((l) => JSON.parse(l).at);
    expect(ats).toEqual([100, 200, 300]);
  });

  it('줄바꿈으로만 구분한다 (JSONL — 꼬리 줄바꿈 없음)', () => {
    const jsonl = buildJsonl([row(1), row(2)]);
    expect(jsonl.split('\n')).toHaveLength(2);
    expect(jsonl.endsWith('\n')).toBe(false);
  });

  it('빈 입력은 빈 문자열', () => {
    expect(buildJsonl([])).toBe('');
  });
});

describe('gzip 왕복', () => {
  // 확장이 CompressionStream 으로 압축하고 서버는 바이트를 그대로 저장한다.
  // 1년 뒤 배치가 그걸 풀어 읽으므로, 왕복이 무손실인지 여기서 못박아둔다.
  it('압축 후 풀면 원문과 같고, 실제로 작아진다', async () => {
    const jsonl = buildJsonl(Array.from({ length: 200 }, (_, i) => row(i * 1000)));

    const gz = await new Response(
      new Blob([jsonl]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();

    const back = await new Response(
      new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();

    expect(back).toBe(jsonl);
    // 반복이 많은 JSONL 이라 실측 1/10 이하로 줄어든다. 여유를 두고 1/5 로 본다.
    expect(gz.byteLength).toBeLessThan(new Blob([jsonl]).size / 5);
  });
});
