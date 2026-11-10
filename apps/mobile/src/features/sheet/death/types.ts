import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../convex";

export type DeathMoveState = FunctionReturnType<typeof api.deathMoves.state>;
