import { ScrollView } from "react-native";

import { useCampaign } from "../../shell/campaign-provider";
import { QueryBoundary } from "../../ui/query-boundary";
import { TomeBook } from "./book";

export function TomeScreen() {
  return (
    <QueryBoundary>
      <TomeBody />
    </QueryBoundary>
  );
}

function TomeBody() {
  const campaign = useCampaign();
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <TomeBook campaign={campaign} />
    </ScrollView>
  );
}
