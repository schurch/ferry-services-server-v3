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
  var vesselBaseIconPromise = null;
  var rotatedVesselIconCache = {};
  var VESSEL_ICON_SIZE = 28;
  var VESSEL_ICON_RENDER_MULTIPLIER = 2;
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

  function formatTime(value) {
    var date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Europe/London"
    }).format(date);
  }

  function scheduledDepartureRoutes(service) {
    var routes = [];
    var byRoute = {};

    (service.locations || []).slice().sort(function (left, right) {
      return String(left.name).localeCompare(String(right.name));
    }).forEach(function (location) {
      (location.scheduled_departures || []).forEach(function (departure) {
        var destination = departure.destination || {};
        var key = String(location.id) + ":" + String(destination.id);
        if (!byRoute[key]) {
          byRoute[key] = {
            destinationId: destination.id,
            originName: location.name,
            destinationName: destination.name || "Destination",
            departures: []
          };
          routes.push(byRoute[key]);
        }
        byRoute[key].departures.push(departure);
      });
    });

    routes.forEach(function (route) {
      route.departures.sort(function (left, right) {
        return String(left.departure).localeCompare(String(right.departure));
      });
    });
    return routes;
  }

  function scheduledDeparturesHtml(service) {
    var routes = scheduledDepartureRoutes(service);
    if (routes.length === 0) {
      return '<p class="small muted departures-empty">No scheduled departures for this date.</p>';
    }

    return routes.map(function (route) {
      return '<article class="departures-route" data-destination-id="' + escapeHtml(route.destinationId) + '">'
        + "<h3>" + escapeHtml(route.originName) + " to " + escapeHtml(route.destinationName) + "</h3>"
        + route.departures.map(function (departure) {
          var hasDeparted = new Date(String(departure.departure)).getTime() < Date.now();
          return '<div class="departure-row' + (hasDeparted ? " departure-dim" : "") + '">'
            + "<span>" + escapeHtml(formatTime(departure.departure)) + "</span>"
            + "<span>" + escapeHtml(formatTime(departure.arrival)) + "</span>"
            + "</div>";
        }).join("")
        + "</article>";
    }).join("");
  }

  function initScheduledDepartures(section) {
    var form = section.querySelector("[data-departures-form]");
    var input = section.querySelector("[data-departures-date]");
    var list = section.querySelector("[data-departures-list]");
    var serviceId = section.getAttribute("data-service-id");
    var requestId = 0;
    if (!form || !input || !list || !serviceId) return;

    function loadDepartures() {
      var departuresDate = input.value;
      if (!departuresDate) return;
      var currentRequestId = ++requestId;
      input.disabled = true;

      fetch("/api/services/" + encodeURIComponent(serviceId) + "?departuresDate=" + encodeURIComponent(departuresDate), {
        headers: { Accept: "application/json" }
      }).then(function (response) {
        if (!response.ok) throw new Error("Could not load scheduled departures.");
        return response.json();
      }).then(function (service) {
        if (currentRequestId !== requestId) return;
        list.innerHTML = scheduledDeparturesHtml(service);
        window.history.replaceState(null, "", form.action + "?departuresDate=" + encodeURIComponent(departuresDate));
      }).catch(function () {
        if (currentRequestId !== requestId) return;
        list.innerHTML = '<p class="small muted departures-empty">Could not load scheduled departures.</p>';
      }).finally(function () {
        if (currentRequestId === requestId) input.disabled = false;
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      loadDepartures();
    });
    input.addEventListener("change", loadDepartures);
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

  function normalizeCourse(course) {
    return course == null || !Number.isFinite(course) ? 0 : ((course % 360) + 360) % 360;
  }

  function getVesselBaseIcon() {
    if (vesselBaseIconPromise) {
      return vesselBaseIconPromise;
    }

    vesselBaseIconPromise = new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error("Failed to load vessel icon."));
      };
      image.src = "/assets/ferry.png";
    });

    return vesselBaseIconPromise;
  }

  function getRotatedVesselIcon(googleMaps, course) {
    var heading = Math.round(normalizeCourse(course));
    if (rotatedVesselIconCache[heading]) {
      return Promise.resolve({
        url: rotatedVesselIconCache[heading],
        scaledSize: new googleMaps.Size(VESSEL_ICON_SIZE, VESSEL_ICON_SIZE),
        anchor: new googleMaps.Point(VESSEL_ICON_SIZE / 2, VESSEL_ICON_SIZE / 2)
      });
    }

    return getVesselBaseIcon().then(function (baseImage) {
      var targetSize = VESSEL_ICON_SIZE * VESSEL_ICON_RENDER_MULTIPLIER;
      var canvas = document.createElement("canvas");
      var context = canvas.getContext("2d");

      canvas.width = targetSize;
      canvas.height = targetSize;
      if (!context) {
        throw new Error("Could not get canvas context for vessel icon.");
      }

      context.translate(targetSize / 2, targetSize / 2);
      context.rotate((heading * Math.PI) / 180);
      var scale = Math.min(targetSize / baseImage.naturalWidth, targetSize / baseImage.naturalHeight);
      var width = baseImage.naturalWidth * scale;
      var height = baseImage.naturalHeight * scale;
      context.drawImage(baseImage, -width / 2, -height / 2, width, height);

      rotatedVesselIconCache[heading] = canvas.toDataURL("image/png");
      return {
        url: rotatedVesselIconCache[heading],
        scaledSize: new googleMaps.Size(VESSEL_ICON_SIZE, VESSEL_ICON_SIZE),
        anchor: new googleMaps.Point(VESSEL_ICON_SIZE / 2, VESSEL_ICON_SIZE / 2)
      };
    });
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

      var markerPromises = points.map(function (point) {
        var iconPromise = point.type === "vessel"
          ? getRotatedVesselIcon(googleMaps, point.course)
          : Promise.resolve(locationIcon(googleMaps));

        return iconPromise.then(function (icon) {
          var marker = new googleMaps.Marker({
            position: { lat: point.latitude, lng: point.longitude },
            map: map,
            title: point.label,
            icon: icon
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
      });

      Promise.all(markerPromises).then(function () {
        if (points.length === 1) {
          map.setCenter(bounds.getCenter());
          map.setZoom(10);
        } else if (points.length > 1) {
          map.fitBounds(bounds, 24);
        }
      });
    }).catch(function () {
      mount.innerHTML = '<div class="map-missing-key">Could not load Google Maps.</div>';
    });
  }

  Array.prototype.slice.call(document.querySelectorAll("[data-service-map]")).forEach(initServiceMap);
  Array.prototype.slice.call(document.querySelectorAll("[data-scheduled-departures]")).forEach(initScheduledDepartures);

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
