import { getCurrentUser, getGoogleUser } from "@/lib/current-user";
import { DeviceClaim } from "@/components/device-claim";
import { GoogleConnect } from "@/components/google-connect";
import { Head, Shell } from "@/components/shell";

// **/connect 가 아니라 여기인 이유가 있다.**
//
// 확장의 connect-content.js 는 /connect 에 주입돼 키로 쿠키를 다시 심고 홈으로
// 보낸다. 즉 확장이 깔린 사람은 /connect 에 머무를 수가 없다 — 연결이 필요한
// 바로 그 사람이 이 안내를 못 본다는 뜻이다. 그 스크립트는 pathname 을 보고
// 갈라지므로, 한 칸 아래인 이 경로는 튕기지 않는다.
//
// 신원이 없어도 돌려보내지 않는다. 새로 깐 기기가 도착하는 곳이 정확히 여기라,
// 여기서 쫓아내면 그 사람은 로그인할 자리를 못 찾는다.
export default async function ConnectGooglePage() {
  // 구글 세션이 먼저다. 기기를 붙이는 조작의 주체는 계정이어야 한다.
  const me = await getGoogleUser();

  if (me) {
    return (
      <Shell>
        <Head
          tick="LINK · 연결됨"
          title="이 캐릭터는 구글 계정에 이어져 있다"
          note="브라우저를 지우거나 새 기기로 옮겨도, 같은 구글로 들어오면 이 캐릭터를 다시 만난다."
        />
        <section>
          <div className="tick mb-4">이 기기</div>
          <DeviceClaim />
        </section>
      </Shell>
    );
  }

  // 구글 세션은 없다. 이 브라우저의 기기 키로는 누구인가.
  const user = await getCurrentUser();

  if (user?.linked) {
    return (
      <Shell>
        <Head
          tick="LINK · 로그인 필요"
          title="이 캐릭터에는 이미 구글이 이어져 있다"
          note="이 브라우저에는 로그인이 안 돼 있을 뿐이다. 들어오면 기기를 붙일 수 있다."
        />
        <section>
          <div className="tick mb-4">로그인</div>
          <GoogleConnect label="구글로 들어가기" next="/connect/google" />
        </section>
      </Shell>
    );
  }

  if (user) {
    return (
      <Shell>
        <Head
          tick="LINK · 미연결"
          title="지금은 이 브라우저가 곧 신원이다"
          note="브라우저를 지우면 캐릭터도 함께 사라진다. 구글 계정을 이어두면 그때도 되찾을 수 있다."
        />

        <div className="flex flex-col gap-12">
          <section>
            <div className="tick mb-4">무엇이 달라지나</div>
            <ol className="flex flex-col gap-3">
              {[
                ["01", "지금 키우던 캐릭터가 그대로 이어진다. 새로 시작하지 않는다."],
                ["02", "브라우저를 지워도, 같은 구글로 들어오면 다시 만난다."],
                ["03", "쌓인 것은 하나도 움직이지 않는다 — 문을 하나 더 다는 것에 가깝다."],
              ].map(([n, text]) => (
                <li key={n} className="grid grid-cols-[auto_1fr] gap-4">
                  <span className="readout text-[12px] text-lum-4">{n}</span>
                  <span className="text-[14.5px] leading-relaxed text-lum-1">{text}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <div className="tick mb-4">계정 연결</div>
            <GoogleConnect label="구글로 연결하기" next="/connect/google" />
          </section>
        </div>
      </Shell>
    );
  }

  // 아무 신원도 없다 — 새로 깐 기기가 아직 쿠키를 못 받은 상태다.
  // 전에 구글을 이어뒀다면 여기서 들어와 기기를 붙이면 된다.
  return (
    <Shell>
      <Head
        tick="LINK · 미확인"
        title="이 브라우저가 누구인지 아직 모른다"
        note="전에 구글을 이어뒀다면 들어와서 이 기기를 붙이면 된다. 처음이라면 확장을 먼저 설치한다."
      />
      <section>
        <div className="tick mb-4">로그인</div>
        <GoogleConnect label="구글로 들어가기" next="/connect/google" />
      </section>
    </Shell>
  );
}
