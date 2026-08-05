// 캐릭터의 말. 사이트에서 세리프체를 쓰는 유일한 곳 —
// "말하는 존재만 서체가 다르면 UI 가 아니라 누구가 된다" (계획서 09장)
export function Dialogue({
  text,
  size = "lg",
}: {
  text: string;
  size?: "lg" | "sm";
}) {
  return (
    <p
      className={
        size === "lg"
          ? "text-balance font-serif text-[20px] leading-[1.72] text-ink"
          : "font-serif text-[15.5px] leading-[1.68] text-ink"
      }
    >
      {text}
    </p>
  );
}
