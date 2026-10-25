# Claude Agent SDK · Lesson 22 · Custom tools and in-process MCP

Based on Lesson22_Custom_Tools_In_Process_MCP.pptx. Five linked student pages with large text and coloured code in every UML step.

## What you will learn

- Define the four tool parts: Give tool() a name, a useful description, a Zod input schema and an async handler. The schema types the handler arguments and validates inputs.
- Run a server in your application: createSdkMcpServer wraps the handlers in-process. The Claude Code runtime remains a child process and the model/API services are remote; in-process describes the custom MCP server.
- Register and approve the full name: mcpServers.weather supplies the namespace in mcp__weather__get_temperature. allowedTools pre-approves that name; the wildcard mcp__weather__* approves all registered weather tools.
- Call real weather services: Ask for San Francisco and Madrid. Inspect real handler arguments, HTTP status, observation times and returned content. The app uses live Open-Meteo data and never substitutes a saved forecast.
- Add optional parameters: The second tool uses hours.optional(). The handler applies args.hours ?? 12. Compare omitted hours with an explicit value of six using actual handler evidence.
- Wrap your own endpoint: A third tool calls this app’s read-only /api/course endpoint over real local HTTP. It is a classroom endpoint, so no private database or production integration is implied.

## Configure and run

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson22-app.git
cd .\Udemy-Claude-Agent-SDK-lesson22-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From presentations use `cd .\agent-sdk\lesson22-custom-tools` instead of cloning. Open http://127.0.0.1:3122 and keep the terminal running. Node.js 24+, API credit, model access and internet are required. Windows may require Git Bash. No separate MCP server is needed.

## Create your .env file

