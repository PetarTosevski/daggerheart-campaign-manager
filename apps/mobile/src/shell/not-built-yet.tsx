import { Empty } from "../ui/empty";

/** One stub for every feature screen this shell mounts before that feature is built. */
export function NotBuiltYet({ title }: { title: string }) {
  return <Empty message="Not built yet." title={title} />;
}
