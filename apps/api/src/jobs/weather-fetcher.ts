import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "../config.js";
import { listLocations, saveLocationWeather } from "../db/fetchers.js";
import { openDatabase } from "../db/database.js";
import type { Location, WeatherObservation } from "../types/fetchers.js";

type OpenWeatherResponse = {
  weather?: Array<{
    icon?: unknown;
    description?: unknown;
  }>;
  main?: {
    temp?: unknown;
  };
  wind?: {
    speed?: unknown;
    deg?: unknown;
  };
};

function weatherObservation(value: OpenWeatherResponse): WeatherObservation | null {
  const weather = value.weather?.[0];
  if (
    typeof weather?.description !== "string" ||
    typeof weather.icon !== "string" ||
    typeof value.main?.temp !== "number" ||
    typeof value.wind?.speed !== "number" ||
    typeof value.wind.deg !== "number"
  ) {
    return null;
  }

  return {
    description: weather.description,
    icon: weather.icon,
    temperature: value.main.temp,
    windSpeed: value.wind.speed,
    windDirection: value.wind.deg
  };
}

async function fetchWeatherForLocation(appId: string, location: Location): Promise<WeatherObservation | null> {
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", String(location.latitude));
  url.searchParams.set("lon", String(location.longitude));
  url.searchParams.set("APPID", appId);

  console.log(`Fetching weather for ${location.name}`);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      const body = await response.text();
      console.error(`Skipping weather for ${location.name} (${location.location_id}): OpenWeather returned HTTP ${response.status} - ${body.slice(0, 500)}`);
      return null;
    }

    const value = await response.json() as OpenWeatherResponse;
    const observation = weatherObservation(value);
    if (!observation) {
      console.error(`Skipping weather for ${location.name} (${location.location_id}): could not parse OpenWeather response`);
      return null;
    }

    return observation;
  } catch (error) {
    console.error(`Skipping weather for ${location.name} (${location.location_id}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  if (!config.openWeatherMapAppId) {
    console.error("OPENWEATHERMAP_APPID is not set; skipping weather fetch");
    return;
  }

  const db = openDatabase();
  try {
    for (const location of listLocations(db)) {
      const weather = await fetchWeatherForLocation(config.openWeatherMapAppId, location);
      if (weather) {
        saveLocationWeather(db, location.location_id, weather);
      }
      await delay(2_000);
    }
  } finally {
    db.close();
  }
}

await main();
