import { Routes, Route, Navigate } from 'react-router-dom';
import Map from './pages/Map';
import RouteDetail from './pages/RouteDetail';

function App() {
  return (
    <Routes>
      <Route path="/map" element={<Map />} />
      <Route path="/route/:routeId" element={<RouteDetail />} />
      {/* <Route path="*" element={<Navigate to="/" replace />} /> */}
    </Routes>
  );
}

export default App;