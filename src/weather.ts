import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { HandlerCall } from "./protocol.js";

export const coordinates = {
  latitude: z.number().min(-90).max(90).describe("Latitude coordinate"),
  longitude: z.number().min(-180).max(180).describe("Longitude coordinate"),
};
export const precipitationSchema = z.object({
  ...coordinates,
  hours: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
    .describe("Forecast hours; omit to use 12"),
});
const forecastSchema = z.object({
  current: z.object({ time: z.string(), temperature_2m: z.number() }),
  hourly: z.object({
    time: z.array(z.string()),
    precipitation_probability: z.array(z.number().min(0).max(100)),
  }),
});
export function forecastUrl(latitude: number, longitude: number) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m",
    temperature_unit: "fahrenheit",
    hourly: "precipitation_probability",
    forecast_days: "2",
    timezone: "GMT",
  }).toString();
  return url;
}
export async function fetchForecast(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(forecastUrl(latitude, longitude), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Open-Meteo HTTP " + response.status);
  return {
    data: forecastSchema.parse(await response.json()),
    httpStatus: response.status,
  };
}
export function upcomingHours(
  data: z.infer<typeof forecastSchema>,
  hours: number,
  now = new Date(),
) {
  const start = now.toISOString().slice(0, 13) + ":00";
  const rows = data.hourly.time
    .map((time, i) => ({
      timeUTC: time,
      probabilityPercent: data.hourly.precipitation_probability[i],
    }))
    .filter((row) => row.timeUTC >= start)
    .slice(0, hours);
  if (
    rows.length !== hours ||
    rows.some((row) => row.probabilityPercent === undefined)
  )
    throw new Error("Incomplete hourly forecast");
  return rows;
}
export function createWeatherServer(
  record: (call: HandlerCall) => void,
  fetcher: typeof fetch = fetch,
) {
  const getTemperature = tool(
    "get_temperature",
    "Get the current Open-Meteo temperature in Fahrenheit at coordinates",
    coordinates,
    async (args) => {
      try {
        const { data, httpStatus } = await fetchForecast(
          args.latitude,
          args.longitude,
          fetcher,
        );
        const output = {
          temperatureF: data.current.temperature_2m,
          observedAtUTC: data.current.time,
          attribution: "Open-Meteo.com",
          fetchedAt: new Date().toISOString(),
        };
        record({
          name: "get_temperature",
          args,
          source: "https://api.open-meteo.com/v1/forecast",
          httpStatus,
          ok: true,
          output,
        });
        return { content: [{ type: "text", text: JSON.stringify(output) }] };
      } catch {
        const output =
          "Weather service could not return a valid forecast. No cached or invented weather is substituted.";
        record({
          name: "get_temperature",
          args,
          source: "Open-Meteo",
          ok: false,
          output,
        });
        return { isError: true, content: [{ type: "text", text: output }] };
      }
    },
    { alwaysLoad: true },
  );
  const getPrecipitationChance = tool(
    "get_precipitation_chance",
    "Get hourly precipitation probabilities starting at the current UTC hour",
    precipitationSchema.shape,
    async (args) => {
      const hours = args.hours ?? 12;
      try {
        const { data, httpStatus } = await fetchForecast(
          args.latitude,
          args.longitude,
          fetcher,
        );
        const output = {
          hours,
          forecast: upcomingHours(data, hours),
          attribution: "Open-Meteo.com",
          fetchedAt: new Date().toISOString(),
        };
        record({
          name: "get_precipitation_chance",
          args,
          effectiveHours: hours,
          source: "https://api.open-meteo.com/v1/forecast",
          httpStatus,
          ok: true,
          output,
        });
        return { content: [{ type: "text", text: JSON.stringify(output) }] };
      } catch {
        const output =
          "Weather service could not return a valid hourly forecast. No saved forecast is substituted.";
        record({
          name: "get_precipitation_chance",
          args,
          effectiveHours: hours,
          source: "Open-Meteo",
          ok: false,
          output,
        });
        return { isError: true, content: [{ type: "text", text: output }] };
      }
    },
    { alwaysLoad: true },
  );
  return createSdkMcpServer({
    name: "weather",
    version: "1.0.0",
    tools: [getTemperature, getPrecipitationChance],
    alwaysLoad: true,
  });
}

export function createCourseServer(record: (call: HandlerCall) => void) {
  const getCourse = tool(
    "get_lesson",
    "Read the public classroom course endpoint for Lesson 22",
    {},
    async () => {
      const source = `http://127.0.0.1:${process.env.PORT || 3122}/api/course`;
      try {
        const response = await fetch(source, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("Course endpoint unavailable");
        const output = z
          .object({
            lesson: z.literal(22),
            title: z.string(),
            marker: z.literal("COURSE-API-22"),
          })
          .parse(await response.json());
        record({
          name: "get_lesson",
          args: {},
          source,
          httpStatus: response.status,
          ok: true,
          output,
        });
        return { content: [{ type: "text", text: JSON.stringify(output) }] };
      } catch {
        const output =
          "Start this application's web server before running the course endpoint exercise.";
        record({ name: "get_lesson", args: {}, source, ok: false, output });
        return { isError: true, content: [{ type: "text", text: output }] };
      }
    },
    { alwaysLoad: true },
  );
  return createSdkMcpServer({
    name: "course",
    version: "1.0.0",
    tools: [getCourse],
    alwaysLoad: true,
  });
}
