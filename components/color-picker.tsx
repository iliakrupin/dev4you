"use client";

import { useEffect, useState } from "react";

const PRESETS = [
  { label: "Зелёный", value: "#16a34a", fg: "#ffffff" },
  { label: "Фиолетовый", value: "#7c3aed", fg: "#ffffff" },
  { label: "Синий", value: "#2563eb", fg: "#ffffff" },
  { label: "Оранжевый", value: "#ea580c", fg: "#ffffff" },
  { label: "Розовый", value: "#db2777", fg: "#ffffff" },
  { label: "Серый", value: "#475569", fg: "#ffffff" },
];

function applyAccent(color: string, fg: string) {
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-foreground", fg);
  document.documentElement.style.setProperty(
    "--accent-soft",
    color + "1a" // 10% opacity hex
  );
  document.documentElement.style.setProperty("--success", color);
}

export function ColorPicker() {
  const [active, setActive] = useState<string>(PRESETS[0].value);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("accent-color");
    const savedFg = localStorage.getItem("accent-fg");
    if (saved) {
      setActive(saved);
      applyAccent(saved, savedFg ?? "#ffffff");
    }
    setMounted(true);
  }, []);

  const pick = (value: string, fg: string) => {
    setActive(value);
    applyAccent(value, fg);
    localStorage.setItem("accent-color", value);
    localStorage.setItem("accent-fg", fg);
  };

  if (!mounted) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium">Акцент:</span>
      {PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => pick(p.value, p.fg)}
          title={p.label}
          className="h-6 w-6 rounded-full border-2 transition-transform active:scale-90"
          style={{
            backgroundColor: p.value,
            borderColor: active === p.value ? p.value : "transparent",
            outline: active === p.value ? `2px solid ${p.value}` : "none",
            outlineOffset: "2px",
          }}
          aria-label={`Акцентный цвет: ${p.label}`}
        />
      ))}
    </div>
  );
}
