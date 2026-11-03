import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The logos bucket through Storage's API, as real signed-in users: owners
 * write only to their own business's folder, everyone can read (logos are
 * public), and Storage itself enforces type and size.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

// 1×1 transparent PNG; the bucket checks type and size, not dimensions.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const png = () => new Blob([PNG], { type: "image/png" });

async function signedInClient(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, userId: data.user.id };
}

describe("logos bucket", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let ownerA: Awaited<ReturnType<typeof signedInClient>>;
  let staffA: Awaited<ReturnType<typeof signedInClient>>;
  const uploaded: string[] = [];

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    ownerA = await signedInClient("logo-owner");
    staffA = await signedInClient("logo-staff");
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerA.userId, role: "owner" },
      { businessId: a.business.id, userId: staffA.userId, role: "staff" },
    ]);
  });

  afterAll(async () => {
    if (uploaded.length) await admin.storage.from("logos").remove(uploaded);
    await a?.cleanup();
    await b?.cleanup();
    for (const user of [ownerA, staffA]) if (user) await admin.auth.admin.deleteUser(user.userId);
    await close();
  });

  it("lets an owner upload to their business's folder, and anyone read it", async () => {
    const path = `${a.business.id}/logo-test.png`;
    const { error } = await ownerA.client.storage.from("logos").upload(path, png());
    expect(error).toBeNull();
    uploaded.push(path);

    const publicUrl = ownerA.client.storage.from("logos").getPublicUrl(path).data.publicUrl;
    const response = await fetch(publicUrl);
    expect(response.status).toBe(200);
  });

  it("refuses an owner writing to another business's folder", async () => {
    const { error } = await ownerA.client.storage
      .from("logos")
      .upload(`${b.business.id}/logo-hijack.png`, png());
    expect(error).not.toBeNull();
  });

  it("refuses staff uploading a logo", async () => {
    const { error } = await staffA.client.storage
      .from("logos")
      .upload(`${a.business.id}/logo-staff.png`, png());
    expect(error).not.toBeNull();
  });

  it("refuses files outside any business folder", async () => {
    const { error } = await ownerA.client.storage.from("logos").upload("loose.png", png());
    expect(error).not.toBeNull();
  });

  it("refuses types other than images", async () => {
    const { error } = await ownerA.client.storage
      .from("logos")
      .upload(`${a.business.id}/script.html`, new Blob(["<script>"], { type: "text/html" }));
    expect(error).not.toBeNull();
  });

  it("refuses files over 2 MB", async () => {
    const big = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" });
    const { error } = await ownerA.client.storage
      .from("logos")
      .upload(`${a.business.id}/big.png`, big);
    expect(error).not.toBeNull();
  });
});
