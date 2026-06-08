import { describe, expect, test } from "bun:test";
import { createToken, verifyToken } from "../src/service/auth";

describe("JWT auth", () => {
  const payload = {
    sub: "user-123",
    email: "manu@lightup.com",
    name: "Manu Bansal",
    org_id: "org-abc",
    participant_id: "user:manu",
  };

  test("creates and verifies a token", async () => {
    const token = await createToken(payload);
    expect(token).toBeString();
    expect(token.split(".")).toHaveLength(3);

    const verified = await verifyToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe("user-123");
    expect(verified!.email).toBe("manu@lightup.com");
    expect(verified!.org_id).toBe("org-abc");
    expect(verified!.participant_id).toBe("user:manu");
  });

  test("rejects invalid token", async () => {
    const result = await verifyToken("not.a.token");
    expect(result).toBeNull();
  });

  test("rejects tampered token", async () => {
    const token = await createToken(payload);
    const tampered = token.slice(0, -5) + "XXXXX";
    const result = await verifyToken(tampered);
    expect(result).toBeNull();
  });
});
