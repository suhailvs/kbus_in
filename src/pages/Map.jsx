import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Map.css';

const INIT_CENTER = { lat: 10.59975, lng: 76.45969 };
const GOOGLE_MAPS_API_KEY = "AIzaSyBwFTs8_ByftQEytonOPdVpdV9N0uyi3h4";

// Custom overlay class — draws a bus label on the map and navigates to the
// route detail page when clicked.
//
// IMPORTANT: this must NOT be a top-level `class ... extends google.maps.OverlayView`,
// because that line would evaluate `google.maps.OverlayView` as soon as this module
// is imported — before the Maps script has loaded — throwing
// "ReferenceError: google is not defined". Instead we build the class lazily,
// inside a factory that's only called after loadGoogleMapsScript() resolves.
let BusLabelOverlay = null;
function getBusLabelOverlayClass() {
  if (BusLabelOverlay) return BusLabelOverlay;

  BusLabelOverlay = class extends google.maps.OverlayView {
    constructor(pos, text, routeId, vehicleId, onSelect) {
      super();
      this.pos = pos;
      this.text = text;
      this.routeId = routeId;
      this.vehicleId = vehicleId;
      this.onSelect = onSelect;
      this.div = null;
    }

    onAdd() {
      const div = document.createElement('div');
      div.className = 'bus-label';
      div.textContent = `🚌 ${this.text}`;
      div.addEventListener('click', () => this.onSelect(this.routeId, this.vehicleId));
      this.div = div;
      this.getPanes()?.floatPane.appendChild(div);
    }

    draw() {
      const projection = this.getProjection();
      if (!projection || !this.div) return;
      const point = projection.fromLatLngToDivPixel(this.pos);
      if (point) {
        this.div.style.left = `${point.x - this.div.offsetWidth / 2}px`;
        this.div.style.top = `${point.y - 40}px`;
      }
    }

    onRemove() {
      this.div?.remove();
      this.div = null;
    }
  };

  return BusLabelOverlay;
}

// Loads the Google Maps script once and reuses it across mounts/route changes.
let mapsScriptPromise = null;
function loadGoogleMapsScript() {
  if (window.google?.maps) return Promise.resolve();
  if (mapsScriptPromise) return mapsScriptPromise;

  mapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(script);
  });

  return mapsScriptPromise;
}

export default function MapPage() {
  const navigate = useNavigate();
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const labelOverlaysRef = useRef([]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const handleBusSelect = useCallback(
    (routeId, vehicleId) => {
      navigate(`/route/${routeId}/?bus=${encodeURIComponent(vehicleId)}`);
    },
    [navigate]
  );

  const refreshBuses = useCallback(async () => {
    if (!mapRef.current) return;
    setIsRefreshing(true);

    const center = mapRef.current.getCenter();
    if (!center) {
      setIsRefreshing(false);
      return;
    }

    try {
      const response = await fetch('https://chalo.com/app/api/nearbybus/v2/city/PALAKKAD', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaData: { source: 'web' },
          requiredFields: {
            nearbyBuses: {
              lat: center.lat().toFixed(6),
              lng: center.lng().toFixed(6),
              radius: 1000,
            },
            cardsInfo: {},
          },
        }),
      });

      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const data = await response.json();

      // Clear old overlays before drawing new ones
      labelOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      labelOverlaysRef.current = [];

      const OverlayClass = getBusLabelOverlayClass();
      data.buses.forEach((bus) => {
        const overlay = new OverlayClass(
          new google.maps.LatLng(bus.parameters.lat, bus.parameters.lon),
          bus.session._routeName,
          bus.session._routeId,
          bus.session._vehicleId,
          handleBusSelect
        );
        overlay.setMap(mapRef.current);
        labelOverlaysRef.current.push(overlay);
      });
    } catch (err) {
      console.error('Failed to refresh buses:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [handleBusSelect]);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMapsScript().then(() => {
      if (cancelled || !mapDivRef.current) return;

      const map = new google.maps.Map(mapDivRef.current, {
        center: INIT_CENTER,
        zoom: 14,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        styles: [
          { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#a8d4f5' }] },
          { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#e8edf0' }] },
          { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
          { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d0d0d0' }] },
          { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        ],
      });

      const circle = new google.maps.Circle({
        map,
        center: INIT_CENTER,
        radius: 1000,
        strokeColor: '#888888',
        strokeOpacity: 0.7,
        strokeWeight: 1.5,
        fillColor: '#aaaaaa',
        fillOpacity: 0.18,
        clickable: false,
      });

      map.addListener('center_changed', () => {
        const c = map.getCenter();
        if (c) circle.setCenter(c);
      });

      mapRef.current = map;
      circleRef.current = circle;
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      labelOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      labelOverlaysRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="map-wrapper">
      <div id="map" ref={mapDivRef} />
      <button
        id="refresh-btn"
        className={`btn btn-light shadow${isRefreshing ? ' loading' : ''}`}
        title="Refresh buses"
        onClick={refreshBuses}
        disabled={!mapReady || isRefreshing}
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