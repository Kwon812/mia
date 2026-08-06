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
        className="w-full max-w-md border border-lum-4 bg-vac-2 px-3.5 py-2.5 font-mono text-[14.5px] text-lum-0 outline-none focus:border-sig"
      />
      {error && <p className="font-mono text-[13.5px] text-sig">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="self-start border border-sig px-5 py-2.5 font-mono text-[12.5px] tracking-[0.16em] text-sig transition-colors hover:bg-sig hover:text-vac disabled:opacity-40"
      >
        {isPending ? "연결하는 중..." : "연결하기"}
      </button>
    </form>
  );
}
