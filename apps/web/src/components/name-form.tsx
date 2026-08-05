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
        className="w-56 border-b border-lum-3 bg-transparent px-4 py-2.5 text-center font-serif text-[17px] text-lum-0 outline-none focus:border-sig"
      />
      {state.error && (
        <p className="font-mono text-[11.5px] text-sig">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="border border-sig px-5 py-2 font-mono text-[11px] tracking-[0.16em] text-sig transition-colors hover:bg-sig hover:text-vac disabled:opacity-40"
      >
        {isPending ? "짓는 중..." : "이름 짓기"}
      </button>
    </form>
  );
}
