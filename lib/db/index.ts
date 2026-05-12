import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

function getDb(): DB {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан. Скопируйте .env.example в .env.local и заполните.",
    );
  }
  const sql = neon(url);
  _db = drizzle(sql, { schema });
  return _db;
}

// Экспортируем proxy, который лениво инициализируется при первом обращении.
// Это позволяет билду пройти без DATABASE_URL.
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const inst = getDb();
    const value = inst[prop as keyof DB];
    return typeof value === "function" ? value.bind(inst) : value;
  },
});

export * from "./schema";
