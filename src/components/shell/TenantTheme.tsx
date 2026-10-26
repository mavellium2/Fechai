"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";

type Theme = "light" | "dark";
type ThemeScope = "tenant" | "admin";
const KEYS = { tenant: "fechai:tenant-theme", admin: "fechai:admin-theme" };
const CHANGE = "fechai:tenant-theme-change";
const memoryTheme: Record<ThemeScope, Theme> = { tenant: "light", admin: "dark" };
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE, callback);
  };
}
function readTheme(scope: ThemeScope): Theme {
  try {
    const saved = localStorage.getItem(KEYS[scope]);
    return saved === "light" || saved === "dark" ? saved : scope === "admin" ? "dark" : "light";
  } catch { return memoryTheme[scope]; }
}

/** Shared surfaces with independent preferences for the tenant and admin. */
export function TenantThemeProvider({ children, scope = "tenant" }: { children: ReactNode; scope?: ThemeScope }) {
  const theme = useSyncExternalStore(subscribe, () => readTheme(scope), () => scope === "admin" ? "dark" : "light");
  function toggle() {
    memoryTheme[scope] = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEYS[scope], memoryTheme[scope]); } catch { /* Use the in-memory preference. */ }
    window.dispatchEvent(new Event(CHANGE));
  }
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <div className="tenant-theme" data-surface={theme} data-panel={scope}>{children}</div>
    </ThemeContext.Provider>
  );
}

/** Kept visible in the rail, and repeated inside the mobile navigation drawer. */
export function TenantThemeToggle({ compact = false }: { compact?: boolean }) {
  const context = useContext(ThemeContext);
  if (!context) return null;
  const dark = context.theme === "dark";
  const Icon = dark ? Moon : Sun;
  return (
    <div className={`tenant-theme-toggle ${compact ? "tenant-theme-toggle-rail" : ""}`}>
      <span className="tenant-theme-current-icon" aria-hidden><Icon size={19} /></span>
      <span className={`tenant-theme-label ${compact ? "tenant-rail-label" : ""}`}>{dark ? "Modo escuro" : "Modo claro"}</span>
      <Switch checked={dark} onCheckedChange={context.toggle} label="Modo escuro" className="tenant-theme-switch"
        thumbContent={<Icon size={14} strokeWidth={2} aria-hidden />} />
    </div>
  );
}
