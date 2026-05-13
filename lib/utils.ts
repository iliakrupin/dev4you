type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    out.push(String(v));
  };
  inputs.forEach(walk);
  return out.join(" ");
}

const statusLabels: Record<string, string> = {
  queued: "В очереди",
  analyzing: "Анализ",
  analyzed: "Готов план",
  implementing: "Пишу код",
  implemented: "Код готов",
  ready_for_review: "Собираю стенд",
  testing: "Тестирую",
  tested: "Тесты пройдены",
  deploying: "Выкатываю",
  merged: "Внедрено",
  failed: "Ошибка",
  cancelled: "Отменено",
};

export function statusLabel(s: string): string {
  return statusLabels[s] ?? s;
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelative(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} ч назад`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} д назад`;
  return formatDateTime(date);
}
