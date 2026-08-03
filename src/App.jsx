import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useContext } from 'react';
import Login from './pages/Login';
import Map from './pages/Map';
import RouteDetail from './pages/RouteDetail';
import PrivateRoute from './components/PrivateRoute';
import { AuthContext } from './utils/AuthContext';

function App() {
  const { isAuthenticated } = useContext(AuthContext);
  return (    
    <Routes>
      <Route path="/" element={<Navigate to={isAuthenticated ? "/map" : "/login"} />} />
      <Route 
        path="/login" 
        element={isAuthenticated ? <Navigate to="/map" /> : <Login />} 
      />      
      <Route element={<PrivateRoute />}>
          <Route path="/map" element={<Map />} />
          <Route path="/route/:routeId" element={<RouteDetail />} />
      </Route>
    </Routes>
  );
}

export default App;