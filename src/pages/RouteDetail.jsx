import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import polyline from "@mapbox/polyline";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  GoogleMap,
  useJsApiLoader,
  OverlayView,
  Polyline,
  InfoWindow,
} from "@react-google-maps/api";

// ---------- constants ----------
const STALE_MS = 15 * 60 * 1000; // ignore buses with no update in 15 min
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // localStorage cache for route shape (stops/polyline)
const CHALO_CITY = "palakkad";
const GOOGLE_MAPS_API_KEY = "AIzaSyBwFTs8_ByftQEytonOPdVpdV9N0uyi3h4";

// stable module-level ref, required by useJsApiLoader (same id as Map.jsx so
// the script tag is only injected once across the whole app)
const MAP_LIBRARIES = [];

const polylineOptions = { strokeColor: "blue", strokeWeight: 4 };

// ---------- pure helpers (ported from utils.py) ----------

// remove_duplicates: keep only the latest ("tS") entry per vehicle number
function dedupeBuses(routeLiveInfo) {
  const latest = new Map();
  for (const raw of Object.values(routeLiveInfo || {})) {
    if (!raw) continue;
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
    const vNo = entry.vNo;
    const ts = entry.tS || 0;
    const prev = latest.get(vNo);
    if (!prev || ts > (prev.tS || 0)) latest.set(vNo, entry);
  }
  return [...latest.values()];
}

// group live buses by stop id, drop stale ones, build the display message
function busesByStop(liveEntries, stopNameById) {
  const now = Date.now();
  const byStop = {};
  for (const bus of liveEntries) {
    if (now - bus.tS > STALE_MS) continue;
    const stopName = stopNameById.get(bus.psId) || "";
    const secondsAgo = Math.floor((now - bus.psTime) / 1000);
    (byStop[bus.psId] ||= []).push({
      vNo: bus.vNo,
      message: `Left ${stopName} ${secondsAgo} seconds ago`,
      lat: bus._latitude,
      lng: bus._longitude,
    });
  }
  return byStop;
}

