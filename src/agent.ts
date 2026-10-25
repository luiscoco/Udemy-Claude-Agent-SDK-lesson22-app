import {
  query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createWeatherServer, createCourseServer } from "./weather.js";
import type { Mode, RunConfig, LabEvent, HandlerCall } from "./protocol.js";
export type { RunConfig, LabEvent } from "./protocol.js";
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const MODES: Mode[] = [
  "temperature-sf",
  "temperature-madrid",
  "rain-default",
  "rain-six",
  "both",
  "course-api",
  "no-approval",
];
export const DEFAULT_CONFIG: RunConfig = { mode: "temperature-sf" };
export const PROMPTS: Record<Mode, string> = {
  "temperature-sf":
    "Call get_temperature once for San Francisco: latitude 37.7749, longitude -122.4194. Briefly report the actual current temperature in Fahrenheit, time and Open-Meteo attribution.",
  "temperature-madrid":
    "Call get_temperature once for Madrid: latitude 40.4168, longitude -3.7038. Briefly report the actual current temperature in Fahrenheit, time and Open-Meteo attribution.",
  "rain-default":
    "Call get_precipitation_chance once for Madrid (40.4168, -3.7038). Omit hours entirely so the handler applies its default. Briefly report the returned hours count and precipitation range, with Open-Meteo attribution.",
  "rain-six":
    "Call get_precipitation_chance once for Madrid (40.4168, -3.7038), explicitly setting hours to 6. Briefly report the returned hours count and precipitation range, with Open-Meteo attribution.",
  both: "Call get_temperature and get_precipitation_chance once each for Madrid (40.4168, -3.7038), setting hours to 6 for precipitation. Briefly report both actual results with Open-Meteo attribution.",
  "course-api":
    "Call the course get_lesson tool once. Briefly report its actual title, lesson number and marker. This is a local classroom HTTP endpoint, not a production course API.",
  "no-approval":
    "Attempt get_temperature once for Madrid (40.4168, -3.7038). If permission is denied, accept it without retry or bypass. Never invent weather or simulate a tool call in text.",
};
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
    throw new Error("Choose a listed custom-tool experiment.");
  return { mode: (value as RunConfig).mode };
}
export function approval(mode: Mode) {
  if (mode === "course-api") return ["mcp__course__get_lesson"];
  if (mode === "no-approval") return [];
  if (["rain-default", "rain-six", "both"].includes(mode))
    return ["mcp__weather__*"];
  return ["mcp__weather__get_temperature"];
}
export function redact(text: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  return (key ? text.split(key).join("[REDACTED]") : text)
    .replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .slice(0, 18000);
}
export async function runAgent(
  config: RunConfig,
  emit: (event: LabEvent) => void,
  controller = new AbortController(),
) {
  const c = validateConfig(config),
    root = resolve(
      realpathSync.native(tmpdir()),
      "claude-sdk22",
      randomUUID().slice(0, 12),
    );
  const cwd = resolve(root, "p"),
    home = resolve(root, "h"),
    sdkHome = resolve(root, "c");
  for (const dir of [cwd, home, sdkHome]) await mkdir(dir, { recursive: true });
  const handlerCalls: HandlerCall[] = [],
    permissionRequests: string[] = [],
    attemptedTools: string[] = [];
  const record = (call: HandlerCall) => {
    handlerCalls.push(call);
    emit({ type: "handler", call });
  };
  const weatherServer = createWeatherServer(record);
  const mcpServers: NonNullable<Options["mcpServers"]> =
    c.mode === "course-api"
      ? { course: createCourseServer(record) }
      : { weather: weatherServer };
  const options: Options = {
    model: MODEL,
    cwd,
    tools: [],
    mcpServers,
    allowedTools: approval(c.mode),
    settingSources: [],
    skills: [],
    plugins: [],
    strictMcpConfig: true,
    persistSession: false,
    permissionMode: "default",
    effort: "low",
    thinking: { type: "disabled" },
    maxTurns: 6,
    maxBudgetUsd: 0.3,
    abortController: controller,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: sdkHome,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    },
    systemPrompt:
      "Use the actual configured custom tools for this classroom task. Never invent tool results or XML calls. Do not retry errors. Keep the final answer brief. You have no built-in tools.",
    canUseTool: async (name) => {
      permissionRequests.push(name);
      return {
        behavior: "deny",
        message:
          "This classroom denies calls not pre-approved. Accept the denial and do not retry.",
      };
    },
  };
  emit({
    type: "options",
    config: c,
    options: {
      model: MODEL,
      tools: options.tools,
      allowedTools: options.allowedTools,
      mcpServers: Object.keys(mcpServers),
      permissionMode: options.permissionMode,
      alwaysLoad: true,
      cwd: "fresh private working directory",
    },
  });
  let release!: () => void;
  const gate = new Promise<void>((ok) => {
    release = ok;
  });
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: { role: "user", content: PROMPTS[c.mode] },
      parent_tool_use_id: null,
      session_id: "",
    };
    await gate;
  }
  const run = query({ prompt: input(), options });
  let text = "",
    status = "no_result",
    sessionId = "",
    costUsd = 0,
    availableTools: string[] = [];
  try {
    for await (const message of run) {
      emit({
        type: "message",
        sdkType: message.type,
        summary:
          "subtype" in message ? String(message.subtype) : "Actual SDK message",
      });
      if (message.type === "system" && message.subtype === "init") {
        availableTools = message.tools;
        sessionId = message.session_id;
        emit({
          type: "initialized",
          model: message.model,
          sessionId,
          tools: message.tools,
        });
      }
      if (message.type === "assistant")
        for (const block of message.message.content) {
          if (block.type === "text")
            emit({ type: "answer", text: redact(block.text) });
          if (block.type === "tool_use") {
            attemptedTools.push(block.name);
            emit({ type: "tool", name: block.name, args: block.input });
          }
        }
      if (message.type === "result") {
        text = redact(
          message.subtype === "success"
            ? message.result
            : message.errors.join("\n"),
        );
        status =
          message.subtype === "success" && message.is_error
            ? "error"
            : message.subtype;
        sessionId = message.session_id;
        costUsd = message.total_cost_usd;
        break;
      }
    }
  } finally {
    release();
    run.close();
  }
  emit({ type: "result", status, text, sessionId, costUsd });
  emit({
    type: "evidence",
    mode: c.mode,
    availableTools,
    handlerCalls,
    permissionRequests,
    attemptedTools,
    builtInsAbsent: availableTools.every((name) => name.startsWith("mcp__")),
    defaultHoursObserved: handlerCalls.some(
      (call) =>
        call.name === "get_precipitation_chance" &&
        !("hours" in call.args) &&
        call.effectiveHours === 12,
    ),
    explicitHoursObserved: handlerCalls.some(
      (call) =>
        call.name === "get_precipitation_chance" &&
        call.args.hours === 6 &&
        call.effectiveHours === 6,
    ),
  });
}
