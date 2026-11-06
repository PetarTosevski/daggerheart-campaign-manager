import { httpRouter } from "convex/server";

import { download, downloadPreflight } from "./adminExport";
import { auth } from "./auth";
import { codeRoute } from "./e2e";

const http = httpRouter();

auth.addHttpRoutes(http);
// Local e2e backend only: the gate is inside the handler (convex/e2e.ts); everywhere else it answers 404.
http.route({ path: "/e2e/code", method: "GET", handler: codeRoute });
// The owner's export file (config AD11): the bearer token must be the app owner's (convex/adminExport.ts).
http.route({ path: "/admin/export", method: "GET", handler: download });
http.route({ path: "/admin/export", method: "OPTIONS", handler: downloadPreflight });

export default http;
