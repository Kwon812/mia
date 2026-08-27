import { redirect } from "next/navigation";
import { ConnectForm } from "@/components/connect-form";
import { GoogleConnect } from "@/components/google-connect";
import { getCurrentUser } from "@/lib/current-user";
import { Head, Shell } from "@/components/shell";

// /auth/callback 이 실패를 여기로 되돌려보낸다. 사람에게 보일 말은 한 곳에만 둔다.
const AUTH_NOTE: Record<string, string> = {
  cancelled: "구글 로그인을 도중에 멈췄어요.",
  failed: "구글 연결에 실패했어요. 잠시 후 다시 시도해주세요.",
  // 구글만으로는 새 캐릭터를 만들지 않는다(/auth/callback 주석 참고).
  no_device:
    "이 브라우저에 아직 캐릭터가 없어요. 확장을 먼저 연결해주세요 — 구글만으로는 새로 시작하지 않아요.",
  already_linked: "이 캐릭터에는 이미 다른 구글 계정이 이어져 있어요.",
};

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const auth = (await searchParams).auth;
  const note = typeof auth === "string" ? AUTH_NOTE[auth] : undefined;

  return (
    <Shell>
      <Head
        tick="LINK · 미연결"
        title="아직 이 브라우저가 계와 연결되지 않았다"
        note="확장이 설치돼 있으면 잠시 후 자동으로 연결된다. 안 되면 아래에 키를 직접 넣으면 된다."
      />

      {note && (
        <p className="mb-10 border border-sig px-4 py-3 font-mono text-[13.5px] leading-relaxed text-sig">
          {note}
        </p>
      )}

      <div className="flex flex-col gap-12">
        <section>
          <div className="tick mb-4">키 확인 절차</div>
          <ol className="flex flex-col gap-3">
            {[
              ["01", "크롬 주소창에 chrome://extensions 를 연다."],
              ["02", "Project NA 확장에서 “서비스 워커” 링크를 눌러 콘솔을 연다."],
              ["03", "chrome.storage.local.get('extensionKey') 를 입력해 나온 값을 복사한다."],
            ].map(([n, text]) => (
              <li key={n} className="grid grid-cols-[auto_1fr] gap-4">
                <span className="readout text-[12px] text-lum-4">{n}</span>
                <span className="text-[14.5px] leading-relaxed text-lum-1">{text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <div className="tick mb-4">키 입력</div>
          <ConnectForm />
        </section>

        {/* 전에 구글을 이어둔 사람이 새 브라우저에서 돌아오는 길. 이쪽은 기기
            키가 없어도 열린다 — 계정에 직접 닿기 때문이다. */}
        <section>
          <div className="tick mb-4">전에 구글을 이어뒀다면</div>
          <p className="mb-4 text-[14.5px] leading-relaxed text-lum-1">
            키를 몰라도 된다. 그때 쓴 구글로 들어오면 캐릭터가 그대로 있다.
          </p>
          <GoogleConnect label="구글로 들어가기" />
        </section>
      </div>
    </Shell>
  );
}
