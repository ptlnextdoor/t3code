/**
 * Isolated design harness for the TODAY command center.
 *
 * Mounts ONLY the TodayPanel against a stubbed `/api/today`, so the design can
 * be screenshotted without booting the whole app (which needs a server and
 * auth). This is the right unit: the panel is self-contained.
 *
 * Not shipped: excluded from the app build, used by scripts/today-e2e.mjs.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";
import "../sand.css";
import { TodayPanel } from "../components/TodayPanel";
import { TeamPanel } from "../components/employees/TeamPanel";
import { ConnectionBar } from "../components/connections/ConnectionBar";
import { ConnectionCards } from "../components/connections/ConnectionCards";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <div className="sand-rail">
        <ConnectionBar />
        <ConnectionCards />
        <TeamPanel />
        <TodayPanel />
      </div>
    </StrictMode>,
  );
}
