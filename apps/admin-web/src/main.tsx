import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./shared/styles/global.css";
import { stripLeadingZerosWhileTyping } from "./shared/utils/numberInputs";

stripLeadingZerosWhileTyping();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
