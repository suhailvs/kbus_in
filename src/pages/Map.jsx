import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { GoogleMap, useJsApiLoader, OverlayView, Circle } from '@react-google-maps/api';
import './Map.css';

const INIT_CENTER = { lat: 10.59975, lng: 76.45969 };
const GOOGLE_MAPS_API_KEY = "AIzaSyBwFTs8_ByftQEytonOPdVpdV9N0uyi3h4";
const CENTER_STORAGE_KEY = 'map:lastCenter';

// Persisted in sessionStorage so panning survives navigating away to
// /route/:id and back (component unmounts/remounts), and even a page
// reload within the same tab — without leaking across separate visits.
function readStoredCenter() {
  try {
    const raw = sessionStorage.getItem(CENTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}
function writeStoredCenter(center) {
  try {
    sessionStorage.setItem(CENTER_STORAGE_KEY, JSON.stringify(center));
  } catch {
    // ignore quota/private-mode errors
  }
}

const mapContainerStyle = { width: '100%', height: '100%' };

const mapOptions = {
  disableDefaultUI: true,
  gestureHandling: 'greedy',
  styles: [
    { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#a8d4f5' }] },
    { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#e8edf0' }] },
    { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d0d0d0' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ],
};

const circleOptions = {
  strokeColor: '#888888',
  strokeOpacity: 0.7,
  strokeWeight: 1.5,
  fillColor: '#aaaaaa',
  fillOpacity: 0.18,
  clickable: false,
};

// Google Maps API only accepts a stable, module-level array/object reference
// for `libraries` — inline arrays cause needless script reloads.
const MAP_LIBRARIES = [];

export default function MapPage() {
  const navigate = useNavigate();
  const mapRef = useRef(null);

  // Stable across re-renders — GoogleMap only needs the center ONCE on mount;
  // after that, panning is tracked separately via `center` state below and
  // we don't want to feed a changing prop back in and fight the user's pan.
  const initialCenterRef = useRef(readStoredCenter() || INIT_CENTER);

  const [center, setCenter] = useState(initialCenterRef.current);
  const [buses, setBuses] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: MAP_LIBRARIES,
  });

  const handleBusSelect = useCallback(
    (routeId, vehicleId) => {
      navigate(`/route/${routeId}/?bus=${encodeURIComponent(vehicleId)}`);
    },
    [navigate]
  );

  const onLoad = useCallback((map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  // Keeps the search-radius circle centered as the user pans the map,
  // same behavior as the original center_changed listener.
  const onCenterChanged = useCallback(() => {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    if (!c) return;
    const next = { lat: c.lat(), lng: c.lng() };
    setCenter(next);
    writeStoredCenter(next);
  }, []);

  const refreshBuses = useCallback(async () => {
    if (!mapRef.current) return;
    setIsRefreshing(true);

    const c = mapRef.current.getCenter();
    if (!c) {
      setIsRefreshing(false);
      return;
    }

    try {
      const { data } = await axios.post(
        'https://chalo.com/app/api/nearbybus/v2/city/PALAKKAD',
        {
          metaData: { source: 'web' },
          requiredFields: {
            nearbyBuses: {
              lat: c.lat().toFixed(6),
              lng: c.lng().toFixed(6),
              radius: 1000,
            },
            cardsInfo: {},
          },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      setBuses(data.buses ?? []);
    } catch (err) {
      console.error('Failed to refresh buses:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  if (!isLoaded) {
    return <div id="map-wrapper" />;
  }

  return (
    <div id="map-wrapper">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={initialCenterRef.current}
        zoom={14}
        options={mapOptions}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onCenterChanged={onCenterChanged}
      >
        <Circle center={center} radius={1000} options={circleOptions} />

        {buses.map((bus) => (
          <OverlayView
            key={bus.session._vehicleId}
            position={{ lat: bus.parameters.lat, lng: bus.parameters.lon }}
            mapPaneName={OverlayView.FLOAT_PANE}
            getPixelPositionOffset={(width, height) => ({ x: -(width / 2), y: -40 })}
          >
            <div
              className="bus-label"
              onClick={() => handleBusSelect(bus.session._routeId, bus.session._vehicleId)}
            >
              🚌 {bus.session._routeName}
            </div>
          </OverlayView>
        ))}
      </GoogleMap>

      <button
        id="refresh-btn"
        className={`btn btn-light shadow${isRefreshing ? ' loading' : ''}`}
        title="Refresh buses"
        onClick={refreshBuses}
        disabled={!isLoaded || isRefreshing}
      >
        <svg
          className="icon-refresh"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        <span className="spinner-border text-info" role="status" aria-hidden="true" />
        <span className="visually-hidden">Refreshing…</span>
      </button>
    </div>
  );
}