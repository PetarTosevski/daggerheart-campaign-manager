import { httpRouter } from "convex/server";

import { auth } from "./auth";
import { codeRoute } from "./e2e";

const http = httpRouter();

auth.addHttpRoutes(http);
// Local e2e backend only: the gate is inside the handler (convex/e2e.ts); everywhere else it answers 404.
http.route({ path: "/e2e/code", method: "GET", handler: codeRoute });

export default http;
