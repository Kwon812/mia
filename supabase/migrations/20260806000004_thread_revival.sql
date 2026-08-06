-- 잠긴 갈래를 다시 찾기 위한 전문검색 인덱스.
--
-- 갈래는 30일 무활동이면 abandoned 가 되는데, 그 뒤로는 LLM 후보 목록에
-- 아예 안 올라가서 3년 뒤에 같은 일을 다시 해도 새 갈래가 생긴다. 사람 기억에
-- "끝"은 드물고 대개는 한동안 안 건드릴 뿐이라, 이건 사실과 어긋난다.
--
-- 되찾는 신호는 **글**이다. 세션의 페이지 제목·검색어에서 토큰을 뽑아 tsquery
-- 로 던지면, 그 글이 색인된 갈래가 걸린다. 도메인은 못 쓴다 — github.com 은
-- 모든 dev 갈래에 겹쳐 변별력이 없다.
--
-- 갈래 쪽에 키워드 컬럼을 두지 않는 이유: 경험이 붙을 때마다 갱신해야 하고
-- 재구축 때 다시 만들어야 한다. 어긋날 파생값을 늘리느니 인덱스가 낫다 —
-- 유지는 Postgres 가 한다.
--
-- 'simple' 설정을 쓴다. 한국어 형태소 사전이 없어 어절을 그대로 쪼개는데,
-- 이 데이터는 고유명사가 제목에 그대로 뜨므로("Project NA", "kt cloud")
-- 그걸로 충분하다. memories 의 idx_mem_search 도 같은 설정이다.
create index if not exists idx_exp_summary_fts
  on experiences using gin (to_tsvector('simple', summary));

create index if not exists idx_threads_title_fts
  on threads using gin (to_tsvector('simple', title));
