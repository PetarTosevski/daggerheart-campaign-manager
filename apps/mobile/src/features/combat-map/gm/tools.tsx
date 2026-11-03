import { View } from "react-native";

import { SlotBoundary } from "../../adversaries/controls";

import type { CombatSlotProps } from "../contract";
import { CombatGmProvider } from "./context";
import { CombatGmAdversary } from "./adversary-panel";
import { CombatGmCombatants } from "./combatants-panel";
import { CombatGmFear } from "./fear-panel";
import { CombatGmHandSharing } from "./hand-sharing";
import { CombatGmMaps } from "./maps-panel";
import { CombatGmSanctions } from "./sanctions-panel";
import { gmStyles } from "./styles";
import { CombatGmVision } from "./vision-panel";
export function CombatGmTools(props: CombatSlotProps) {
  return (
    <CombatGmProvider campaignId={props.campaignId} layout={props.layout}>
      <View style={gmStyles.stack}>
        <SlotBoundary label="Combat GM Fear">
          <CombatGmFear />
        </SlotBoundary>
        <SlotBoundary label="Combat maps">
          <CombatGmMaps />
        </SlotBoundary>
        <SlotBoundary label="Combatants">
          <CombatGmCombatants />
        </SlotBoundary>
        <SlotBoundary label="Hand sharing">
          <CombatGmHandSharing />
        </SlotBoundary>
        <SlotBoundary label="Vision">
          <CombatGmVision />
        </SlotBoundary>
        <SlotBoundary label="Adversary actions">
          <CombatGmAdversary />
        </SlotBoundary>
        <SlotBoundary label="Sanctions">
          <CombatGmSanctions />
        </SlotBoundary>
      </View>
    </CombatGmProvider>
  );
}
