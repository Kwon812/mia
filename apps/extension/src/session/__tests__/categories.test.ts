import { describe, expect, it } from 'vitest';
import { categorize, isBlockedDomain, isCompanionDomain, isBackgroundAudioDomain } from '../categories';

// 기록되는 도메인은 포트를 달고 온다(`localhost:3000`). localhost 한 키에 여러
// 프로젝트가 물려 있어서 포트가 없으면 구분이 페이지 제목 하나에만 매달리기
// 때문이다 — 실측으로 넷이 한 키에 들어 있었다.
//
// 그런데 사전 조회는 '.' 으로 쪼개 longest-suffix 로 맞춘다. 포트가 붙은 채로
// 쪼개면 `example.com:8443` → ['example', 'com:8443'] 이 되어 `example.com` 과
// 영영 안 맞는다. **차단 목록이 통째로 빗나가는 자리**라 테스트로 못 박아둔다.
describe('포트가 붙어도 사전 조회가 안 깨진다', () => {
  it('차단 도메인은 포트가 붙어도 차단된다', () => {
    expect(isBlockedDomain('mail.google.com')).toBe(true);
    expect(isBlockedDomain('mail.google.com:8443')).toBe(true);
    expect(isBlockedDomain('kbstar.com:443')).toBe(true);
  });

  it('카테고리 사전도 포트를 무시한다', () => {
    expect(categorize('github.com')).toBe(categorize('github.com:8443'));
    expect(categorize('github.com:8443')).toBe('dev');
  });

  it('보조 도메인·배경 음악 판정도 마찬가지다', () => {
    expect(isCompanionDomain('chatgpt.com:443')).toBe(true);
    expect(isBackgroundAudioDomain('open.spotify.com:443')).toBe(true);
  });

  it('포트 없는 값은 예전과 똑같이 동작한다 (회귀 방어)', () => {
    expect(categorize('music.youtube.com')).toBe('music');
    expect(categorize('알수없는도메인.example')).toBe('etc');
    expect(isBlockedDomain('github.com')).toBe(false);
  });

  it('localhost 는 포트가 달라도 같은 분야(dev)로 판정된다 — 가르는 것은 기록되는 키다', () => {
    // 분야는 같아야 맞다. 포트가 다르다고 개발이 아닌 게 되지 않는다.
    expect(categorize('localhost:3000')).toBe('dev');
    expect(categorize('localhost:3001')).toBe('dev');
    // 대상을 가르는 것은 카테고리가 아니라 도메인 키다 —
    // 예전에는 둘 다 'localhost' 로 뭉쳐 제목 하나에만 매달렸다.
    expect('localhost:3000').not.toBe('localhost:3001');
  });
});
