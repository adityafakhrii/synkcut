import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      fallbackTitle="Synkcut mendeteksi gangguan tampilan"
      recoverLabel="Muat Ulang Tampilan"
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
