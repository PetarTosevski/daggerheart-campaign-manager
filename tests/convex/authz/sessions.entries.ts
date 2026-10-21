import type { Area } from "./harness";

/** Authz matrix: sessions (sessions, sessionRecords, sessionPrep, sessionPlay, sessionWrap). Filled by tracer H12 (.omc/plans/d12-hardening.yaml). */
const area: Area = {
  area: "sessions",
  entries: [],
  pending: [
    "sessionPlay:addLog",
    "sessionPlay:bumpSpotlight",
    "sessionPlay:log",
    "sessionPlay:removeLog",
    "sessionPlay:resetSpotlight",
    "sessionPlay:spotlight",
    "sessionPlay:tally",
    "sessionPrep:addScene",
    "sessionPrep:createEncounter",
    "sessionPrep:current",
    "sessionPrep:get",
    "sessionPrep:linkEncounter",
    "sessionPrep:removeScene",
    "sessionPrep:setHooks",
    "sessionPrep:setScene",
    "sessionPrep:unlinkEncounter",
    "sessionRecords:create",
    "sessionRecords:list",
    "sessionRecords:remove",
    "sessionRecords:setDate",
    "sessionRecords:setPlayed",
    "sessionRecords:setTitle",
    "sessions:allowExtraCharacters",
    "sessions:current",
    "sessions:end",
    "sessions:start",
    "sessionWrap:callMilestone",
    "sessionWrap:dashboard",
    "sessionWrap:get",
    "sessionWrap:setLoot",
    "sessionWrap:setRecap",
    "sessionWrap:setThreads",
  ],
};

export default area;
