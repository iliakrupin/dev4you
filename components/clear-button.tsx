"use client";

export function ClearButton() {
  const handleClick = async () => {
    if (!confirm("Удалить ВСЕ задачи?")) return;
    await fetch("/api/tasks/clear", { method: "POST" });
    window.location.reload();
  };

  return (
    <button
      onClick={handleClick}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      Очистить
    </button>
  );
}
