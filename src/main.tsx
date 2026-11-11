import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";
import "./App.css";
import App from "./App";
import { SettingsWindow } from "./SettingsWindow";
import { isSettingsWindow } from "./lib/settingsWindow";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSettingsWindow(window.location.search) ? <SettingsWindow /> : <App />}
  </React.StrictMode>,
);
