import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";

export interface PromptCountdownHandle {
  getSecondsRemaining(): number | null;
  dispose(): void;
}

export interface TimedSelectResult {
  selection: string | undefined;
  timedOut: boolean;
}

export function formatCountdown(secondsRemaining: number): string {
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTimeoutDuration(seconds: number): string {
  const units: Array<[label: string, value: number]> = [
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  let remaining = seconds;
  const parts: string[] = [];

  for (const [label, value] of units) {
    if (remaining < value) continue;
    const count = Math.floor(remaining / value);
    remaining %= value;
    parts.push(`${count} ${label}${count === 1 ? "" : "s"}`);
  }

  return parts.join(" ");
}

export function buildPromptTimeoutReason(
  timeoutSeconds: number,
  subject: string,
): string {
  return (
    `Permission request timed out after ${formatTimeoutDuration(timeoutSeconds)}. ` +
    `Assuming the user is away, no explicit permission was given for this ${subject}.`
  );
}

export function createPromptCountdown(
  timeoutSeconds: number | null,
  tui: { requestRender(): void },
  onTimeout: () => void,
): PromptCountdownHandle {
  if (timeoutSeconds === null) {
    return {
      getSecondsRemaining: () => null,
      dispose: () => {},
    };
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let lastRenderedSeconds = Math.max(
    0,
    Math.ceil((deadline - Date.now()) / 1000),
  );

  const getSecondsRemaining = () =>
    Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

  const dispose = () => {
    disposed = true;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  intervalId = setInterval(() => {
    if (disposed) return;

    const secondsRemaining = getSecondsRemaining();
    if (secondsRemaining !== lastRenderedSeconds) {
      lastRenderedSeconds = secondsRemaining;
      tui.requestRender();
    }

    if (secondsRemaining === 0) {
      dispose();
      onTimeout();
    }
  }, 250);

  return { getSecondsRemaining, dispose };
}

export async function selectWithOptionalTimeout(
  ui: ExtensionUIContext,
  title: string,
  options: string[],
  timeoutSeconds: number | null,
): Promise<TimedSelectResult> {
  if (timeoutSeconds === null) {
    return {
      selection: await ui.select(title, options),
      timedOut: false,
    };
  }

  const controller = new AbortController();
  const timeout = timeoutSeconds * 1000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const selection = await ui.select(title, options, {
      timeout,
      signal: controller.signal,
    });
    return {
      selection,
      timedOut: controller.signal.aborted && selection === undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}
