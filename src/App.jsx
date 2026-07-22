import { Routes, Route, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import Nav from './pages/Nav';
import Login from './pages/Login';
import Map from './pages/Map';
import PrivateRoute from './components/PrivateRoute';
import { AuthContext } from './utils/AuthContext';

function App() {
  const { isAuthenticated } = useContext(AuthContext);
  return (
    <div className="container">
      <Nav />
      <Routes>
        <Route path="/" element={<Navigate to={isAuthenticated ? "/map" : "/login"} />} />
        <Route 
          path="/login" 
          element={isAuthenticated ? <Navigate to="/map" /> : <Login />} 
        />
        {/* <Route 
          path="/register" 
          element={isAuthenticated ? <Navigate to="/map" /> : <Register />} 
        />
        <Route path="/inactive" element={<InactiveUser />} /> */}
        
        <Route element={<PrivateRoute />}>
            {/* <Route path="/dashboard" element={<Dashboard />} /> */}
            <Route path="/map" element={<Map />} />
        </Route>
      </Routes>
    </div>
  );
}

export default App;
