import { redirect } from "next/navigation";
import { ConnectForm } from "@/components/connect-form";
import { getCurrentUser } from "@/lib/current-user";
import { Head, Shell } from "@/components/shell";

export default async function ConnectPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <Shell>
      <Head
        tick="LINK · 미연결"
        title="아직 이 브라우저가 계와 연결되지 않았다"
        note="확장이 설치돼 있으면 잠시 후 자동으로 연결된다. 안 되면 아래에 키를 직접 넣으면 된다."
      />

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
      </div>
    </Shell>
  );
}
