"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { correctExperience } from "@/app/actions";
import { FIELD_OPTIONS, FIELD_TITLE, NO_THREAD_LABEL, labelOf } from "@/lib/labels";
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
  /** 지금 붙어 있는 갈래 제목. 안 붙었으면 빈 문자열. */
  thread: string;
};

// 갈래를 맨 끝에 둔다. 앞의 셋은 이 경험 자체에 대한 판정이고 갈래만 다른
// 경험들과의 관계라, 섞으면 무엇을 고치는 건지 헷갈린다.
const FIELD_ORDER: CorrectionField[] = ["category", "outcome", "is_first_time", "thread"];

/** 갈래 제목 상한 — actions.ts 의 MAX_THREAD_TITLE_LENGTH 와 같은 값. */
const MAX_THREAD_TITLE_LENGTH = 100;
/** 칩에 들어갈 갈래 제목 길이. 넘으면 한 줄이 칩 하나로 다 찬다. */
const CHIP_TITLE_LEN = 12;

/** 칩에 적을 글자. 앞의 셋은 열거라 라벨표를 쓰고, 갈래는 제목 그 자체다. */
function chipText(field: CorrectionField, values: Values): string {
  if (field !== "thread") return labelOf(field, values[field]);
  if (!values.thread) return NO_THREAD_LABEL;
  return values.thread.length > CHIP_TITLE_LEN
    ? `${values.thread.slice(0, CHIP_TITLE_LEN)}…`
    : values.thread;
}

export function CorrectionRow({
  experienceId,
  time,
  summary,
  values,
  corrected,
  threadTitles,
}: {
  experienceId: string;
  time: string;
  summary: string;
  values: Values;
  /** 사람이 손댄 필드 집합 */
  corrected: Partial<Record<CorrectionField, boolean>>;
  /** 고를 수 있는 기존 갈래 제목들. 여기 없는 이름을 적으면 새로 만든다. */
  threadTitles: readonly string[];
}) {
  const [open, setOpen] = useState<CorrectionField | null>(null);
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

  function choose(field: CorrectionField, next: string) {
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
              aria-label={`${FIELD_TITLE[field]} 고치기 — 지금 ${chipText(field, values)}`}
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
              {chipText(field, values)}
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
          <span className="readout mr-1 text-[11.5px] text-lum-4">{FIELD_TITLE[open]}</span>
          {open === "thread"
            ? // 갈래는 선택지가 고정이 아니다 — 기존 갈래를 고르거나 새 이름을
              // 적는다. 적는 쪽이 있어야 "지금 목록에 없는 일"을 표현할 수 있고,
              // 잘못 뭉친 갈래를 풀어내는 건 대개 그 경우다.
              threadTitles.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => choose("thread", t)}
                  title={t}
                  className={[
                    "readout max-w-[16rem] truncate rounded-sm px-1.5 py-0.5 text-[12px] transition-colors",
                    t === values.thread
                      ? "bg-[rgba(160,185,220,0.14)] text-lum-0"
                      : "text-lum-2 hover:bg-[rgba(160,185,220,0.1)] hover:text-lum-0",
                  ].join(" ")}
                >
                  {t}
                </button>
              ))
            : FIELD_OPTIONS[open].options.map((o) => (
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
          {open === "thread" && (
            <input
              type="text"
              defaultValue=""
              placeholder="새 갈래 이름"
              maxLength={MAX_THREAD_TITLE_LENGTH}
              disabled={pending}
              // Enter 로만 확정한다. onBlur 로 확정하면 훑어보다 다른 데를
              // 눌렀을 뿐인데 갈래가 바뀐다 — 되돌리기 어려운 쪽 실수다.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const v = e.currentTarget.value.trim();
                if (v) choose("thread", v);
              }}
              className="readout min-w-[9rem] flex-1 rounded-sm border border-[rgba(160,185,220,0.14)] bg-transparent px-1.5 py-0.5 text-[12px] text-lum-1 outline-none placeholder:text-lum-4 focus:border-[rgba(160,185,220,0.4)]"
            />
          )}
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