// ---------- localStorage cache for route shape (skip-persistence replacement) ----------
function readRouteCache(routeId) {
  try {
    const raw = localStorage.getItem(`route:${routeId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeRouteCache(routeId, data) {
  try {
    localStorage.setItem(
      `route:${routeId}`,
      JSON.stringify({ ...data, cachedAt: Date.now() })
    );
  } catch {
    // ignore quota errors
  }
}

// ---------- Chalo API calls (direct from browser, CORS already open) ----------
function fetchRouteDetails(routeId) {
  const days = [
    "sunday", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday",
  ];
  const day = days[new Date().getDay()];
  return axios
    .get("https://chalo.com/app/api/scheduler_v4/v4/palakkad/routedetailslive", {
      params: { route_id: routeId, day },
    })
    .then((res) => res.data);
}

function fetchRouteLive(routeId, firstStopId) {
  return axios
    .get(
      `https://chalo.com/app/api/vasudha/track/route-live-info/${CHALO_CITY}/${routeId}`,
      { params: { stopIds: firstStopId } }
    )
    .then((res) => res.data);
}

// ---------- custom map pins (replace Leaflet divIcon markup) ----------
function StopPin({ stop, isSelected, onSelect, onClose }) {
  return (
    <>
      <OverlayView
        position={{ lat: stop.lat, lng: stop.lng }}
        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
        getPixelPositionOffset={() => ({ x: -9, y: -9 })}
      >
        <div
          onClick={() => onSelect(`stop-${stop.stopId}`)}
          style={{
            background: "maroon",
            borderRadius: "50% 50% 50% 0",
            width: 18,
            height: 18,
            transform: "rotate(-45deg)",
            border: "3px solid #fff",
            boxShadow: "0 2px 6px rgba(0,0,0,.35)",
            cursor: "pointer",
          }}
        />
      </OverlayView>
      {isSelected && (
        <InfoWindow position={{ lat: stop.lat, lng: stop.lng }} onCloseClick={onClose}>
          <span>{stop.name}</span>
        </InfoWindow>
      )}
    </>
  );
}

function BusPin({ bus, isSelected, onSelect, onClose }) {
  return (
    <>
      <OverlayView
        position={{ lat: bus.lat, lng: bus.lng }}
        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
        getPixelPositionOffset={() => ({ x: -18, y: -18 })}
      >
        <div
          onClick={() => onSelect(`bus-${bus.vNo}`)}
          style={{
            background: "#1a73e8",
            borderRadius: "50%",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "3px solid #fff",
            boxShadow: "0 2px 6px rgba(0,0,0,.35)",
            cursor: "pointer",
          }}
        >
          <i className="ti ti-bus" style={{ color: "#fff", fontSize: 18 }} />
        </div>
      </OverlayView>
      {isSelected && (
        <InfoWindow position={{ lat: bus.lat, lng: bus.lng }} onCloseClick={onClose}>
          <div>
            <strong>{bus.vNo}</strong>
            <p style={{ margin: 0 }}>{bus.message}</p>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

// ---------- component ----------
export default function RouteDetail() {
  const { routeId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const targetBus = searchParams.get("bus") || "";

  const [routeMeta, setRouteMeta] = useState(null); // name, via, category, polyline, stop list (static shape)
  const [stops, setStops] = useState([]); // stops with live bus arrays merged in
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);

  const busCardRefs = { current: {} };

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: MAP_LIBRARIES,
  });

  const routeCoords = useMemo(() => {
    if (!routeMeta?.polyline) return [];
    return polyline.decode(routeMeta.polyline).map(([lat, lng]) => ({ lat, lng }));
  }, [routeMeta]);

  // Step 1: get the static route shape (stops, polyline, names) — from cache or Chalo
  const loadRouteShape = useCallback(async () => {
    const cached = readRouteCache(routeId);
    if (cached) return cached;

    const data = await fetchRouteDetails(routeId);
    const r = data.route;
    const shape = {
      routeName: r.route_name,
      subCategory: r.subCategory,
      serviceCategory: r.serviceCategory,
      via: r.via,
      polyline: r.polyline,
      firstStopId: r.first_stop?.stop_id,
      stopList: (r.stopSequenceWithDetails || []).map((s, idx) => ({
        stopId: s.stop_id,
        name: s.stop_name,
        order: idx,
        lat: s.stop_lat,
        lng: s.stop_lon,
      })),
    };
    writeRouteCache(routeId, shape);
    return shape;
  }, [routeId]);

  // Step 2: pull live bus positions and merge onto the static shape
  const refreshLive = useCallback(
    async (shape) => {
      setRefreshing(true);
      setError(null);
      try {
        const live = await fetchRouteLive(routeId, shape.firstStopId);
        const liveEntries = dedupeBuses(live.routeLiveInfo);
        const nameById = new Map(shape.stopList.map((s) => [s.stopId, s.name]));
        const grouped = busesByStop(liveEntries, nameById);

        setStops(
          shape.stopList.map((s) => ({
            ...s,
            buses: grouped[s.stopId] || [],
          }))
        );
      } catch (e) {
        setError("Couldn't load live status. Try again.");
      } finally {
        setRefreshing(false);
      }
    },
    [routeId]
  );

  useEffect(() => {
    let cancelled = false;
    loadRouteShape().then((shape) => {
      if (cancelled) return;
      setRouteMeta(shape);
      refreshLive(shape);
    });
    return () => {
      cancelled = true;
    };
  }, [loadRouteShape, refreshLive]);

  // scroll to a specific bus if ?bus=... was passed, once stops are rendered
  useEffect(() => {
    if (targetBus && busCardRefs.current[targetBus]) {
      busCardRefs.current[targetBus].scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [stops, targetBus]);

  const onMapLoad = useCallback(
    (map) => {
      if (!routeCoords.length) return;
      const bounds = new window.google.maps.LatLngBounds();
      routeCoords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds);
    },
    [routeCoords]
  );

  if (!routeMeta) {
    return <div className="p-4 text-center text-secondary">Loading route…</div>;
  }

  const totalBuses = stops.reduce((n, s) => n + s.buses.length, 0);

  return (
    <div
      className="bg-light py-3 px-3 d-flex justify-content-center"
      style={{ minHeight: "100vh" }}
    >
      <div
        className="card border rounded-4 overflow-hidden w-100"
        style={{ maxWidth: 460 }}
      >
        {/* Header */}
        <div className="card-header bg-white border-bottom px-4 py-3">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span
              className="badge rounded-pill d-flex align-items-center gap-1 px-3 py-2"
              style={{
                background: "#EAF5EC",
                border: "1px solid #A8D8B0",
                color: "#2E7D44",
                fontSize: 11,
                width: "fit-content",
              }}
            >
              <span
                className="live-dot rounded-circle d-inline-block"
                style={{ width: 6, height: 6, background: "#2E7D44" }}
              />
              Live
            </span>
            <div className="d-flex gap-1">
              <button
                className="icon-btn"
                aria-label="Go back"
                title="Back"
                onClick={() => navigate(-1)}
              >
                <i className="ti ti-arrow-left" />
              </button>
              <button
                className="icon-btn"
                aria-label="View map"
                title="Map"
                onClick={() => setMapOpen(true)}
              >
                <i className="ti ti-map-2" />
              </button>
              <button
                className={`icon-btn${refreshing ? " spinning" : ""}`}
                aria-label="Refresh"
                title="Refresh"
                disabled={refreshing}
                onClick={() => refreshLive(routeMeta)}
              >
                <i className="ti ti-refresh" />
              </button>
            </div>
          </div>
          <p
            className="text-primary fw-semibold mb-1"
            style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase" }}
          >
            KSRTC · {routeMeta.subCategory} {routeMeta.serviceCategory}
          </p>
          <p className="fw-bold mb-0 fs-5">{routeMeta.routeName}</p>
          <p className="text-secondary mb-0 small" style={{ overflowWrap: "anywhere" }}>
            Via: {routeMeta.via}
          </p>
        </div>

        {/* Route */}
        <div className="route-area px-4 py-2">
          {error && <div className="text-danger small py-2">{error}</div>}
          {!error &&
            stops.map((stop, idx) => {
              const isTerminal = idx === 0 || idx === stops.length - 1;
              return (
                <div key={stop.stopId} className="route-row d-flex align-items-start">
                  <div className="spine-col d-flex justify-content-center">
                    <div className={`stop-dot${isTerminal ? " terminal" : ""}`} />
                  </div>
                  <div className="flex-grow-1 ps-3 min-w-0">
                    <div className="d-flex align-items-baseline justify-content-between gap-2 py-2">
                      <span className="fw-semibold" style={{ fontSize: 15 }}>
                        {stop.name}
                      </span>
                      <span className="text-secondary text-nowrap" style={{ fontSize: 11 }}>
                        {stop.order}
                      </span>
                    </div>
                    {stop.buses.map((bus) => (
                      <div
                        key={bus.vNo}
                        ref={(el) => (busCardRefs.current[bus.vNo] = el)}
                        className="rounded-3 p-2 mb-2 border bus-card"
                      >
                        <span className="fw-semibold small text-dark">
                          <i className="ti ti-bus text-primary me-1" />
                          {bus.vNo}
                        </span>
                        <p className="small mb-0 mt-1" style={{ color: "#1C5E8A" }}>
                          {bus.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="card-footer bg-white border-top px-4 py-3 d-flex align-items-center justify-content-between">
          <div>
            <p className="text-secondary mb-0" style={{ fontSize: 11 }}>
              Buses on route
            </p>
            <p className="fw-semibold mb-0 small">
              {totalBuses} bus{totalBuses !== 1 ? "es" : ""} tracked
            </p>
          </div>
        </div>
      </div>

      {/* Map modal (Bootstrap modal markup, driven by React state instead of jQuery) */}
      {mapOpen && (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          style={{ background: "rgba(0,0,0,.5)" }}
        >
          <div className="modal-dialog modal-xl modal-fullscreen-sm-down">
            <div className="modal-content">
              <div
                className="modal-header"
                style={{ position: "sticky", top: 0, zIndex: 1056, background: "#fff" }}
              >
                <h5 className="modal-title">Route Map with Bus stops</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMapOpen(false)}
                />
              </div>
              <div className="modal-body p-0">
                {isLoaded ? (
                  <GoogleMap
                    mapContainerStyle={{ height: "calc(100dvh - 56px)", width: "100%" }}
                    onLoad={onMapLoad}
                    options={{ gestureHandling: "greedy" }}
                  >
                    <Polyline path={routeCoords} options={polylineOptions} />

                    {stops.map((stop) => (
                      <StopPin
                        key={stop.stopId}
                        stop={stop}
                        isSelected={selectedPin === `stop-${stop.stopId}`}
                        onSelect={setSelectedPin}
                        onClose={() => setSelectedPin(null)}
                      />
                    ))}

                    {stops.flatMap((stop) =>
                      stop.buses.map((bus) => (
                        <BusPin
                          key={bus.vNo}
                          bus={bus}
                          isSelected={selectedPin === `bus-${bus.vNo}`}
                          onSelect={setSelectedPin}
                          onClose={() => setSelectedPin(null)}
                        />
                      ))
                    )}
                  </GoogleMap>
                ) : (
                  <div
                    style={{ height: "calc(100dvh - 56px)" }}
                    className="d-flex align-items-center justify-content-center text-secondary"
                  >
                    Loading map…
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}