"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    const resolved = saved ?? getSystemTheme();
    setTheme(resolved);
    applyTheme(resolved);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem("theme", next);
  };

  if (!mounted) return null;

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
