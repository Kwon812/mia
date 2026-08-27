"use client";

import { useEffect, useState } from "react";

// 서버가 돌려준 사유를 사람 말로. 라우트의 ClaimResult 와 짝이다.
const MESSAGE: Record<string, string> = {
  owned: "이 기기는 이미 다른 계정에 묶여 있어요. 그 계정에서 먼저 풀어야 해요.",
  has_data:
    "이 기기에 이미 쌓인 기록이 있어요. 두 캐릭터를 합치는 건 아직 안 돼요 — 새로 깐 직후라면 이 화면에서 바로 연결하는 게 가장 깔끔해요.",
  unknown_key: "그 키로 등록된 기기가 없어요. 확장을 새로고침하고 다시 열어볼래요?",
  unauthorized: "구글 로그인이 풀렸어요. 다시 들어와주세요.",
  forbidden: "요청이 거부됐어요. 새로고침하고 다시 시도해주세요.",
  invalid_request: "키 형식이 아니에요.",
  internal_error: "연결에 실패했어요. 잠시 후 다시 시도해주세요.",
};

/**
 * 지금 보고 있는 브라우저의 확장을 이 계정에 붙인다.
 *
 * 키는 확장의 connect-content.js 가 넘겨준다. **자동으로 붙이지는 않는다** —
 * 기기의 주인을 바꾸는 것은 되돌리기 번거로운 조작이고, 사람 모르게 돌리면
 * 틀렸다는 걸 아는 시점이 이미 실행된 뒤다. 버튼은 사람이 누른다.
 *
 * 확장이 못 넘겨주는 경우(다른 브라우저에서 열었다든지)를 위해 칸은 열어둔다.
 * 팝업의 "지금 키" 는 눌러서 통째로 집을 수 있다.
 */
export function DeviceClaim() {
  const [key, setKey] = useState("");
  const [fromExtension, setFromExtension] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 두 경로로 받는다. content script 가 먼저 끝나면 속성에, 이 컴포넌트가
    // 먼저 붙으면 메시지에 걸린다 — 둘 중 어느 쪽이 빠른지 보장이 없다.
    const fromAttribute = document.documentElement.getAttribute("data-na-device-key");
    if (fromAttribute) {
      setKey(fromAttribute);
      setFromExtension(true);
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { __na?: string; key?: unknown };
      if (data?.__na !== "device-key" || typeof data.key !== "string") return;
      setKey(data.key);
      setFromExtension(true);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function submit() {
    const trimmed = key.trim();
    if (!trimmed) {
      setError("연결할 기기 키가 없어요.");
      return;
    }
    setBusy(true);
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/devices/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extension_key: trimmed }),
      });
    } catch {
      setError("연결에 실패했어요. 네트워크를 확인해줄래요?");
      setBusy(false);
      return;
    }

    if (res.ok) {
      setDone(true);
      setBusy(false);
      return;
    }

    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(MESSAGE[body?.error ?? ""] ?? "연결에 실패했어요.");
    setBusy(false);
  }

  if (done) {
    return (
      <p className="text-[14.5px] leading-relaxed text-lum-1">
        이 기기를 연결했어요. 지금부터 이 브라우저의 기록은 이 캐릭터에 쌓여요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14.5px] leading-relaxed text-lum-1">
        {fromExtension
          ? "이 브라우저의 확장을 찾았어요. 이 기기를 이 캐릭터에 붙일까요?"
          : "확장에서 키를 받지 못했어요. 팝업의 “지금 키”를 복사해 넣어주세요."}
      </p>
      <input
        type="text"
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setFromExtension(false);
        }}
        placeholder="na_..."
        autoComplete="off"
        spellCheck={false}
        className="w-full max-w-md border border-lum-4 bg-vac-2 px-3.5 py-2.5 font-mono text-[14.5px] text-lum-0 outline-none focus:border-sig"
      />
      {error && <p className="font-mono text-[13.5px] leading-relaxed text-sig">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="self-start border border-sig px-5 py-2.5 font-mono text-[12.5px] tracking-[0.16em] text-sig transition-colors hover:bg-sig hover:text-vac disabled:opacity-40"
      >
        {busy ? "연결하는 중..." : "이 기기를 연결하기"}
      </button>
    </div>
  );
}
