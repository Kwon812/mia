"use client";

import { useActionState } from "react";
import { setCharacterName, type SetCharacterNameResult } from "@/app/actions";

async function action(
  _prevState: SetCharacterNameResult,
  formData: FormData,
): Promise<SetCharacterNameResult> {
  const name = String(formData.get("name") ?? "");
  return setCharacterName(name);
}

// Day 0 — 사용자가 하는 행동은 이름 입력 하나뿐.
export function NameForm() {
  const [state, formAction, isPending] = useActionState(action, {});

  return (
    <form action={formAction} className="mt-8 flex flex-col items-center gap-3">
      <input
        name="name"
        type="text"
        maxLength={12}
        placeholder="이름을 지어줘"
        autoComplete="off"
        className="w-48 border-b-2 border-ink bg-transparent py-1.5 text-center font-serif text-[17px] text-ink outline-none placeholder:text-faint focus:border-live"
      />
      {state.error && (
        <p className="font-mono text-[11.5px] text-live">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="border border-ink bg-ink px-4 py-1.5 font-mono text-[11.5px] text-paper transition-opacity disabled:opacity-50"
      >
        {isPending ? "짓는 중..." : "이름 짓기"}
      </button>
    </form>
  );
}
