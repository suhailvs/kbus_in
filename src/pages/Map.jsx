import { useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { GoogleMap, useJsApiLoader, OverlayView } from '@react-google-maps/api';
import { Sheet } from 'react-modal-sheet';
import RouteDetail from './RouteDetail';
import './Map.css';

const INIT_CENTER = { lat: 10.59975, lng: 76.45969 };
const GOOGLE_MAPS_API_KEY = "AIzaSyBwFTs8_ByftQEytonOPdVpdV9N0uyi3h4";

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

const MAP_LIBRARIES = [];

export default function MapPage() {
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const initialCenterRef = useRef(INIT_CENTER);

  const [buses, setBuses] = useState([]);
  const [toast, setToast] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);

  // Which bus's route detail is showing in the bottom sheet
  const [sheetRoute, setSheetRoute] = useState(null); // { routeId, vehicleId } | null

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: MAP_LIBRARIES,
  });

  const handleBusSelect = useCallback((routeId, vehicleId) => {
    setSheetRoute({ routeId, vehicleId });
  }, []);

  const closeSheet = useCallback(() => {
    setSheetRoute(null);
  }, []);

  const onLoad = useCallback((map) => {
    mapRef.current = map;
    if (circleRef.current) {
      // onLoad can fire more than once for the same component instance in
      // dev (React StrictMode double-invokes mount effects). Reuse the
      // existing circle instead of creating a second, orphaned one.
      circleRef.current.setMap(map);
      circleRef.current.setCenter(initialCenterRef.current);
      return;
    }
    circleRef.current = new window.google.maps.Circle({
      ...circleOptions,
      map,
      center: initialCenterRef.current,
      radius: 1000,
    });
  }, []);

  const onUnmount = useCallback(() => {
    // Detach rather than destroy — if this was StrictMode's dev-only
    // simulated unmount (not a real one), onLoad will fire again right
    // after and reattach this same circle instance rather than us handing
    // it a fresh one.
    if (circleRef.current) {
      circleRef.current.setMap(null);
    }
    mapRef.current = null;
  }, []);

  // Keeps the search-radius circle centered as the user pans the map,
  // same behavior as the original center_changed listener — now applied
  // directly to the native overlay instead of going through React state.
  const onCenterChanged = useCallback(() => {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    if (!c) return;
    const next = { lat: c.lat(), lng: c.lng() };
    if (circleRef.current) {
      circleRef.current.setCenter(next);
    }
  }, []);

  const refreshBuses = useCallback(async () => {
    if (!mapRef.current) return;

    const c = mapRef.current.getCenter();
    if (!c) return;

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

      const nextBuses = data.buses ?? [];
      setBuses(nextBuses);
      if (nextBuses.length === 0) {
        setToast('No buses found nearby');
        setTimeout(() => setToast(null), 3000);
      }
    } catch (err) {
      console.error('Failed to refresh buses:', err);
    }
  }, []);

  // Re-fetch nearby buses once the user finishes panning, rather than on
  // every intermediate center_changed event (which fires continuously
  // during a drag and would flood the API with requests).
  const onDragEnd = useCallback(() => {
    refreshBuses();
  }, [refreshBuses]);

  const goToCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateError("Geolocation isn't supported on this device.");
      return;
    }
    setIsLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (mapRef.current) {
          mapRef.current.panTo(next);
        }
        if (circleRef.current) {
          circleRef.current.setCenter(next);
        }
        setIsLocating(false);
        refreshBuses();
      },
      () => {
        setLocateError("Couldn't get your location. Check location permissions.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [refreshBuses]);

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
        onDragEnd={onDragEnd}
      >
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
        id="locate-btn"
        className="btn btn-light shadow"
        title="Go to current location"
        onClick={goToCurrentLocation}
        disabled={isLocating}
      >
        {isLocating ? (
          <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
        ) : (
          <i className="ti ti-current-location" style={{ fontSize: 20, color: '#0d6efd' }} />
        )}
        <span className="visually-hidden">Go to current location</span>
      </button>

      {locateError && (
        <div id="locate-error" className="alert alert-warning py-1 px-2 shadow-sm small mb-0">
          {locateError}
        </div>
      )}

      {toast && (
        <div className="position-absolute top-0 start-50 translate-middle-x mt-3 alert alert-dark py-1 px-3 shadow-sm small" style={{ zIndex: 10 }}>
          {toast}
        </div>
      )}
      <Sheet
        isOpen={!!sheetRoute}
        onClose={closeSheet}
        snapPoints={[0.9, 0.5, 0.15]}
        initialSnap={1}
      >
        <Sheet.Container>
          <Sheet.Header>
            <button
              type="button"
              className="btn-close position-absolute top-0 end-0 m-2"
              aria-label="Close"
              onClick={closeSheet}
              onPointerDownCapture={(e) => e.stopPropagation()}
              style={{ zIndex: 1 }}
            />
          </Sheet.Header>
          <Sheet.Content>
            {sheetRoute && <RouteDetail routeId={sheetRoute.routeId} />}
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onTap={closeSheet} />
      </Sheet>
    </div>
  );
}