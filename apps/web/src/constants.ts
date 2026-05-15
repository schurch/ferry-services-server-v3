export const API_BASE = "/api";
export const SERVICES_CACHE = "ferry-services-web.services.v1";

type RuntimeFerryConfig = {
  googleMapsApiKey?: string;
};

declare global {
  interface Window {
    __FERRY_CONFIG__?: RuntimeFerryConfig;
    GOOGLE_MAPS_API_KEY?: string;
  }
}

const buildTimeGoogleMapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();
const runtimeGoogleMapsApiKey =
  typeof window === "undefined"
    ? undefined
    : (window.__FERRY_CONFIG__?.googleMapsApiKey ?? window.GOOGLE_MAPS_API_KEY)?.trim();

export const GOOGLE_MAPS_API_KEY = buildTimeGoogleMapsApiKey || runtimeGoogleMapsApiKey;
