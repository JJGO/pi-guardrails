import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { createEventBus } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventContext } from "../../tests/utils/pi-context";
import { buildPromptTimeoutReason } from "../utils/prompt-timeout";
import { setupPathAccessHook } from "./path-access";

const resolvedConfig = {
  version: "1",
  enabled: true,
  applyBuiltinDefaults: true,
  features: { policies: false, permissionGate: false, pathAccess: true },
  policies: { rules: [] },
  pathAccess: { mode: "ask", allowedPaths: [] },
  prompts: { timeoutSeconds: 300 as number | null },
  permissionGate: {
    patterns: [],
    useBuiltinMatchers: true,
    requireConfirmation: true,
    allowedPatterns: [],
    autoDenyPatterns: [],
    explainCommands: false,
    explainModel: null,
    explainTimeout: 5000,
  },
};

vi.mock("../config", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    configLoader: {
      getConfig: vi.fn(() => resolvedConfig),
      getRawConfig: vi.fn(() => ({})),
      save: vi.fn(async () => {}),
    },
  };
});

type ToolCallHandler = (
  event: {
    type: "tool_call";
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
  ctx: ExtensionContext,
) => Promise<{ block: true; reason: string } | undefined>;

function createMockPi() {
  const handlers: ToolCallHandler[] = [];
  const eventBus = createEventBus();

  const pi = {
    on(event: string, handler: ToolCallHandler) {
      if (event === "tool_call") {
        handlers.push(handler);
      }
    },
    events: eventBus,
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    emit: vi.fn(),
  } as unknown as ExtensionAPI;

  return {
    pi,
    getHandler(): ToolCallHandler {
      if (handlers.length === 0) {
        throw new Error("No tool_call handler registered");
      }
      return handlers[0];
    },
  };
}

function toolEvent(toolName: string, input: Record<string, unknown>) {
  return {
    type: "tool_call" as const,
    toolCallId: "tc_test",
    toolName,
    input,
  };
}

const TEST_THEME = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function createInteractiveCustomStub<T>(): ExtensionContext["ui"]["custom"] {
  return vi.fn(
    async (
      factory: (
        tui: { terminal: { columns: number }; requestRender(): void },
        theme: typeof TEST_THEME,
        kb: unknown,
        done: (result: T) => void,
      ) => unknown,
    ) =>
      new Promise<T>((resolve) => {
        factory(
          {
            terminal: { columns: 120 },
            requestRender: vi.fn(),
          },
          TEST_THEME,
          {},
          resolve,
        );
      }),
  ) as ExtensionContext["ui"]["custom"];
}

describe("path access hook", () => {
  let handler: ToolCallHandler;

  beforeEach(() => {
    resolvedConfig.prompts.timeoutSeconds = 300;
    resolvedConfig.pathAccess.mode = "ask";
    resolvedConfig.pathAccess.allowedPaths = [];

    const { pi, getHandler } = createMockPi();
    setupPathAccessHook(pi);
    handler = getHandler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks outside-workspace access when the prompt times out", async () => {
    vi.useFakeTimers();
    const ctx = createEventContext({
      cwd: "/repo",
      hasUI: true,
      ui: {
        custom: createInteractiveCustomStub(),
      },
    });

    const pending = handler(toolEvent("read", { path: "/tmp/secret.txt" }), ctx);
    await vi.advanceTimersByTimeAsync(300_000);

    await expect(pending).resolves.toEqual({
      block: true,
      reason: buildPromptTimeoutReason(300, "outside-workspace access"),
    });
  });

  it("passes the shared prompt timeout to the select fallback", async () => {
    const ctx = createEventContext({
      cwd: "/repo",
      hasUI: true,
      ui: {
        custom: vi.fn(
          async () => undefined,
        ) as ExtensionContext["ui"]["custom"],
        select: vi.fn(
          async () => "Allow once",
        ) as ExtensionContext["ui"]["select"],
      },
    });

    const result = await handler(toolEvent("read", { path: "/tmp/secret.txt" }), ctx);

    expect(result).toBeUndefined();
    expect(ctx.ui.select).toHaveBeenCalledWith(
      "Outside workspace access: /tmp/secret.txt",
      [
        "Allow once",
        "Allow file this session",
        "Allow file always",
        "Allow directory this session",
        "Allow directory always",
        "Deny",
      ],
      expect.objectContaining({ timeout: 300_000, signal: expect.any(AbortSignal) }),
    );
  });
});
