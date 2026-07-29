import { BaseMemory } from "@langchain/core/memory";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

export class DBMemory extends BaseMemory {
    constructor(private db, private sessionId: string) {
        super();
    }

    get memoryKeys() {
        return ["chat_history"];
    }

    async loadMemoryVariables() {
        // 从数据库查最近 N 条对话
        const rows = this.db.prepare(`
      SELECT role, content
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT 10
    `).all(this.sessionId);
        // 转成 LangChain Message
        const messages = rows.reverse().map(r =>
            r.role === "user"
                ? new HumanMessage(r.content)
                : new AIMessage(r.content)
        );

        return { chat_history: messages };
    }

    async saveContext(inputValues, outputValues) {
        const userMsg = inputValues.input;
        const aiMsg = outputValues.output;
        console.log(userMsg,"userMsg")
        console.log(aiMsg,"aiMsg")
        this.db.prepare(`
      INSERT INTO chat_messages (sessionId, role, content)
      VALUES (?, ?, ?), (?, ?, ?)
    `).run(
            this.sessionId, "user", userMsg,
            this.sessionId, "ai", aiMsg
        );
    }
}
