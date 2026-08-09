"use client";

import { useState, useTransition } from "react";
import { answerQuestion, dismissQuestion } from "@/app/actions";
import { FIELD_OPTIONS, isChipField } from "@/lib/labels";
import type { CorrectionField } from "@/lib/corrections";

// 층 2 — 캐릭터가 먼저 묻는다.
//
// 층 1(/diary 칩)이 "훑다가 눈에 띄면 고친다"면 여기는 **모델이 제일 자신
// 없는 한 건을 골라 먼저 묻는** 경로다. 무작위 라벨보다 정보량이 크고,
// 무엇보다 라벨링이 폼 작성이 아니라 캐릭터와의 대화가 된다 — 1년을 버티려면
// 그 차이가 결정적이다. 하루 20초짜리 폼은 3주면 아무도 안 누른다.
//
// "넘기기"가 따로 있는 이유: 무응답(침묵)과 "봤는데 모르겠다"는 다른 정보다.
// 둘을 같이 세면 무응답률이 왜곡되고, 그러면 침묵을 동의로 착각하게 된다.

export type AskQuestion = {
  id: string;
  field: CorrectionField;
  text: string;
  /** 모델이 낸 값. "맞아?" 라고 물었으면 긍정 버튼이 하나 있어야 한다. */
  modelValue: string;
};

export function AskCard({ question }: { question: AskQuestion }) {
  const [gone, setGone] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (gone) return null;

  // 캐릭터는 갈래를 묻지 않는다 — 선택지가 사용자의 갈래 목록이라 물음으로
  // 성립하지 않는다("갈래가 A 야 B 야 … 열일곱 개 중에?"). 갈래는 지도에서
  // 대상을 직접 집어서 고친다. 만들어질 일이 없지만 타입이 열려 있으므로 막는다.
  if (!isChipField(question.field)) return null;
  const { options } = FIELD_OPTIONS[question.field];

  function answer(value: string) {
    setError(null);
    startTransition(async () => {
      const res = await answerQuestion(question.id, value);
      if (res.error) setError(res.error);
      else setGone(true);
    });
  }

  function skip() {
    startTransition(async () => {
      await dismissQuestion(question.id);
      setGone(true);
    });
  }

  return (
    <div className="settle field mt-10 py-6">
      <div className="tick mb-3 text-[11px] text-lum-4">묻고 싶은 게 하나 있어</div>
      <p className="utterance text-[15.5px]">{question.text}</p>

      {/* 질문이 "맞아?" 라서 긍정 버튼이 먼저 와야 한다. 선택지 13개를 그대로
          깔면 묻는 말과 선택지가 어긋나고, 무엇보다 **의도적인 확인**이라는
          신호가 흐려진다 — 확인 라벨은 층 2 에서만 나오는 값이라 흐려지면 안 된다.
          아니라고 답할 때만 대안을 펼친다. */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {!showOptions && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(question.modelValue)}
              className="readout rounded-sm border border-[rgba(160,185,220,0.34)] px-2.5 py-1 text-[12px] text-lum-0 transition-colors hover:border-[rgba(160,185,220,0.6)] disabled:opacity-40"
            >
              맞아
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowOptions(true)}
              className="readout rounded-sm border border-[rgba(160,185,220,0.16)] px-2.5 py-1 text-[12px] text-lum-2 transition-colors hover:border-[rgba(160,185,220,0.38)] hover:text-lum-0 disabled:opacity-40"
            >
              아니야
            </button>
          </>
        )}
        {showOptions &&
          options
            // 모델 값은 위 "맞아" 가 이미 담당한다. 여기 또 있으면 같은 뜻의
            // 버튼이 둘이 되어 어느 쪽을 눌러야 할지 헷갈린다.
            .filter((o) => o.value !== question.modelValue)
            .map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={pending}
                onClick={() => answer(o.value)}
                className="readout rounded-sm border border-[rgba(160,185,220,0.16)] px-2 py-1 text-[12px] text-lum-2 transition-colors hover:border-[rgba(160,185,220,0.38)] hover:text-lum-0 disabled:opacity-40"
              >
                {o.label}
              </button>
            ))}
        <button
          type="button"
          disabled={pending}
          onClick={skip}
          className="readout ml-1 px-1.5 py-1 text-[12px] text-lum-4 transition-colors hover:text-lum-2 disabled:opacity-40"
        >
          모르겠어
        </button>
      </div>

      {error && <p className="readout mt-3 text-[11.5px] text-lum-3">{error}</p>}
    </div>
  );
}
