// 페이지 상단 공통 헤더. 굵은 밑줄 대신 빛이 옆으로 흩어지는 선을 쓴다 —
// 따뜻한 쪽에서 시작해 차가운 쪽으로 갈라지는 분산광이 이 디자인의 규칙이다.
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
    <div className="na-rise mb-9 pb-6">
      <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-live">
        {kicker}
      </div>
      <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-balance">
        {title}
      </h1>
      {desc && <p className="mt-2.5 max-w-[46ch] text-[14.5px] leading-relaxed text-sub">{desc}</p>}
      <div
        className="mt-6 h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, rgba(180,103,31,.55), rgba(16,26,43,.16) 42%, rgba(62,143,156,.4) 78%, transparent)",
        }}
        aria-hidden="true"
      />
    </div>
  );
}
