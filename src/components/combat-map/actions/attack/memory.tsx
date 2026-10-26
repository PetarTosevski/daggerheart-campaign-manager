"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * State of the combat-actions panel that must survive the layout switch at 760 px (user answer 2026-10-22: "keep the
 * last attack result when the layout switches"). `ActionsPanel` mounts this provider above the desktop cards and the
 * phone bottom sheet, so the Attack bar's last result and the Hand's last card result outlive the remount. Outside a
 * provider (the GM column's Hand) the hook keeps the value in the component itself.
 */

type Memory = { store: Readonly<Record<string, unknown>>; set: (key: string, value: unknown) => void };

const MemoryContext = createContext<Memory | null>(null);

export function PanelMemoryProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Readonly<Record<string, unknown>>>({});
  const value = useMemo<Memory>(() => ({ store, set: (key, v) => setStore((s) => ({ ...s, [key]: v })) }), [store]);
  return <MemoryContext.Provider value={value}>{children}</MemoryContext.Provider>;
}

/** A value kept by the nearest `PanelMemoryProvider` under `key` (each key holds one type), else by the component. */
export function usePanelMemory<T>(key: string, initial: T): [T, (value: T) => void] {
  const memory = useContext(MemoryContext);
  const [local, setLocal] = useState<T>(initial);
  if (memory === null) return [local, setLocal];
  const value = key in memory.store ? (memory.store[key] as T) : initial;
  return [value, (v: T) => memory.set(key, v)];
}
