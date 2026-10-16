import { SignedInHome } from "./signed-in-home";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Daggerheart Campaign Manager</h1>
      <SignedInHome />
    </main>
  );
}
