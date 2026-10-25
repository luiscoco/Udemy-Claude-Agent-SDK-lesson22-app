export type Mode =
  | "temperature-sf"
  | "temperature-madrid"
  | "rain-default"
  | "rain-six"
  | "both"
  | "course-api"
  | "no-approval";
export type RunConfig = { mode: Mode };
export type HandlerCall = {
  name: string;
  args: Record<string, unknown>;
  effectiveHours?: number;
  source: string;
  ok: boolean;
  httpStatus?: number;
  output: unknown;
};
export type LabEvent =
  | { type: "options"; config: RunConfig; options: Record<string, unknown> }
  | { type: "initialized"; model: string; sessionId: string; tools: string[] }
  | { type: "message"; sdkType: string; summary: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "handler"; call: HandlerCall }
  | { type: "answer"; text: string }
  | {
      type: "result";
      status: string;
      text: string;
      sessionId: string;
      costUsd: number;
    }
  | {
      type: "evidence";
      mode: Mode;
      availableTools: string[];
      handlerCalls: HandlerCall[];
      permissionRequests: string[];
      attemptedTools: string[];
      builtInsAbsent: boolean;
      defaultHoursObserved: boolean;
      explicitHoursObserved: boolean;
    }
  | { type: "notice" | "error"; text: string };
