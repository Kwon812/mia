import { describe, expect, it } from 'vitest';
import { REDACTED, redactPath, redactPayload, redactText, redactUrl } from '../redact';

describe('redactPath', () => {
  it('시크릿 편집 경로의 마지막 세그먼트를 지운다 (실제 유출 사례)', () => {
    // 이 경로가 GOORM_SID 를 일기까지 올려보낸 경로다.
    expect(redactPath('/Kwon812/me_ai/settings/secrets/actions/GOORM_SID')).toBe(
      `/Kwon812/me_ai/settings/secrets/actions/${REDACTED}`,
    );
  });

  it('중간 세그먼트는 살린다 — 리댁션이 압축으로 변질되면 안 된다', () => {
    const out = redactPath('/o/me_ai/settings/variables/actions/DEPLOY_HOOK');
    expect(out).toContain('/settings/variables/actions/');
    expect(out.endsWith(REDACTED)).toBe(true);
  });

  it('시크릿 부모가 없으면 건드리지 않는다', () => {
    expect(redactPath('/vercel/next.js/issues/12345')).toBe('/vercel/next.js/issues/12345');
    expect(redactPath('/docs/app/getting-started')).toBe('/docs/app/getting-started');
  });

  it('토큰꼴 세그먼트는 부모와 무관하게 지운다', () => {
    expect(redactPath('/share/a1b2c3d4e5f6g7h8i9j0k1')).toBe(`/share/${REDACTED}`);
  });

  it('하이픈 슬러그는 토큰으로 오인하지 않는다 (과잉 삭제 방지)', () => {
    const slug = '/blog/getting-started-with-nextjs-16';
    expect(redactPath(slug)).toBe(slug);
  });

  it('긴 숫자열 세그먼트를 지운다 — 주문·계좌번호가 경로에 박힌다', () => {
    expect(redactPath('/orders/123456789012')).toBe(`/orders/${REDACTED}`);
  });

  it('짧은 번호는 살린다 — 이슈 번호·연도까지 지우면 원본이 쓸모없어진다', () => {
    expect(redactPath('/vercel/next.js/issues/12345')).toBe('/vercel/next.js/issues/12345');
  });

  it('꼬리 슬래시가 있어도 잎을 제대로 찾는다', () => {
    expect(redactPath('/repo/settings/secrets/actions/MY_KEY/')).toBe(
      `/repo/settings/secrets/actions/${REDACTED}/`,
    );
  });

  it('루트와 빈 경로는 그대로 둔다', () => {
    expect(redactPath('/')).toBe('/');
    expect(redactPath('')).toBe('');
  });
});

describe('redactText', () => {
  it('JWT 를 지운다', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(redactText(`token ${jwt} 확인`)).toBe(`token ${REDACTED} 확인`);
  });

  it('이메일을 지운다', () => {
    expect(redactText('tre723123@gmail.com 로 초대')).toBe(`${REDACTED} 로 초대`);
  });

  it('12자리 이상 숫자를 지운다 — 연도·타임스탬프는 살린다', () => {
    expect(redactText('주문 123456789012345')).toBe(`주문 ${REDACTED}`);
    expect(redactText('2026년 1754400000')).toBe('2026년 1754400000');
  });

  it('평범한 제목은 그대로 둔다', () => {
    const title = 'vercel/next.js · Issue #12345 hydration';
    expect(redactText(title)).toBe(title);
  });
});

describe('redactUrl', () => {
  it('경로를 지우고 쿼리스트링은 통째로 버린다', () => {
    expect(redactUrl('https://github.com/o/r/settings/secrets/actions/API_KEY?tab=x')).toBe(
      `https://github.com/o/r/settings/secrets/actions/${REDACTED}`,
    );
  });
});

describe('redactPayload', () => {
  it('title/path/query/url 만 손대고 나머지는 그대로 통과시킨다', () => {
    const out = redactPayload({
      scrolls: 3,
      clicks: 1,
      keys: 42,
      visible: true,
      title: 'Actions secrets · tre723123@gmail.com',
      path: '/o/r/settings/secrets/actions/GOORM_SID',
      query: 'github actions secret 설정',
    });

    expect(out.scrolls).toBe(3);
    expect(out.keys).toBe(42);
    expect(out.visible).toBe(true);
    expect(out.title).toBe(`Actions secrets · ${REDACTED}`);
    expect(out.path).toBe(`/o/r/settings/secrets/actions/${REDACTED}`);
    expect(out.query).toBe('github actions secret 설정');
  });

  it('원본 객체를 변형하지 않는다', () => {
    const payload = { path: '/r/settings/secrets/actions/X_TOKEN' };
    redactPayload(payload);
    expect(payload.path).toBe('/r/settings/secrets/actions/X_TOKEN');
  });
});
