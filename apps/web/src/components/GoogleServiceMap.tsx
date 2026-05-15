import type React from "react";
import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import ferryPdf from "../assets/ferry.pdf";
import { GOOGLE_MAPS_API_KEY } from "../constants";
import type { GoogleMapPoint } from "../maps/points";
import { formatRelativeTime } from "../utils/date";

let googleMapsApiLoadPromise: Promise<void> | null = null;
let vesselBaseIconPromise: Promise<HTMLCanvasElement> | null = null;
const rotatedVesselIconCache = new Map<number, string>();
const VESSEL_ICON_SIZE = 40;
const VESSEL_ICON_RENDER_MULTIPLIER = 2;
const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#1f2a37" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1f2a37" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d1d5db" }]
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ca3af" }]
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1b4332" }]
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#86efac" }]
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#374151" }]
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#111827" }]
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d1d5db" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#0b72e7" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1d4ed8" }]
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#eff6ff" }]
  },
  {
    featureType: "transit",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ca3af" }]
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0f172a" }]
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#93c5fd" }]
  }
];

function resolveThemeIsDark(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.getAttribute("data-theme") === "dark";
}

GlobalWorkerOptions.workerSrc = pdfWorker;

function normalizeCourse(course: number | null | undefined): number {
  if (course == null || !Number.isFinite(course)) {
    return 0;
  }

  return ((course % 360) + 360) % 360;
}

async function getVesselBaseIconCanvas(): Promise<HTMLCanvasElement> {
  if (vesselBaseIconPromise) {
    return vesselBaseIconPromise;
  }

  vesselBaseIconPromise = (async () => {
    const loadingTask = getDocument(ferryPdf);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const firstViewport = page.getViewport({ scale: 1 });
    const targetSize = VESSEL_ICON_SIZE * VESSEL_ICON_RENDER_MULTIPLIER;
    const scale = targetSize / Math.max(firstViewport.width, firstViewport.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not get canvas context for vessel icon rendering.");
    }

    await page.render({
      canvasContext: context,
      viewport,
      background: "rgba(0, 0, 0, 0)"
    }).promise;
    await pdf.destroy();
    return canvas;
  })();

  return vesselBaseIconPromise;
}

async function getRotatedVesselIcon(googleMaps: any, course: number | null | undefined): Promise<any> {
  const heading = Math.round(normalizeCourse(course));
  const cached = rotatedVesselIconCache.get(heading);

  if (cached) {
    return {
      url: cached,
      scaledSize: new googleMaps.Size(VESSEL_ICON_SIZE, VESSEL_ICON_SIZE),
      anchor: new googleMaps.Point(VESSEL_ICON_SIZE / 2, VESSEL_ICON_SIZE / 2)
    };
  }

  const baseCanvas = await getVesselBaseIconCanvas();
  const targetSize = VESSEL_ICON_SIZE * VESSEL_ICON_RENDER_MULTIPLIER;
  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = targetSize;
  iconCanvas.height = targetSize;
  const context = iconCanvas.getContext("2d");

  if (!context) {
    throw new Error("Could not get canvas context for rotated vessel icon.");
  }

  context.translate(targetSize / 2, targetSize / 2);
  context.rotate((heading * Math.PI) / 180);
  context.drawImage(baseCanvas, -baseCanvas.width / 2, -baseCanvas.height / 2);

  const dataUrl = iconCanvas.toDataURL("image/png");
  rotatedVesselIconCache.set(heading, dataUrl);

  return {
    url: dataUrl,
    scaledSize: new googleMaps.Size(VESSEL_ICON_SIZE, VESSEL_ICON_SIZE),
    anchor: new googleMaps.Point(VESSEL_ICON_SIZE / 2, VESSEL_ICON_SIZE / 2)
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadGoogleMapsApi(apiKey: string): Promise<void> {
  if ((window as { google?: unknown }).google) {
    return Promise.resolve();
  }

  if (googleMapsApiLoadPromise) {
    return googleMapsApiLoadPromise;
  }

  googleMapsApiLoadPromise = new Promise((resolve, reject) => {
    const callbackName = "__initFerryGoogleMaps";

    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      resolve();
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps script."));
    document.head.appendChild(script);
  });

  return googleMapsApiLoadPromise;
}

export function GoogleServiceMap({
  serviceArea,
  points
}: {
  serviceArea: string;
  points: GoogleMapPoint[];
}): React.JSX.Element {
  const mapMountRef = useRef<HTMLDivElement | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => resolveThemeIsDark());

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDarkTheme(resolveThemeIsDark());
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !mapMountRef.current) {
      return;
    }

    let cancelled = false;

    void loadGoogleMapsApi(GOOGLE_MAPS_API_KEY).then(async () => {
      if (cancelled || !mapMountRef.current) return;

      const googleMaps = (window as unknown as { google: any }).google.maps;
      const center = points[0]
        ? { lat: points[0].latitude, lng: points[0].longitude }
        : { lat: 57, lng: -5 };

      const map = new googleMaps.Map(mapMountRef.current, {
        center,
        zoom: 8,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: isDarkTheme ? DARK_MAP_STYLES : undefined
      });

      const bounds = new googleMaps.LatLngBounds();
      const infoWindow = new googleMaps.InfoWindow();

      const markerPromises = points.map(async (point) => {
        const icon =
          point.type === "vessel"
            ? await getRotatedVesselIcon(googleMaps, point.course)
            : {
                path: googleMaps.SymbolPath.CIRCLE,
                fillColor: "#21bfaa",
                fillOpacity: 0.95,
                strokeColor: "#ffffff",
                strokeWeight: 1.4,
                scale: 7
              };

        if (cancelled || !mapMountRef.current) return;

        const marker = new googleMaps.Marker({
          position: { lat: point.latitude, lng: point.longitude },
          map,
          title: point.label,
          icon
        });

        bounds.extend(marker.getPosition());

        marker.addListener("click", () => {
          if (point.type === "vessel") {
            const speed = point.speed == null ? "Unknown speed" : `${point.speed.toFixed(1)} knots`;
            const lastReceived = escapeHtml(formatRelativeTime(point.lastReceived ?? null));
            infoWindow.setContent(
              `<div class="map-popup"><div class="map-popup-title">${escapeHtml(point.label)}</div><div class="map-popup-meta">${speed} <span class="map-popup-dot">•</span> ${lastReceived}</div></div>`
            );
          } else {
            infoWindow.setContent(
              `<div class="map-popup"><div class="map-popup-title">${escapeHtml(point.label)}</div></div>`
            );
          }
          infoWindow.open({ anchor: marker, map });
        });
      });
      await Promise.all(markerPromises);

      if (points.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(10);
      } else if (points.length > 1) {
        map.fitBounds(bounds, 24);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isDarkTheme, points]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="map-shell">
        <div className="map-missing-key">
          Google Maps requires an API key. Set <code>VITE_GOOGLE_MAPS_API_KEY</code> at build time or{" "}
          <code>window.__FERRY_CONFIG__.googleMapsApiKey</code> at runtime, then reload to render location and
          vessel markers for {serviceArea}.
        </div>
      </div>
    );
  }

  return (
    <div className="map-shell">
      <div className="map-mount" ref={mapMountRef} aria-label={`${serviceArea} map`} />
    </div>
  );
}
