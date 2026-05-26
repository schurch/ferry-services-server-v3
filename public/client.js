(function () {
  function applyTheme() {
    var isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }

  applyTheme();
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  }

  var googleMapsApiLoadPromise = null;
  var DARK_MAP_STYLES = [
    { elementType: "geometry", stylers: [{ color: "#1f2a37" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#1f2a37" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1b4332" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#374151" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#111827" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f172a" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#93c5fd" }] }
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatRelativeTime(value) {
    if (!value) return "Unknown time";
    var date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "Unknown time";
    var seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "Just now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min" + (minutes === 1 ? "" : "s") + " ago";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
    var days = Math.round(hours / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function isDarkTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  function loadGoogleMapsApi(apiKey) {
    if (window.google && window.google.maps) {
      return Promise.resolve();
    }
    if (googleMapsApiLoadPromise) {
      return googleMapsApiLoadPromise;
    }

    googleMapsApiLoadPromise = new Promise(function (resolve, reject) {
      var callbackName = "__initFerryGoogleMaps";

      window[callbackName] = function () {
        resolve();
        delete window[callbackName];
      };

      var script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) + "&callback=" + callbackName;
      script.async = true;
      script.defer = true;
      script.onerror = function () {
        reject(new Error("Failed to load Google Maps script."));
      };
      document.head.appendChild(script);
    });

    return googleMapsApiLoadPromise;
  }

  function vesselIcon(googleMaps, point) {
    return {
      path: googleMaps.SymbolPath.FORWARD_CLOSED_ARROW,
      fillColor: "#0b72e7",
      fillOpacity: 0.95,
      strokeColor: "#ffffff",
      strokeWeight: 1.4,
      scale: 5,
      rotation: Number.isFinite(point.course) ? point.course : 0
    };
  }

  function locationIcon(googleMaps) {
    return {
      path: googleMaps.SymbolPath.CIRCLE,
      fillColor: "#21bfaa",
      fillOpacity: 0.95,
      strokeColor: "#ffffff",
      strokeWeight: 1.4,
      scale: 7
    };
  }

  function initServiceMap(mount) {
    var apiKey = window.__FERRY_CONFIG__ && window.__FERRY_CONFIG__.googleMapsApiKey;
    if (!apiKey) return;

    var points = [];
    try {
      points = JSON.parse(mount.getAttribute("data-points") || "[]");
    } catch (_error) {
      points = [];
    }

    loadGoogleMapsApi(apiKey).then(function () {
      var googleMaps = window.google.maps;
      var center = points[0]
        ? { lat: points[0].latitude, lng: points[0].longitude }
        : { lat: 57, lng: -5 };
      var map = new googleMaps.Map(mount, {
        center: center,
        zoom: 8,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: isDarkTheme() ? DARK_MAP_STYLES : undefined
      });
      var bounds = new googleMaps.LatLngBounds();
      var infoWindow = new googleMaps.InfoWindow();

      points.forEach(function (point) {
        var marker = new googleMaps.Marker({
          position: { lat: point.latitude, lng: point.longitude },
          map: map,
          title: point.label,
          icon: point.type === "vessel" ? vesselIcon(googleMaps, point) : locationIcon(googleMaps)
        });

        bounds.extend(marker.getPosition());
        marker.addListener("click", function () {
          if (point.type === "vessel") {
            var speed = point.speed == null ? "Unknown speed" : Number(point.speed).toFixed(1) + " knots";
            infoWindow.setContent(
              '<div class="map-popup"><div class="map-popup-title">' + escapeHtml(point.label) + '</div><div class="map-popup-meta">' + escapeHtml(speed) + ' <span class="map-popup-dot">&bull;</span> ' + escapeHtml(formatRelativeTime(point.lastReceived)) + "</div></div>"
            );
          } else {
            infoWindow.setContent('<div class="map-popup"><div class="map-popup-title">' + escapeHtml(point.label) + "</div></div>");
          }
          infoWindow.open({ anchor: marker, map: map });
        });
      });

      if (points.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(10);
      } else if (points.length > 1) {
        map.fitBounds(bounds, 24);
      }
    }).catch(function () {
      mount.innerHTML = '<div class="map-missing-key">Could not load Google Maps.</div>';
    });
  }

  Array.prototype.slice.call(document.querySelectorAll("[data-service-map]")).forEach(initServiceMap);

  var search = document.querySelector("[data-service-search]");
  if (!search) return;

  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-service-row]"));
  var groups = Array.prototype.slice.call(document.querySelectorAll("[data-service-group]"));
  var empty = document.querySelector("[data-empty-search]");

  search.addEventListener("input", function () {
    var query = search.value.trim().toLowerCase();
    var visibleRows = 0;

    rows.forEach(function (row) {
      var matches = !query || String(row.getAttribute("data-search") || "").indexOf(query) !== -1;
      row.hidden = !matches;
      if (matches) visibleRows += 1;
    });

    groups.forEach(function (group) {
      var groupRows = Array.prototype.slice.call(group.querySelectorAll("[data-service-row]"));
      group.hidden = !groupRows.some(function (row) { return !row.hidden; });
    });

    if (empty) empty.hidden = visibleRows !== 0;
  });
})();
