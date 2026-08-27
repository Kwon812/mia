"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

// 구글로 넘어가는 버튼. 돌아오는 자리는 /auth/callback 이고, 계정을 잇는 판단은
// 전부 거기서 한다 — 이 컴포넌트는 문을 열기만 한다.
export function GoogleConnect({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) {
        setError("구글로 넘어가지 못했어. 잠시 후 다시 시도해줄래?");
        setBusy(false);
      }
      // 성공하면 이 페이지를 떠난다. busy 를 되돌리지 않는 게 맞다 —
      // 되돌리면 리다이렉트가 걸리는 짧은 사이에 버튼이 다시 눌린다.
    } catch {
      setError("구글로 넘어가지 못했어. 잠시 후 다시 시도해줄래?");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="self-start border border-sig px-5 py-2.5 font-mono text-[12.5px] tracking-[0.16em] text-sig transition-colors hover:bg-sig hover:text-vac disabled:opacity-40"
      >
        {busy ? "구글로 넘어가는 중..." : label}
      </button>
      {error && <p className="font-mono text-[13.5px] text-sig">{error}</p>}
    </div>
  );
}
