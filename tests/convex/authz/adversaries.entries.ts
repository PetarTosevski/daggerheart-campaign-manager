import type { Area } from "./harness";

/** Authz matrix: adversaries (encounters, encounterTracking, customAdversaries). Filled by tracer H10 (.omc/plans/d12-hardening.yaml). */
const area: Area = {
  area: "adversaries",
  entries: [],
  pending: [
    "customAdversaries:create",
    "customAdversaries:list",
    "customAdversaries:remove",
    "customAdversaries:update",
    "encounters:addAdversary",
    "encounters:create",
    "encounters:end",
    "encounters:get",
    "encounters:list",
    "encounters:remove",
    "encounters:removeInstance",
    "encounters:rename",
    "encounters:reorder",
    "encounters:setBudget",
    "encounters:setNotes",
    "encounters:start",
    "encounterTracking:applyDamage",
    "encounterTracking:customBlocks",
    "encounterTracking:defeatMinions",
    "encounterTracking:endGmTurn",
    "encounterTracking:markHp",
    "encounterTracking:markStress",
    "encounterTracking:setNote",
    "encounterTracking:setTags",
    "encounterTracking:spendFear",
    "encounterTracking:spotlight",
    "encounterTracking:toggleCondition",
  ],
};

export default area;
