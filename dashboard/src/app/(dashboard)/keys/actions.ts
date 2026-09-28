"use server";

import { revalidatePath } from "next/cache";
import { admin } from "@/lib/admin";
import { AdminApiError } from "@/lib/admin-client";

export type CreateKeyState =
  | { status: "idle" }
  | { status: "created"; name: string; key: string }
  | { status: "error"; message: string };

// The plaintext key only ever travels in this action's return value, straight to the form that
// shows it once — never a URL, cookie, or log.
export async function createKey(
  _state: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const tenant = formData.get("tenant");
  const name = formData.get("name");
  if (typeof tenant !== "string" || typeof name !== "string" || name.trim() === "") {
    return { status: "error", message: "Give the key a name." };
  }
  try {
    const created = await (await admin()).createKey(tenant, name.trim());
    revalidatePath("/keys");
    return { status: "created", name: created.name, key: created.key };
  } catch (error) {
    if (error instanceof AdminApiError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function revokeKey(formData: FormData): Promise<void> {
  const keyId = formData.get("keyId");
  if (typeof keyId !== "string") return;
  await (await admin()).revokeKey(keyId);
  revalidatePath("/keys");
}
