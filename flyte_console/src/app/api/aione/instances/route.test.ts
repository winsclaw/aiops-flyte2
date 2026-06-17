import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("aione external instance route", () => {
  it("rejects requests without an external API key", async () => {
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instances", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "unauthorized" });
  });
});
