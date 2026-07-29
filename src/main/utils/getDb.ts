import { ConfigManager } from "../config/configmangger";
//@ts-ignore
import { VectorDB } from "./vectorDb";
let db: VectorDB | null = null;

export function getDB() {
  const dimension = ConfigManager.getInstance().getConfig().embedding?.dimensions || 1024;
  if (db && db.getDimension() === dimension) {
    // console.log("单例模式");
    return db
  }
  db = new VectorDB();
  return db;
}
