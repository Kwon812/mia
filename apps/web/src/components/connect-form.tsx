"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// 확장 발급 키(na_...)를 붙여넣어 이 브라우저를 캐릭터와 연결한다.
export function ConnectForm() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = key.trim();
    if (!trimmed) {
      setError("키를 입력해줘.");
      return;
    }

    let res: Response;
    try {
      res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extension_key: trimmed }),
      });
    } catch {
      setError("연결에 실패했어. 네트워크를 확인해줘.");
      return;
    }

    if (res.status === 204) {
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
      return;
    }

    if (res.status === 401) {
      setError("키가 올바르지 않아. 다시 확인해줄래?");
      return;
    }

    setError("연결에 실패했어. 잠시 후 다시 시도해줘.");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
      <input
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="na_..."
        autoComplete="off"
        spellCheck={false}
        className="border border-rule bg-paper px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-live"
      />
      {error && <p className="font-mono text-[12px] text-live">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="self-start border border-ink bg-ink px-4 py-2 font-mono text-[12px] text-paper transition-opacity disabled:opacity-50"
      >
        {isPending ? "연결하는 중..." : "연결하기"}
      </button>
    </form>
  );
}
