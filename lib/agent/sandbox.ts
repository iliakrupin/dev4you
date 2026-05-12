/**
 * Whitelist путей, которые агент имеет право читать и менять.
 * Любой путь вне списка вызывает SandboxError.
 *
 * Пути относительные к корню репозитория.
 */
const ALLOWED_PATTERNS: RegExp[] = [
  // Тема приложения
  /^app\/globals\.css$/,
  /^tailwind\.config\.(ts|js|mjs|cjs)$/,
  // Публичные страницы UI (тексты, верстка, заголовки)
  /^app\/page\.tsx$/,
  /^app\/new\/page\.tsx$/,
  /^app\/new\/new-task-form\.tsx$/,
  /^app\/tasks\/\[id\]\/page\.tsx$/,
  /^app\/tasks\/\[id\]\/task-detail\.tsx$/,
  /^app\/\(public\)\/.*\.(tsx|ts|css)$/,
  // Презентационные UI-компоненты
  /^components\/(?!auto-refresh|list-auto-refresh).*\.(tsx|ts|css)$/,
  // Статика
  /^public\/.*\.(svg|png|jpg|jpeg|webp|ico|json|txt)$/,
];

export class SandboxError extends Error {
  constructor(public path: string) {
    super(`Путь "${path}" вне sandbox`);
  }
}

export function isAllowed(path: string): boolean {
  const normalized = path.replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized.includes("..")) return false;
  return ALLOWED_PATTERNS.some((re) => re.test(normalized));
}

export function assertAllowed(path: string): void {
  if (!isAllowed(path)) throw new SandboxError(path);
}

export const ALLOWED_HINT = [
  "app/globals.css — CSS-переменные темы (--accent, --background и т.п.)",
  "tailwind.config.ts — конфиг Tailwind, если он есть",
  "app/page.tsx — главная: список задач, заголовки, описания",
  "app/new/page.tsx, app/new/new-task-form.tsx — экран постановки задачи",
  "app/tasks/[id]/page.tsx, app/tasks/[id]/task-detail.tsx — детальный экран задачи",
  "components/** — UI-компоненты (StatusBadge, Timeline, TaskCard и др.)",
  "public/** — статика (картинки, иконки)",
].join("\n");
