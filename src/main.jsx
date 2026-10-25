import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// 운영자 페이지는 검색엔진 색인 제외
try {
  if (window.location.pathname.replace(/\/+$/, "") === "/admin") {
    const m = document.querySelector('meta[name="robots"]');
    if (m) m.setAttribute("content", "noindex,nofollow");
    const c = document.querySelector('link[rel="canonical"]');
    if (c) c.remove();
  }
} catch (e) { /* ignore */ }

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
