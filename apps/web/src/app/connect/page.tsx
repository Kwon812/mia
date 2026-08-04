import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, MonoLabel } from "@/components/card";
import { ConnectForm } from "@/components/connect-form";
import { getCurrentUser } from "@/lib/current-user";

export default async function ConnectPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div>
      <PageHeader
        kicker="CONNECT"
        title="아직 연결되지 않았어"
        desc="확장이 발급한 키를 붙여넣으면 이 브라우저에서도 캐릭터를 볼 수 있어."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <MonoLabel>키 확인하는 방법</MonoLabel>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-sub">
            <li>
              크롬 주소창에{" "}
              <code className="font-mono text-[12.5px] text-ink">
                chrome://extensions
              </code>
              를 입력해 확장 관리 페이지를 연다.
            </li>
            <li>Project NA 확장에서 “서비스 워커” 링크를 눌러 콘솔을 연다.</li>
            <li>
              콘솔에{" "}
              <code className="font-mono text-[12.5px] text-ink">
                chrome.storage.local.get(&apos;extensionKey&apos;)
              </code>
              를 입력해 나온 값을 복사한다.
            </li>
          </ol>
        </Card>

        <Card>
          <MonoLabel>키 입력</MonoLabel>
          <ConnectForm />
        </Card>
      </div>
    </div>
  );
}
