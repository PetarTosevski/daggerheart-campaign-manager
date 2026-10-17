/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as campaignTime from "../campaignTime.js";
import type * as campaigns from "../campaigns.js";
import type * as countdowns from "../countdowns.js";
import type * as fear from "../fear.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_mechanics from "../lib/mechanics.js";
import type * as lib_operations from "../lib/operations.js";
import type * as lib_users from "../lib/users.js";
import type * as members from "../members.js";
import type * as settings from "../settings.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  auth: typeof auth;
  campaignTime: typeof campaignTime;
  campaigns: typeof campaigns;
  countdowns: typeof countdowns;
  fear: typeof fear;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/allowlist": typeof lib_allowlist;
  "lib/auth": typeof lib_auth;
  "lib/mechanics": typeof lib_mechanics;
  "lib/operations": typeof lib_operations;
  "lib/users": typeof lib_users;
  members: typeof members;
  settings: typeof settings;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
