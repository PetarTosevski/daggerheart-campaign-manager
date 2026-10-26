import { JoinByLink } from "./join-by-link";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinByLink code={code} />;
}
