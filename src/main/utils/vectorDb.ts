//@ts-ignore
import Database from "better-sqlite3";
import { getExtensionPath } from "@sqliteai/sqlite-vector";
//@ts-ignore
import path from "path";
import { app } from "electron";
import { ConfigManager } from "../config/configmangger";
import { formatDate, getSystemPath } from "./common";

type Vector = number[];

export class VectorDB {
  db: Database.Database;
  private tableName = "embdingTable";
  private writingSampleTableName = "writingSampleEmbeddings";
  private writingProfileSampleTableName = "writingProfileSamples";
  private userMemoryTableName = "user_memories";
  private dimension: number;

  constructor() {
    const config = ConfigManager.getInstance().getConfig();
    this.dimension = config.embedding?.dimensions || 1024;

    const dbPath = getSystemPath("rag.db");
    this.db = new Database(dbPath, { prepareCacheSize: 0 });
    this.db.pragma("journal_mode = WAL");

    function mgetExtensionPath() {
      const resourcePath = app.isPackaged
        ? path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "node_modules",
            "@sqliteai",
            "sqlite-vector",
            "node_modules",
            "@sqliteai",
            "sqlite-vector-win32-x86_64"
          )
        : path.join(__dirname, "resources");
      return path.join(resourcePath, "vector.dll");
    }

    this.db.loadExtension(
      process.env.NODE_ENV === "development" ? getExtensionPath() : mgetExtensionPath()
    );

