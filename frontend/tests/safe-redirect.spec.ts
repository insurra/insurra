import { expect, test } from "@playwright/test";
import { safeRedirectPath, signInUrl } from "../src/lib/safe-redirect";

test("same-origin relative paths are kept", () => {
  for (const ok of ["/home", "/claims/abc?tab=draft", "/account/privacy#consents", "/"]) {
    expect(safeRedirectPath(ok)).toBe(ok);
  }
});

test("absolute, protocol-relative, backslash and encoded variants fall back", () => {
  for (const bad of [
    "//evil.example",
    "///evil.example",
    "https://evil.example",
    "http://evil.example/home",
    "javascript:alert(1)",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2fevil.example",
    "/%5Cevil.example",
    "home",
    "",
    "/home\nSet-Cookie: x=1",
    "/auth?redirect=/auth",
    "/auth",
    "/" + "a".repeat(600),
  ]) {
    expect(safeRedirectPath(bad)).toBe("/onboarding");
  }
  expect(safeRedirectPath(null, "/home")).toBe("/home");
  expect(safeRedirectPath(undefined)).toBe("/onboarding");
});

test("sign-in URL encodes a safe target and drops unsafe ones", () => {
  expect(signInUrl("/claims?x=1")).toBe("/auth?redirect=%2Fclaims%3Fx%3D1");
  expect(signInUrl("//evil.example")).toBe("/auth");
});
