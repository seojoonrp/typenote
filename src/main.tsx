import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installInputGuards } from "./viewer/input";
import "./styles.css";

installInputGuards();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
