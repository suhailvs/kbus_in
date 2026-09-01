import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day — tune to how "live" you need this

function cacheKey(routeId, day) {
  return `routeDetails:${routeId}:${day}`;
}

function readCache(routeId, day) {
  try {
    const raw = localStorage.getItem(cacheKey(routeId, day));
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL_MS) return null; // stale
    return data;
  } catch {
    return null; // corrupted entry, ignore
  }
}

function writeCache(routeId, day, data) {
  try {
    localStorage.setItem(
      cacheKey(routeId, day),
      JSON.stringify({ timestamp: Date.now(), data })
    );
  } catch {
    // localStorage full or unavailable (private browsing etc.) — fail silently
  }
}

function fetchRouteDetails(routeId) {
  const days = [
    "sunday", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday",
  ];
  const day = days[new Date().getDay()];

  const cached = readCache(routeId, day);
  if (cached) return Promise.resolve(cached);

  return axios
    .get("https://chalo.com/app/api/scheduler_v4/v4/palakkad/routedetailslive", {
      params: { route_id: routeId, day },
    })
    .then((res) => {
      console.log(`Fetched route details for ${routeId} (${day}) from API: https://chalo.com/app/api/scheduler_v4/v4/palakkad/routedetailslive`);
      writeCache(routeId, day, res.data);
      return res.data;
    });
}

function formatClock(sec) {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  const ampm = h < 12 ? "AM" : "PM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function RouteCard({ data }) {
  const { routeId } = useParams();
  const [payload, setPayload] = useState(data || null);
  const [status, setStatus] = useState(data ? "ready" : "loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (data) return;
    if (!routeId) {
      setStatus("error");
      setError("No routeId in the URL.");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetchRouteDetails(routeId)
      .then((json) => {
        if (cancelled) return;
        setPayload(json);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, data]);

  if (status === "loading") {
    return (
      <div className="container py-5 text-center text-secondary">
        <div className="spinner-border spinner-border-sm me-2" role="status" />
        Loading route…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="container py-5">
        <div className="alert alert-danger mb-0">Couldn't load the route. {error}</div>
      </div>
    );
  }

  const route = payload.route;
  const trips = payload.trips || [];
  const stops = route.stopSequenceWithDetails || [];
  const tripDurationSec = trips[0] ? trips[0].trip_duration : null;

  return (
    <div className="container py-5" style={{ maxWidth: 720 }}>
      <div className="card shadow-sm border-success-subtle">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-baseline flex-wrap mb-2">
            <span className="badge text-bg-success">{route.agency_name}</span>
            <small className="text-secondary text-uppercase">
              {route.serviceCategory && route.serviceCategory.replace(/_/g, " ")}
              {route.short_id ? ` · Route ${route.short_id}` : ""}
            </small>
          </div>

          <h1 className="h3 fw-bold text-success-emphasis mb-1">{route.route_name}</h1>

          {route.via && (
            <p className="text-secondary small mb-3">
              Via <span className="text-body">{route.via}</span>
            </p>
          )}

          <div className="row text-center border-top pt-3 g-0">
            <div className={tripDurationSec ? "col border-end" : "col"}>
              <div className="fs-4 fw-bold text-success-emphasis">{stops.length}</div>
              <div className="text-secondary text-uppercase small">Stops</div>
            </div>
            {tripDurationSec && (
              <div className="col">
                <div className="fs-4 fw-bold text-success-emphasis">
                  {formatDuration(tripDurationSec)}
                </div>
                <div className="text-secondary text-uppercase small">Scheduled duration</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {trips.length > 0 && (
        <div className="mt-4">
          <div className="text-secondary text-uppercase small mb-2">
            Daily departures &middot; {trips.length} trips
          </div>
          <div className="d-flex flex-wrap gap-2">
            {trips.map((t) => (
              <span key={t.trip_id} className="badge text-bg-light border font-monospace fw-normal">
                {formatClock(t.start_time)}
              </span>
            ))}
          </div>
        </div>
      )}

      <h2 className="h5 fw-bold text-success-emphasis mt-5 mb-3">Stop sequence</h2>

      <ul className="list-group list-group-flush">
        {stops.map((stop, i) => {
          const isFirst = i === 0;
          const isLast = i === stops.length - 1;
          return (
            <li key={stop.stop_id || i} className="list-group-item px-0 py-0 border-0">
              <div className="d-flex">
                <div
                  className="d-flex flex-column align-items-center flex-shrink-0"
                  style={{ width: 28 }}
                >
                  <span
                    className={
                      "rounded-circle border border-2 " +
                      (isFirst || isLast
                        ? "bg-success border-success"
                        : "bg-white border-secondary-subtle")
                    }
                    style={{
                      width: isFirst || isLast ? 14 : 10,
                      height: isFirst || isLast ? 14 : 10,
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                  />
                  {!isLast && (
                    <div className="border-start border-secondary-subtle flex-grow-1" style={{ width: 0 }} />
                  )}
                </div>

                <div className="flex-grow-1 pb-4 ps-3">
                  <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                    <div>
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span className="fw-bold">{stop.stop_name}</span>
                        {isFirst && (
                          <span className="badge text-bg-success-subtle text-success-emphasis">
                            Origin
                          </span>
                        )}
                        {isLast && (
                          <span className="badge text-bg-warning-subtle text-warning-emphasis">
                            Destination
                          </span>
                        )}
                      </div>
                      {stop.stop_address && (
                        <div className="text-secondary small mt-1">{stop.stop_address}</div>
                      )}
                    </div>
                    <div className="text-end">
                      <div className="text-secondary small font-monospace">
                        Stop {String(i + 1).padStart(2, "0")}/{String(stops.length).padStart(2, "0")}
                      </div>
                      {stop.stop_code && (
                        <div className="text-secondary small font-monospace">
                          Code {stop.stop_code}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}