    this.db.prepare("SELECT vector_version()").pluck().get();
    this.initTable();
    this.initVector();
  }

  private toBlob(vec: Vector): Buffer {
    return Buffer.from(new Float32Array(vec).buffer);
  }

  private initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id INTEGER PRIMARY KEY,
        embedding BLOB,
        label TEXT,
        relateId Integer,
        ojson TEXT,
        createTime string,
        UNIQUE(id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.writingSampleTableName} (
        id INTEGER PRIMARY KEY,
        embedding BLOB,
        chunkText TEXT,
        profileId INTEGER,
        chunkIndex INTEGER,
        keywords TEXT,
        createTime string,
        UNIQUE(id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.writingProfileSampleTableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profileId INTEGER,
        sourceType string,
        sourceName string,
        content TEXT,
        analysisProfile TEXT,
        analysisStatus string,
        analysisUpdateTime string,
        createTime string,
        updateTime string
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS texts (
        id INTEGER PRIMARY KEY,
        fileName string,
        content TEXT,
        markdownContent TEXT,
        title string,
        docType string,
        size string,
        docPath string,
        typeId Integer,
        createTime string,
        isRag Integer,
        isUpload Integer,
        status Integer,
        process Integer,
        UNIQUE(id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS textType (
        id INTEGER PRIMARY KEY,
        labelType string,
        createTime string,
        UNIQUE(id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY,
        sessionId string,
        content TEXT,
        user string,
        role string,
        updateTime string,
        createTime string,
        tools string,
        toolResults string,
        files string,
        UNIQUE(id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.userMemoryTableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        sessionId TEXT,
        sourceMessageId INTEGER,
        content TEXT NOT NULL,
        embedding BLOB,
        status TEXT DEFAULT 'active',
        createTime TEXT,
        updateTime TEXT
      );
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_memories_user ON ${this.userMemoryTableName}(userId, status);`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chatsIds (
        sessionId string PRIMARY KEY,
        userId INTEGER,
        compressedMemory TEXT,
        updateTime string,
        createTime string,
        UNIQUE(sessionId)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deep_sessions (
        sessionId TEXT PRIMARY KEY,
        name TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deep_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT,
        role TEXT,
        content TEXT,
        createdAt TEXT
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deep_skills (
        name TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        description TEXT,
        updatedAt TEXT
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deep_task_traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runId TEXT NOT NULL,
        sessionId TEXT,
        threadId TEXT,
        eventSeq INTEGER NOT NULL,
        round INTEGER DEFAULT 1,
        eventType TEXT NOT NULL,
        toolName TEXT,
        toolAction TEXT,
        title TEXT,
        content TEXT,
        payloadJson TEXT,
        skillName TEXT,
        skillAction TEXT,
        status TEXT DEFAULT 'active',
        createdAt TEXT NOT NULL,
        expireAt TEXT NOT NULL
      );
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_deep_task_traces_run ON deep_task_traces(runId, eventSeq);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_deep_task_traces_expire ON deep_task_traces(expireAt);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_deep_task_traces_session ON deep_task_traces(sessionId, createdAt);`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS writing_chat_sessions (
        sessionId TEXT PRIMARY KEY,
        profileId INTEGER,
        name TEXT,
        compressedMemory TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS writing_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT,
        role TEXT,
        content TEXT,
        createdAt TEXT
      );
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_writing_chat_sessions_profile ON writing_chat_sessions(profileId, updatedAt);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_writing_chat_messages_session ON writing_chat_messages(sessionId, id);`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS writing_feedback_pool (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profileId INTEGER,
        sessionId TEXT,
        userPrompt TEXT,
        aiDraft TEXT,
        userFeedback TEXT,
        revisedDraft TEXT,
        score INTEGER,
        accepted INTEGER DEFAULT 0,
        status TEXT,
        createTime TEXT,
        updateTime TEXT
      );
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_writing_feedback_profile ON writing_feedback_pool(profileId, createTime);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_writing_feedback_session ON writing_feedback_pool(sessionId, createTime);`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY,
        title string,
        content TEXT,
        originalContent TEXT,
        sourceType string,
        scene string,
        identity string,
        preferredPhrases TEXT,
        avoidPhrases TEXT,
        styleProfile TEXT,
        userId INTEGER,
        articleType string,
        updateTime string,
        createTime string,
        UNIQUE(id)
      );
    `);

    this.ensureArticleColumns();
    this.ensureWritingProfileSampleColumns();
    this.ensureChatSessionColumns();
    this.ensureDeepSessionsColumns();
    this.ensureDeepMessagesColumns();
    this.ensureWritingChatMessagesColumns();
  }

  private ensureDeepSessionsColumns() {
    const columns = this.db.prepare(`PRAGMA table_info(deep_sessions)`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const pendingColumns = [
      { name: "workDir", type: "TEXT" },
      { name: "permissionLevel", type: "TEXT" },
      { name: "compressedMemory", type: "TEXT" },
    ];

    for (const column of pendingColumns) {
      if (!columnNames.has(column.name)) {
        this.db.exec(`ALTER TABLE deep_sessions ADD COLUMN ${column.name} ${column.type}`);
      }
    }
  }

  // AI超级员工消息附件路径（逗号拼接），与 chat_messages.files 保持同样的存储格式
  private ensureDeepMessagesColumns() {
    const columns = this.db.prepare(`PRAGMA table_info(deep_messages)`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("files")) {
      this.db.exec(`ALTER TABLE deep_messages ADD COLUMN files TEXT`);
    }
  }

  // AI写作消息附件路径（逗号拼接），与 chat_messages.files 保持同样的存储格式
  private ensureWritingChatMessagesColumns() {
    const columns = this.db.prepare(`PRAGMA table_info(writing_chat_messages)`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("files")) {
      this.db.exec(`ALTER TABLE writing_chat_messages ADD COLUMN files TEXT`);
    }
  }

  private ensureChatSessionColumns() {
    const columns = this.db.prepare(`PRAGMA table_info(chatsIds)`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const pendingColumns = [
      { name: "compressedMemory", type: "TEXT" },
    ];

    for (const column of pendingColumns) {
      if (!columnNames.has(column.name)) {
        this.db.exec(`ALTER TABLE chatsIds ADD COLUMN ${column.name} ${column.type}`);
      }
    }
  }

  private ensureArticleColumns() {
    const columns = this.db.prepare(`PRAGMA table_info(articles)`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const pendingColumns = [
      { name: "sourceType", type: "string" },
      { name: "scene", type: "string" },
      { name: "identity", type: "string" },
      { name: "preferredPhrases", type: "TEXT" },
      { name: "avoidPhrases", type: "TEXT" },
      { name: "styleProfile", type: "TEXT" },
    ];

    for (const column of pendingColumns) {
      if (!columnNames.has(column.name)) {
        this.db.exec(`ALTER TABLE articles ADD COLUMN ${column.name} ${column.type}`);
      }
    }
  }

  private ensureWritingProfileSampleColumns() {
    const columns = this.db.prepare(`PRAGMA table_info(${this.writingProfileSampleTableName})`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const pendingColumns = [
      { name: "analysisProfile", type: "TEXT" },
      { name: "analysisStatus", type: "string" },
      { name: "analysisUpdateTime", type: "string" },
    ];

    for (const column of pendingColumns) {
      if (!columnNames.has(column.name)) {
        this.db.exec(`ALTER TABLE ${this.writingProfileSampleTableName} ADD COLUMN ${column.name} ${column.type}`);
      }
    }
  }

  private initVector() {
    this.db.exec(`
      SELECT vector_init(
        '${this.tableName}',
        'embedding',
        'type=FLOAT32,dimension=${this.dimension},distance=COSINE'
      );
    `);
    this.db.exec(`
      SELECT vector_init(
        '${this.writingSampleTableName}',
        'embedding',
        'type=FLOAT32,dimension=${this.dimension},distance=COSINE'
      );
    `);
    this.db.exec(`
      SELECT vector_init(
        '${this.userMemoryTableName}',
        'embedding',
        'type=FLOAT32,dimension=${this.dimension},distance=COSINE'
      );
    `);
  }

  insert(embedding: Vector, label: string, relateId?: string) {
    if (embedding.length !== this.dimension) {
      throw new Error(`Embedding dimension must be ${this.dimension}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO ${this.tableName} (embedding, label, relateId, createTime)
      VALUES (?, ?, ?, ?)
    `);

    return stmt.run(
      this.toBlob(embedding),
      label,
      relateId,
      formatDate(new Date().getTime())
    );
  }

  quantize() {
    this.db.exec(`
      SELECT vector_quantize('${this.tableName}', 'embedding');
    `);
    this.db.exec(`
      SELECT vector_quantize_preload('${this.tableName}', 'embedding');
    `);
  }

  insertWritingSample(embedding: Vector, chunkText: string, profileId: number, chunkIndex = 0, keywords = "") {
    if (embedding.length !== this.dimension) {
      throw new Error(`Embedding dimension must be ${this.dimension}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO ${this.writingSampleTableName} (embedding, chunkText, profileId, chunkIndex, keywords, createTime)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      this.toBlob(embedding),
      chunkText,
      profileId,
      chunkIndex,
      keywords,
      formatDate(new Date().getTime())
    );
  }

  quantizeWritingSamples() {
    this.db.exec(`
      SELECT vector_quantize('${this.writingSampleTableName}', 'embedding');
    `);
    this.db.exec(`
      SELECT vector_quantize_preload('${this.writingSampleTableName}', 'embedding');
    `);
  }

  clearWritingSamples(profileId: number | string) {
    return this.db.prepare(`
      DELETE FROM ${this.writingSampleTableName} WHERE profileId = ?
    `).run(profileId);
  }

  countWritingSamples(profileId: number | string) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total FROM ${this.writingSampleTableName} WHERE profileId = ?
    `).get(profileId) as { total: number };
    return row?.total || 0;
  }

  searchWritingSamples(embedding: Vector, profileId: number | string, topK = 8) {
    if (embedding.length !== this.dimension) {
      throw new Error(`Query embedding dimension must be ${this.dimension}`);
    }

    const stmt = this.db.prepare(`
      SELECT e.id, e.chunkText, e.profileId, e.chunkIndex, e.keywords, v.distance
      FROM ${this.writingSampleTableName} AS e
      JOIN vector_quantize_scan('${this.writingSampleTableName}', 'embedding', vector_as_f32(?), ${topK}) AS v
      ON e.id = v.rowid
      WHERE e.profileId = ?
      ORDER BY v.distance ASC
    `);

    return stmt.all(this.toBlob(embedding), profileId);
  }

  search(embedding: Vector, topK = 20) {
    if (embedding.length !== this.dimension) {
      throw new Error(`Query embedding dimension must be ${this.dimension}`);
    }

    const stmt = this.db.prepare(`
      SELECT e.id, e.label, v.distance, e.relateId
      FROM embdingTable AS e
      JOIN vector_quantize_scan('embdingTable', 'embedding', vector_as_f32(?), ${topK}) AS v
      ON e.id = v.rowid;
    `);

    return stmt.all(this.toBlob(embedding));
  }

  insertMemory(embedding: Vector, userId: number, content: string, sessionId?: string, sourceMessageId?: number) {
    if (embedding.length !== this.dimension) {
      throw new Error(`Embedding dimension must be ${this.dimension}`);
    }
    const now = formatDate(new Date().getTime());
    const stmt = this.db.prepare(`
      INSERT INTO ${this.userMemoryTableName} (userId, sessionId, sourceMessageId, content, embedding, status, createTime, updateTime)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `);
    return stmt.run(userId, sessionId || null, sourceMessageId || null, content, this.toBlob(embedding), now, now);
  }

  updateMemoryContent(id: number, embedding: Vector, content: string) {
    if (embedding.length !== this.dimension) {
      throw new Error(`Embedding dimension must be ${this.dimension}`);
    }
    const now = formatDate(new Date().getTime());
    return this.db.prepare(`
      UPDATE ${this.userMemoryTableName} SET content = ?, embedding = ?, updateTime = ? WHERE id = ?
    `).run(content, this.toBlob(embedding), now, id);
  }

  softDeleteMemory(id: number) {
    const now = formatDate(new Date().getTime());
    return this.db.prepare(`
      UPDATE ${this.userMemoryTableName} SET status = 'deleted', updateTime = ? WHERE id = ?
    `).run(now, id);
  }

  countUserMemories(userId: number) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total FROM ${this.userMemoryTableName} WHERE userId = ? AND status = 'active'
    `).get(userId) as { total: number };
    return row?.total || 0;
  }

  getActiveMemories(userId: number): { id: number; content: string }[] {
    return this.db.prepare(`
      SELECT id, content FROM ${this.userMemoryTableName}
      WHERE userId = ? AND status = 'active'
      ORDER BY id ASC
    `).all(userId) as { id: number; content: string }[];
  }

  /** 批量摘要合并：把 oldIds 标记为 deleted，用新的合并事实替换（各自新建记录） */
  replaceUserMemories(userId: number, oldIds: number[], newEntries: { fact: string; embedding: Vector }[]) {
    for (const entry of newEntries) {
      if (entry.embedding.length !== this.dimension) {
        throw new Error(`Embedding dimension must be ${this.dimension}`);
      }
    }
    const now = formatDate(new Date().getTime());
    const softDelete = this.db.prepare(`
      UPDATE ${this.userMemoryTableName} SET status = 'deleted', updateTime = ? WHERE id = ?
    `);
    const insert = this.db.prepare(`
      INSERT INTO ${this.userMemoryTableName} (userId, sessionId, sourceMessageId, content, embedding, status, createTime, updateTime)
      VALUES (?, NULL, NULL, ?, ?, 'active', ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const id of oldIds) softDelete.run(now, id);
      for (const entry of newEntries) {
        insert.run(userId, entry.fact, this.toBlob(entry.embedding), now, now);
      }
    });
    tx();
  }

  searchUserMemories(embedding: Vector, userId: number, topK = 5) {
    if (embedding.length !== this.dimension) {
      throw new Error(`Query embedding dimension must be ${this.dimension}`);
    }
    const scanLimit = Math.max(topK * 3, 10);
    const stmt = this.db.prepare(`
      SELECT e.id, e.content, v.distance
      FROM ${this.userMemoryTableName} AS e
      JOIN vector_quantize_scan('${this.userMemoryTableName}', 'embedding', vector_as_f32(?), ${scanLimit}) AS v
      ON e.id = v.rowid
      WHERE e.userId = ? AND e.status = 'active'
      ORDER BY v.distance ASC
      LIMIT ?
    `);
    return stmt.all(this.toBlob(embedding), userId, topK);
  }

  quantizeUserMemories() {
    this.db.exec(`
      SELECT vector_quantize('${this.userMemoryTableName}', 'embedding');
    `);
    this.db.exec(`
      SELECT vector_quantize_preload('${this.userMemoryTableName}', 'embedding');
    `);
  }

  getDb() {
    return this.db;
  }

  getDimension() {
    return this.dimension;
  }
}

export default VectorDB;
