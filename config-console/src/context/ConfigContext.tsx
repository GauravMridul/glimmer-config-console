import { createContext, useContext, type ReactNode } from "react";
import { useConfigStore } from "@/hooks/useConfigStore";

type Store = ReturnType<typeof useConfigStore>;

const ConfigContext = createContext<Store | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const store = useConfigStore();
  return (
    <ConfigContext.Provider value={store}>{children}</ConfigContext.Provider>
  );
}

export function useConfig(): Store {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useConfig must be used within ConfigProvider");
  }
  return ctx;
}
