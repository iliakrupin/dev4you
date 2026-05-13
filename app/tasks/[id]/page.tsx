import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TaskPage() {
  // Детальный экран задачи удалён, перенаправляем на главную
  redirect("/");
}
