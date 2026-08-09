"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { correctExperience } from "@/app/actions";
import { FIELD_OPTIONS, labelOf, type ChipField } from "@/lib/labels";
import type { CorrectionField } from "@/lib/corrections";

// 층 1 — 판정 교정 UI.
//
// "이거 나 맞아?" 같은 이진 승인은 정보량이 거의 0 이다. 대부분 "맞다"가
// 나오고, 틀렸을 때도 무엇이 틀렸는지 모른다. 그래서 **모델이 이미 낸 값을
// 고치게** 한다 — 그 자리에서 (모델 출력, 사람 정답) 쌍이 만들어지고,
// 어느 필드가 틀렸는지가 특정된다.
//
// 선택지는 **떠 있는 드롭다운이 아니라 줄 아래로 펼친다.**
// 예전에는 absolute 로 띄웠는데, 일기가 길어지면 아래쪽 항목의 패널이 화면
// 밖으로 나가 클릭조차 안 됐다. 문서 흐름 안에 두면 그 문제가 구조적으로
// 사라지고(스크롤하면 항상 닿는다), 패널·카드를 쓰지 않는 이 화면의 결과도 맞다.

type Values = {
  category: string;
  outcome: string;
  is_first_time: string;
};

// ChipField 지 CorrectionField 가 아니다 — 갈래(thread)는 선택지가 사용자의
// 갈래 목록이라 칩으로 못 그린다. 지도에서 대상을 직접 집어서 고친다.
const FIELD_ORDER: ChipField[] = ["category", "outcome", "is_first_time"];

export function CorrectionRow({
  experienceId,
  time,
  summary,
  values,
  corrected,
}: {
  experienceId: string;
  time: string;
  summary: string;
  values: Values;
  /** 사람이 손댄 필드 집합 */
  corrected: Partial<Record<CorrectionField, boolean>>;
}) {
  const [open, setOpen] = useState<ChipField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 펼친 패널이 화면 밖이면 끌어온다. 인라인이라 잘리지는 않지만, 목록
  // 아래쪽에서 열면 여전히 스크롤을 요구하게 된다.
  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [open]);

  function choose(field: ChipField, next: string) {
    setOpen(null);
    // 지금 값을 다시 누른 것은 교정이 아니다. 훑어보려고 열었다가 그대로
    // 닫는 동작이 대부분이라, 이걸 기록하면 "사람이 보고 맞다고 했다"는
    // 확인 라벨이 통째로 못 믿을 값이 된다.
    //
    // 의도가 분명한 확인은 캐릭터 질문(층 2)에서 받는다 — 그건 물음에 답한
    // 것이라 훑어보다 누른 것과 섞이지 않는다.
    if (next === values[field]) return;

    setError(null);
    startTransition(async () => {
      const res = await correctExperience(experienceId, field, next);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="readout w-11 shrink-0 pt-0.5 text-[11.5px] text-lum-4">{time}</span>
        <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-lum-2">{summary}</span>
        <span className="flex shrink-0 gap-1">
          {FIELD_ORDER.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => setOpen((v) => (v === field ? null : field))}
              disabled={pending}
              aria-label={`${FIELD_OPTIONS[field].title} 고치기 — 지금 ${labelOf(field, values[field])}`}
              aria-expanded={open === field}
              className={[
                "readout rounded-sm border px-1.5 py-0.5 text-[12px] transition-colors",
                open === field
                  ? "border-[rgba(160,185,220,0.5)] text-lum-0"
                  : "border-[rgba(160,185,220,0.14)] hover:border-[rgba(160,185,220,0.34)]",
                // 사람이 고친 값은 밝게. 화면에서 "이건 내가 정한 것"이 구분돼야
                // 교정이 반영되고 있다는 확신이 생긴다.
                corrected[field] ? "text-lum-0" : open === field ? "" : "text-lum-3",
                pending ? "opacity-40" : "",
              ].join(" ")}
            >
              {labelOf(field, values[field])}
              {corrected[field] && <span className="ml-1 text-lum-4">·</span>}
            </button>
          ))}
        </span>
      </div>

      {open && (
        <div
          ref={panelRef}
          className="ml-[3.25rem] flex flex-wrap items-center gap-1 border-l border-[rgba(160,185,220,0.12)] py-1.5 pl-3"
        >
          <span className="readout mr-1 text-[11.5px] text-lum-4">{FIELD_OPTIONS[open].title}</span>
          {FIELD_OPTIONS[open].options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => choose(open, o.value)}
              className={[
                "readout rounded-sm px-1.5 py-0.5 text-[12px] whitespace-nowrap transition-colors",
                o.value === values[open]
                  ? "bg-[rgba(160,185,220,0.14)] text-lum-0"
                  : "text-lum-2 hover:bg-[rgba(160,185,220,0.1)] hover:text-lum-0",
              ].join(" ")}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="readout ml-1 px-1 py-0.5 text-[11.5px] text-lum-4 transition-colors hover:text-lum-2"
          >
            닫기
          </button>
        </div>
      )}

      {error && <span className="readout ml-[3.25rem] text-[11.5px] text-lum-3">{error}</span>}
    </div>
  );
}
