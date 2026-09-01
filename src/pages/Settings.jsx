import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';

const GOOGLE_MAPS_API_KEY = "AIzaSyBwFTs8_ByftQEytonOPdVpdV9N0uyi3h4";

// Persisted default location, read by Map.jsx as its initial center
// whenever there's no in-session pan position to restore.
export const INITIAL_LOCATION_KEY = 'map:initialLocation';

const FALLBACK_CENTER = { lat: 10.59975, lng: 76.45969 };

const mapContainerStyle = { width: '100%', height: '320px', borderRadius: '8px' };

// Google Maps API only accepts a stable, module-level array reference for
// `libraries` — inline arrays cause needless script reloads.
const MAP_LIBRARIES = [];

export function readInitialLocation() {
  try {
    const raw = localStorage.getItem(INITIAL_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') return parsed;
    return null;
  } catch {
    return null; // corrupted entry or localStorage unavailable — ignore
  }
}

export default function Settings() {
  const navigate = useNavigate();
  const mapRef = useRef(null);

  const [picked, setPicked] = useState(readInitialLocation() || FALLBACK_CENTER);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: MAP_LIBRARIES,
  });

  const onLoad = useCallback((map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  const onMapClick = useCallback((e) => {
    if (!e.latLng) return;
    setPicked({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    setSaved(false);
  }, []);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateError("Geolocation isn't supported on this device.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPicked({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSaved(false);
        setLocating(false);
      },
      () => {
        setLocateError("Couldn't get your location. Check location permissions.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const handleSave = useCallback(() => {
    try {
      localStorage.setItem(INITIAL_LOCATION_KEY, JSON.stringify(picked));
      setSaved(true);
    } catch {
      // localStorage full or unavailable (private browsing etc.) — fail silently
    }
  }, [picked]);

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem(INITIAL_LOCATION_KEY);
    } catch {
      // ignore
    }
    setPicked(FALLBACK_CENTER);
    setSaved(false);
  }, []);

  return (
    <div className="container py-4" style={{ maxWidth: 720 }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 fw-bold mb-0">Settings</h1>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/map')}>
          <i className="ti ti-arrow-left me-1" />
          Back to map
        </button>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-1">Default map location</h2>
          <p className="text-secondary small mb-3">
            Tap the map to choose where it should open by default. Saved on this device.
          </p>

          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={mapContainerStyle}
              center={picked}
              zoom={14}
              onLoad={onLoad}
              onUnmount={onUnmount}
              onClick={onMapClick}
              options={{ disableDefaultUI: true, gestureHandling: 'greedy' }}
            >
              <Marker position={picked} />
            </GoogleMap>
          ) : (
            <div style={mapContainerStyle} className="bg-light" />
          )}

          <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
            <span className="text-secondary small font-monospace">
              {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
            </span>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm ms-auto"
              onClick={useMyLocation}
              disabled={locating}
            >
              {locating ? (
                <span className="spinner-border spinner-border-sm me-1" role="status" />
              ) : (
                <i className="ti ti-current-location me-1" />
              )}
              Use my location
            </button>
          </div>

          {locateError && (
            <div className="alert alert-warning py-1 px-2 mt-2 mb-0 small">{locateError}</div>
          )}

          <div className="d-flex gap-2 mt-3">
            <button type="button" className="btn btn-success" onClick={handleSave}>
              {saved ? 'Saved ✓' : 'Save as default location'}
            </button>
            <button type="button" className="btn btn-outline-danger" onClick={handleReset}>
              Reset to default
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}