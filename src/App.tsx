import { Navigate, Route, Routes } from "react-router-dom";
import PublicEoi from "./routes/PublicEoi";
import Admin from "./routes/Admin";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicEoi />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
