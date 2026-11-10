import { ancestryLabel, classDomains, className, communityName, domainName, subclassName } from "./catalog";
import { Line, Section } from "./chrome";
import type { SheetData } from "./types";

export function HeritageSection({ sheet }: { sheet: SheetData }) {
  const domains = classDomains(sheet.classId).map(domainName).join(" & ");
  return (
    <Section title="Heritage">
      <Line label="Ancestry" value={ancestryLabel(sheet.ancestry)} />
      <Line label="Community" value={communityName(sheet.communityId)} />
      <Line label="Class" value={className(sheet.classId)} />
      <Line label="Subclass" value={subclassName(sheet.subclassId)} />
      <Line label="Domains" value={domains || "—"} />
      {sheet.multiclass ? (
        <Line
          label="Multiclass"
          value={`${className(sheet.multiclass.classId)} · ${domainName(sheet.multiclass.domainId)} · ${subclassName(sheet.multiclass.subclassId)}`}
        />
      ) : null}
    </Section>
  );
}
