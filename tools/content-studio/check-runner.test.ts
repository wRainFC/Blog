import { describe, expect, it } from "vitest";
import { checkCommand } from "./check-runner";

describe("check command", () => {
  it("uses cmd.exe for the Windows pnpm shim", () => {
    expect(checkCommand("win32", "C:\\Windows\\System32\\cmd.exe")).toEqual({
      executable: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd check"],
    });
  });

  it("uses pnpm directly on POSIX", () => {
    expect(checkCommand("linux")).toEqual({ executable: "pnpm", args: ["check"] });
  });
});
