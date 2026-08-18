import { ConfigManager } from "../config/configmangger";
//@ts-ignore
import { VectorDB } from "./vectorDb";
import { DataPathManager } from "./dataPathManager";
let db: VectorDB | null = null;
let lastDataDir: string | null = null;

export function getDB() {
  const dimension = ConfigManager.getInstance().getConfig().embedding?.dimensions || 1024;
  const currentDataDir = DataPathManager.getInstance().getDataDir();
  if (db && db.getDimension() === dimension && currentDataDir === lastDataDir) {
    // console.log("单例模式");
    return db
  }
  if (db) {
    // dataDir 在同一进程内发生了变化（例如安装引导刚选完目录），旧连接指向的是变更前的路径，
    // 必须先关闭，否则会残留一个没人用的 better-sqlite3/WAL 句柄，Windows 下还可能锁住旧文件
    try {
      db.getDb().close();
    } catch (e) {
      console.error('[getDB] 关闭旧数据库连接失败:', e);
    }
  }
  db = new VectorDB();
  lastDataDir = currentDataDir;
  return db;
}
