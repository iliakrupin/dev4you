"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

const THEME_CHANGE_EVENT = "dev4you-theme-change";

function getThemeSnapshot(): Theme {
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : getSystemTheme();
}

function subscribeToTheme(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  media.addEventListener("change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    media.removeEventListener("change", onStoreChange);
  };
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore<Theme | null>(
    subscribeToTheme,
    getThemeSnapshot,
    () => null,
  );

  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  const toggle = () => {
    if (!theme) return;
    const next: Theme = theme === "light" ? "dark" : "light";
    localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  if (!theme) return null;

  return (
    <button
      onClick={toggle}
      title={theme === "light" ? "Переключить на тёмную тему" : "Переключить на светлую тему"}
      className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm transition hover:border-accent/50 hover:text-foreground active:scale-[0.98] w-fit"
    >
      <span className="text-base leading-none">{theme === "light" ? "🌙" : "☀️"}</span>
      {theme === "light" ? "Тёмная тема" : "Светлая тема"}
    </button>
  );
}
