/**
 * Whitelist путей, которые агент имеет право читать и менять.
 * Любой путь вне списка вызывает SandboxError.
 *
 * Пути относительные к корню репозитория.
 */
const ALLOWED_PATTERNS: RegExp[] = [
  /^app\/globals\.css$/,
  /^tailwind\.config\.(ts|js|mjs|cjs)$/,
  /^app\/\(public\)\/.*\.(tsx|ts|css)$/,
  /^components\/ui\/.*\.(tsx|ts|css)$/,
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
  "app/(public)/** — публичные страницы",
  "components/ui/** — UI-компоненты",
].join("\n");
