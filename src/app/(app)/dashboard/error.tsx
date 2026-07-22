"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-[#f4f0e8] p-6">
      <Card className="w-full max-w-md border-red-200 bg-white text-center shadow-xl shadow-stone-900/5">
        <CardHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-700">
            <TriangleAlert className="size-6" />
          </div>
          <CardTitle className="mt-2 text-xl">Campaign data did not load</CardTitle>
          <CardDescription>
            No changes were made. Check the local Supabase connection and try
            again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={reset}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}