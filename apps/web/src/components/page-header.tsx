// 페이지 상단 공통 헤더. kicker 는 모노 대문자 라벨.
export function PageHeader({
  kicker,
  title,
  desc,
}: {
  kicker: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="mb-10 border-b-2 border-ink pb-6">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-live">
        {kicker}
      </div>
      <h1 className="text-[27px] font-semibold leading-tight tracking-tight">
        {title}
      </h1>
      {desc && <p className="mt-2 text-[14.5px] text-sub">{desc}</p>}
    </div>
  );
}
