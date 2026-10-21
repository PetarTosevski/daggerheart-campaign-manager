import type { Area } from "./harness";

/** Authz matrix: countdowns (countdowns, countdownRolls, countdownTracks, environmentActions). Filled by tracer H6 (.omc/plans/d12-hardening.yaml). */
const area: Area = {
  area: "countdowns",
  entries: [],
  pending: [
    "countdownRolls:applyRoll",
    "countdownRolls:countedRows",
    "countdownRolls:preview",
    "countdowns:create",
    "countdowns:createChase",
    "countdowns:decideChase",
    "countdowns:listByCampaign",
    "countdowns:operate",
    "countdowns:setArmed",
    "countdowns:setVisibility",
    "countdownTracks:afterRest",
    "countdownTracks:setRestMode",
    "countdownTracks:setStep",
    "countdownTracks:tickOnRest",
    "environmentActions:spendFear",
    "environmentActions:startCountdown",
  ],
};

export default area;
