import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/cockpit.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Cockpit } from "./Cockpit.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Cockpit />
    </QueryClientProvider>
  </StrictMode>,
);
