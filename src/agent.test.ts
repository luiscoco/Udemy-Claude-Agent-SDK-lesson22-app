import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, approval } from "./agent.js";
import {
  precipitationSchema,
  upcomingHours,
  fetchForecast,
  forecastUrl,
} from "./weather.js";
test("configuration rejects unknown modes and strips unrelated browser input", () => {
  assert.throws(() => validateConfig({ mode: "shell" }));
  assert.deepEqual(
    validateConfig({ mode: "both", endpoint: "http://example.org" }),
    { mode: "both" },
  );
});
test("optional hours stays absent until the handler applies its default; invalid values reject", () => {
  const args = precipitationSchema.parse({
    latitude: 40.4168,
    longitude: -3.7038,
  });
  assert.equal("hours" in args, false);
  assert.equal(args.hours ?? 12, 12);
  for (const hours of [0, 25, 1.5])
    assert.equal(
      precipitationSchema.safeParse({ ...args, hours }).success,
      false,
    );
});
test("upcoming forecast omits past midnight rows and preserves matching times", () => {
  const rows = upcomingHours(
    {
      current: { time: "2026-10-25T10:00", temperature_2m: 55 },
      hourly: {
        time: ["2026-10-25T00:00", "2026-10-25T10:00", "2026-10-25T11:00"],
        precipitation_probability: [10, 20, 30],
      },
    },
    2,
    new Date("2026-10-25T10:45:00Z"),
  );
  assert.deepEqual(
    rows.map((r) => r.probabilityPercent),
    [20, 30],
  );
});
test("weather URL has a fixed origin, Fahrenheit and UTC; non-200 never becomes weather", async () => {
  const url = forecastUrl(40.4168, -3.7038);
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("temperature_unit"), "fahrenheit");
  await assert.rejects(
    fetchForecast(
      1,
      2,
      (async () =>
        new Response("Unavailable", { status: 503 })) as typeof fetch,
    ),
    /503/,
  );
});
test("full names, wildcard and no-approval mode target distinct permission choices", () => {
  assert.deepEqual(approval("temperature-sf"), [
    "mcp__weather__get_temperature",
  ]);
  assert.deepEqual(approval("both"), ["mcp__weather__*"]);
  assert.deepEqual(approval("no-approval"), []);
});
