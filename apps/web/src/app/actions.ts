"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { characters } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";

const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 12;

export type SetCharacterNameResult = { error?: string };

// Day 0 온보딩 — 사용자가 하는 유일한 행동인 "이름 짓기".
// characters.name/named_at 을 채우고 홈을 다시 그린다.
export async function setCharacterName(name: string): Promise<SetCharacterNameResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "연결이 끊겼어. 다시 연결해줘." };
  }

  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    return { error: `이름은 ${MIN_NAME_LENGTH}~${MAX_NAME_LENGTH}자로 지어줘.` };
  }

  await db
    .update(characters)
    .set({ name: trimmed, namedAt: new Date() })
    .where(eq(characters.userId, user.userId));

  revalidatePath("/");
  return {};
}
