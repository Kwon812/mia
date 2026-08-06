"use client";

import { useState, useTransition } from "react";
import { correctExperience } from "@/app/actions";
import { FIELD_OPTIONS, labelOf } from "@/lib/labels";
import type { CorrectionField } from "@/lib/corrections";

// 층 1 — 판정 교정 UI.
//
// "이거 나 맞아?" 같은 이진 승인은 정보량이 거의 0 이다. 대부분 "맞다"가
// 나오고, 틀렸을 때도 무엇이 틀렸는지 모른다. 그래서 **모델이 이미 낸 값을
// 고치게** 한다 — 그 자리에서 (모델 출력, 사람 정답) 쌍이 만들어지고,
// 어느 필드가 틀렸는지가 특정된다.
//
// 자유 서술은 받지 않는다(사용자 결정으로 층 3 제외). 이산 선택지만이라
// 탭 한 번이면 끝나고, 1년을 버티려면 이 비용이 결정적이다.

type Props = {
  experienceId: string;
  field: CorrectionField;
  /** 지금 유효한 값 — 교정이 있으면 교정값, 없으면 모델 값 */
  value: string;
  /** 사람 손을 탔는가 */
  corrected: boolean;
};

export function CorrectionChip({ experienceId, field, value, corrected }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { title, options } = FIELD_OPTIONS[field];

  function choose(next: string) {
    setOpen(false);
    // 지금 값을 다시 누른 것은 교정이 아니다. 훑어보려고 열었다가 그대로
    // 닫는 동작이 대부분이라, 이걸 기록하면 "사람이 보고 맞다고 했다"는
    // 확인 라벨이 통째로 못 믿을 값이 된다.
    //
    // 의도가 분명한 확인은 캐릭터 질문(층 2)에서 받는다 — 그건 물음에 답한
    // 것이라 훑어보다 누른 것과 섞이지 않는다.
    if (next === value) return;

    setError(null);
    startTransition(async () => {
      const res = await correctExperience(experienceId, field, next);
      if (res.error) setError(res.error);
    });
  }

  return (
    <span className="relative inline-flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-label={`${title} 고치기 — 지금 ${labelOf(field, value)}`}
        aria-expanded={open}
        className={[
          "readout rounded-sm px-1.5 py-0.5 text-[10.5px] transition-colors",
          "border border-[rgba(160,185,220,0.14)] hover:border-[rgba(160,185,220,0.34)]",
          // 사람이 고친 값은 밝게. 화면에서 "이건 내가 정한 것"이 구분돼야
          // 교정이 반영되고 있다는 확신이 생긴다.
          corrected ? "text-lum-0" : "text-lum-3",
          pending ? "opacity-40" : "",
        ].join(" ")}
      >
        {labelOf(field, value)}
        {corrected && <span className="ml-1 text-lum-4">·</span>}
      </button>

      {open && (
        <span className="absolute top-full left-0 z-20 mt-1 flex max-w-[19rem] flex-wrap gap-1 rounded-sm border border-[rgba(160,185,220,0.16)] bg-[#0b0e14] p-1.5 shadow-lg">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => choose(o.value)}
              className={[
                "readout rounded-sm px-1.5 py-0.5 text-[10.5px] whitespace-nowrap transition-colors",
                o.value === value
                  ? "bg-[rgba(160,185,220,0.14)] text-lum-0"
                  : "text-lum-2 hover:bg-[rgba(160,185,220,0.08)] hover:text-lum-0",
              ].join(" ")}
            >
              {o.label}
            </button>
          ))}
        </span>
      )}

      {error && <span className="readout mt-1 text-[10px] text-lum-3">{error}</span>}
    </span>
  );
}
