"use client";

// ============================================================
// 갈래 교정 패널 — 고른 경험을 다른 갈래로 옮긴다.
//
// 지도에 붙는 이유: 갈래는 선택지가 사용자의 갈래 목록이라 일기의 칩으로도
// 캐릭터의 물음으로도 못 다룬다. 대상을 눈으로 보고 집어야 한다.
//
// 왜 필요한가: 통제된 시험에서 쌍 F1 54.3%, 정밀도 43% 였다. 모델은 세션이
// 올 때마다 "지금까지 본 것"만으로 되돌릴 수 없는 배정을 하고, 초반 오판
// 하나가 남은 전부를 끌고 간다. 오라클 시험이 보여준 바로는 갈래 목록만
// 올바르면 프롬프트를 안 고쳐도 89.2% 다 — 남은 30pt 는 여기서 온다.
// (docs/HANDOFF-attach.md)
// ============================================================

import { useMemo, useState, useTransition } from "react";

import type { ThreadBody } from "@/components/orbital-map";

type FixResult = { ok: true; effects: string[] } | { ok: false; error: string };

export function ThreadFix({
  experienceId,
  experienceSummary,
  currentThreadId,
  threads,
  onMove,
}: {
  experienceId: string;
  experienceSummary: string;
  currentThreadId: string | null;
  threads: ThreadBody[];
  onMove: (
    experienceId: string,
    target: { kind: "existing"; threadId: string } | { kind: "new"; title: string },
  ) => Promise<FixResult>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = threads.find((t) => t.id === currentThreadId);

  // 지금 갈래는 뺀다 — 이미 거기 있는 곳으로 옮길 수는 없다.
  // 최근 활동순은 이미 threads 순서에 담겨 있으므로 다시 정렬하지 않는다.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads
      .filter((t) => t.id !== currentThreadId)
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .slice(0, 12);
  }, [threads, currentThreadId, query]);

  // 적은 이름과 똑같은 갈래가 이미 있으면 새로 만들지 않는다. 이름이 같은
  // 갈래가 둘 생기면 다음 판정이 어느 쪽을 봐야 할지 모른다 — 고치려던
  // 오염을 다른 모양으로 다시 만드는 셈이다.
  const exact = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? threads.find((t) => t.title.toLowerCase() === q) : undefined;
  }, [threads, query]);

  function run(target: { kind: "existing"; threadId: string } | { kind: "new"; title: string }) {
    setError(null);
    startTransition(async () => {
      const r = await onMove(experienceId, target);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // 무엇이 달라졌는지 말한다. 기억이 강등되거나 생기는 일이 옮기기 하나로
      // 일어나므로, 조용히 하면 사람이 모르는 사이에 별이 사라진다.
      setNote(r.effects.join(" · ") || "옮겼어");
      setOpen(false);
      setQuery("");
    });
  }

  if (!open) {
    return (
      <div className="pointer-events-auto mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="readout rounded-sm border border-[rgba(160,185,220,0.18)] px-2 py-1 text-[12px] text-lum-2 transition-colors hover:border-[rgba(160,185,220,0.4)] hover:text-lum-0"
        >
          다른 갈래로 옮기기
        </button>
        {note && <span className="readout text-[12px] text-lum-3">{note}</span>}
      </div>
    );
  }

  return (
    <div className="pointer-events-auto mt-3 rounded-sm border border-[rgba(160,185,220,0.18)] bg-[rgba(10,14,22,0.86)] p-3 text-left backdrop-blur-sm">
      <div className="tick mb-2">
        {current ? `지금 「${current.title}」` : "지금 갈래 없음"}
      </div>
      <p className="mb-2 truncate font-sans text-[12.5px] text-lum-2">{experienceSummary}</p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="갈래 이름 — 찾거나, 새로 지으려면 그대로 적어"
        disabled={pending}
        className="readout mb-2 w-full rounded-sm border border-[rgba(160,185,220,0.16)] bg-transparent px-2 py-1 text-[12.5px] text-lum-0 outline-none placeholder:text-lum-4 focus:border-[rgba(160,185,220,0.4)]"
      />

      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {candidates.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={pending}
            onClick={() => run({ kind: "existing", threadId: t.id })}
            className="readout flex items-baseline justify-between gap-2 rounded-sm px-1.5 py-1 text-left text-[12.5px] text-lum-2 transition-colors hover:bg-[rgba(160,185,220,0.1)] hover:text-lum-0"
          >
            <span className="truncate">{t.title}</span>
            <span className="shrink-0 text-[11px] text-lum-4">
              {t.experienceCount}건{t.memory ? " · 기억" : ""}
            </span>
          </button>
        ))}
        {candidates.length === 0 && (
          <span className="readout px-1.5 py-1 text-[12px] text-lum-4">맞는 갈래가 없어</span>
        )}
      </div>

      {/* 새로 만들기는 이름이 겹치지 않을 때만 뜬다 — 같은 이름의 갈래가
          둘이면 다음 판정이 어느 쪽을 봐야 할지 모른다. */}
      {query.trim() && !exact && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ kind: "new", title: query.trim() })}
          className="readout mt-2 w-full rounded-sm border border-[rgba(160,185,220,0.24)] px-2 py-1 text-[12.5px] text-lum-1 transition-colors hover:border-[rgba(160,185,220,0.5)] hover:text-lum-0"
        >
          「{query.trim()}」 새 갈래로 만들기
        </button>
      )}

      {error && <p className="readout mt-2 text-[12px] text-[#e0a0a0]">{error}</p>}

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="readout mt-2 text-[11.5px] text-lum-4 transition-colors hover:text-lum-2"
      >
        그만두기
      </button>
    </div>
  );
}