Copy .env.example only if .env does not exist. Enter your key privately and restart after edits. The startup script loads this file; existing shell values take precedence.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3122
# Optional on Windows: CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe
```

No Managed Agents IDs are required. Real .env, media, private workspaces and dependencies are excluded from Git.

## Run the experiments

### Ask about two cities

Run San Francisco and Madrid. Compare actual handler coordinates, the live temperature and observation time. Weather changes, so there is no fixed expected number.

```powershell
npm run sample:env -- temperature-sf
npm run sample:env -- temperature-madrid
```

### Compare optional hours and wildcard approval

Run omitted hours, explicit six hours and both tools. Inspect the original args and the handler’s applied default. The wildcard pre-approves both weather tools.

```powershell
npm run sample:env -- rain-default
npm run sample:env -- rain-six
npm run sample:env -- both
```

### Wrap a local API and compare permission

Leave the web server running for course-api, which calls /api/course. No pre-approval keeps tools available but denies unresolved calls in this classroom callback.

```powershell
npm run sample:env -- course-api
npm run sample:env -- no-approval
npm test
```

## How the app was built

### 1. Validate the task

Accept a listed classroom task. The browser does not choose arbitrary endpoints or define executable handlers.

Source: `src/agent.ts`, lines 48–51. Selected source; surrounding code omitted.

```typescript
return { mode: (value as RunConfig).mode };
}
export function approval(mode: Mode) {
  if (mode === "course-api") return ["mcp__course__get_lesson"];
```

### 2. Describe typed coordinates

Zod constrains latitude and longitude. Field descriptions help the model supply the intended values.

Source: `src/weather.ts`, lines 5–8. Selected source; surrounding code omitted.

```typescript
export const coordinates = {
  latitude: z.number().min(-90).max(90).describe("Latitude coordinate"),
  longitude: z.number().min(-180).max(180).describe("Longitude coordinate"),
};
```

### 3. Define name description and handler

tool() joins the unique name, model-readable description, schema and asynchronous handler. Handler arguments are inferred from the schema.

Source: `src/weather.ts`, lines 77–81. Selected source; surrounding code omitted.

```typescript
const getTemperature = tool(
    "get_temperature",
    "Get the current Open-Meteo temperature in Fahrenheit at coordinates",
    coordinates,
    async (args) => {
```

### 4. Add an optional parameter

The second tool adds an optional integer from one through twenty-four. Optional means callers may omit it; it does not insert the default.

Source: `src/weather.ts`, lines 11–16. Selected source; surrounding code omitted.

```typescript
hours: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
```

### 5. Apply the default inside the handler

Use nullish coalescing inside the handler. Inspect actual args to distinguish omission from an explicit twelve or six.

Source: `src/weather.ts`, lines 123–126. Selected source; surrounding code omitted.

```typescript
const hours = args.hours ?? 12;
      try {
        const { data, httpStatus } = await fetchForecast(
          args.latitude,
```

### 6. Wrap tools in a server

The weather server contains both tool definitions and runs in the Node host process. alwaysLoad keeps these small schemas eager for this lesson.

Source: `src/weather.ts`, lines 162–167. Selected source; surrounding code omitted.

```typescript
return createSdkMcpServer({
    name: "weather",
    version: "1.0.0",
    tools: [getTemperature, getPrecipitationChance],
    alwaysLoad: true,
  });
```

### 7. Register the server namespace

Register weather or the local course server. The registration key becomes the middle segment of the fully qualified MCP tool name.

Source: `src/agent.ts`, lines 86–91. Selected source; surrounding code omitted.

```typescript
const mcpServers: NonNullable<Options["mcpServers"]> =
    c.mode === "course-api"
      ? { course: createCourseServer(record) }
      : { weather: weatherServer };
  const options: Options = {
    model: MODEL,
```

### 8. Pre-approve the intended calls

Use the full tool name or the weather wildcard. Empty allowedTools does not remove tools; unresolved calls reach this app’s denying callback.

Source: `src/agent.ts`, lines 52–55. Selected source; surrounding code omitted.

```typescript
if (mode === "no-approval") return [];
  if (["rain-default", "rain-six", "both"].includes(mode))
    return ["mcp__weather__*"];
  return ["mcp__weather__get_temperature"];
```

### 9. Start one real SDK query

An asynchronous input generator keeps the query open for in-process MCP exchange. The SDK handles the model and tool orchestration.

Source: `src/agent.ts`, lines 152–155. Selected source; surrounding code omitted.

```typescript
const run = query({ prompt: input(), options });
  let text = "",
    status = "no_result",
    sessionId = "",
```

### 10. Observe the actual tool request

Inspect an actual assistant tool_use block. A request or answer in prose is not proof that the handler completed.

Source: `src/agent.ts`, lines 180–184. Selected source; surrounding code omitted.

```typescript
if (block.type === "tool_use") {
            attemptedTools.push(block.name);
            emit({ type: "tool", name: block.name, args: block.input });
          }
        }
```

### 11. Fetch the real forecast

The handler requests a fixed Open-Meteo endpoint with a timeout and checks HTTP status. The response schema rejects malformed service data.

Source: `src/weather.ts`, lines 44–48. Selected source; surrounding code omitted.

```typescript
const response = await fetcher(forecastUrl(latitude, longitude), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Open-Meteo HTTP " + response.status);
  return {
```

### 12. Return a tool content block

Return actual API data in the required content array. The SDK supplies this result to Claude so it can compose an answer.

Source: `src/weather.ts`, lines 102–106. Selected source; surrounding code omitted.

```typescript
return { content: [{ type: "text", text: JSON.stringify(output) }] };
      } catch {
        const output =
          "Weather service could not return a valid forecast. No cached or invented weather is substituted.";
        record({
```

### 13. Render the answer and evidence

Render and sanitize actual Markdown. Keep model text beside handler evidence, HTTP status, parameter choices and permission requests.

Source: `src/client.ts`, lines 26–28. Selected source; surrounding code omitted.

```typescript
if (e.type === "answer") renderMarkdown($("answer"), e.text);
  if (e.type === "result") {
    $("status").textContent = e.status;
```

## Reference topics and limits

- In-process is specific: The custom MCP server and handlers run in this Node application. The SDK still uses its Claude Code runtime and calls the remote model. This is not a claim that the entire agent runs in one process.
- Tool search and eager teaching schemas: Current SDK documentation describes deferred tool search by default. This small application explicitly uses alwaysLoad: true, so all configured custom schemas are immediately available. It does not demonstrate deferred tool search.
- Real weather and attribution: Open-Meteo supplies forecast and current-condition model data. Units are Fahrenheit, times are UTC, and probability windows start at the current UTC hour. Values change between runs. Open-Meteo.com attribution is included in handler results.
- API exercise boundaries: The course tool makes a real HTTP call to this app’s public classroom endpoint. The course payload is fixed teaching data. Replacing it with your own authenticated endpoint requires implementing that handler and keeping credentials on the server.
- Availability and permission: tools: [] removes built-ins while configured MCP tools remain. allowedTools pre-approves full names or wildcards. The last experiment leaves approval empty and denies unresolved requests; denial means no handler output should be claimed.
- Later lessons: The content array can carry other block types. This lesson executes text results only. Advanced annotations, richer content and structured results are introduced later; basic service errors are surfaced without invented fallbacks.

## References

- [Custom tools: official SDK documentation](https://code.claude.com/docs/en/agent-sdk/custom-tools)
- [Open-Meteo weather API](https://open-meteo.com/en/docs)
- [Open-Meteo licence and attribution](https://open-meteo.com/en/licence)

Regenerate student pages with `python scripts/build-pages.py`. `npm test` checks parameter boundaries, forecast slicing, HTTP failures and startup without paid model calls.
