// 定时任务：独立的轮询调度器，与"AI 超级员工"（deepAgentServer）的会话/流式/人工审批机制解耦，
// 但共享同一份"超级员工"模型配置，并复用同一套限定工作目录的安全工具（agentTools.js）。
// 每次触发是一次独立、无会话状态的一次性执行：模型可以在任务绑定的工作目录内读写文件，
// 如果任务显式开启了"允许执行命令"，还可以在同一目录内跑 shell 命令——但不会像超级员工那样弹窗
// 等人工审批（无人值守场景下等审批=卡死），安全性改为靠：目录限定 + 危险命令黑名单（复用
// validateConfinedCommand）+ 超时/输出上限 + 最小触发间隔 + 连续失败熔断 + 完整步骤审计日志来兜底。
import { BrowserWindow, app } from 'electron';
import * as fs from 'fs-extra';
import * as path from 'path';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { getDB } from '../utils/getDb';
import { getUUid, formatDate } from '../utils/common';
import { ModelFactory } from '../model/modelFactory';
import { ConfigManager } from '../config/configmangger';
import { DataPathManager } from '../utils/dataPathManager';
import {
  createExecuteTool,
  createWorkdirReadTools,
  createWorkdirWriteTool,
  createWorkdirGenerateWordTool,
  createNotifyTool
} from '../model/agentTools';
import { searchByOnLine, parseWebPage, getNativeSearchTools } from '../model/tools';
import { showDesktopNotification } from '../utils/notifier';

// 与 deepAgentServer/index.js 相同的写法：不缓存 db 引用，每次都经代理取当前的 getDB().db，
// 避免 embedding 维度变化导致 VectorDB 被重建后仍持有旧连接。
const db = new Proxy({}, { get: (_target, prop) => (getDB() as any).db[prop] }) as any;

export type ScheduleType = 'interval' | 'daily';

export interface ScheduledTaskRow {
  id: string;
  name: string;
  instruction: string;
  scheduleType: ScheduleType;
  intervalMinutes: number | null;
  dailyTime: string | null;
  workDir: string | null;
  allowCommandExecution: number;
  consecutiveFailures: number;
  learnedNotes: string | null;
  enabled: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: 'success' | 'fail' | null;
  lastError: string | null;
  lastResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskInput {
  name: string;
  instruction: string;
  scheduleType: ScheduleType;
  intervalMinutes?: number | null;
  dailyTime?: string | null;
  workDir?: string | null;
  allowCommandExecution?: boolean;
}

const POLL_INTERVAL_MS = 30_000;
const MAX_TOOL_ROUNDS = 15;
const FAILURE_CIRCUIT_BREAKER = 3;
// 一旦任务开启"允许执行命令"，无人值守下的最小触发间隔下限（分钟），防止配置失误导致命令被高频反复执行
const MIN_INTERVAL_MINUTES_WITH_COMMAND = 5;
const LEARNED_NOTES_MAX_CHARS = 1600;

// 模型跑满最大轮次也没给出最终结果：不算"调用完模型就算完成"，判定为执行失败，
// 且不触发经验沉淀（这种"没跑完"的情况没有值得总结的成功经验，也不该被当成一次正常失败去学）
class RoundLimitExceededError extends Error {}

// 能产出真实文件的工具名单：模型的最终回复如果声称"已生成/已保存文件"，必须真的调用过这里面的工具，
// 否则就是嘴上说完成、实际什么都没做——不能直接采信文字描述
const FILE_PRODUCING_TOOLS = new Set(['write_workdir_file', 'generateWord']);
const FILE_CLAIM_RE = /(已生成|已写入|已保存|已创建|已输出|生成了|写入了|保存了|创建了).{0,20}(文件|文档|报告|\.docx?|\.pdf|\.md|\.txt|\.json)/i;

// 指令里明确要求 Word/PDF 格式：光靠 prompt 提示不够可靠（软性建议模型可能不遵守），
// 必须真的检测出"要求的格式 vs 实际调用的工具"对不上，强制打回去重跑，而不是任由它拿 write_workdir_file 写个 .md 糊弄过去
const REQUIRES_DOC_FORMAT_RE = /\b(word|docx?|pdf)\b|生成.{0,6}(word|文档|报告)|输出.{0,6}(word|文档)|导出.{0,6}(word|文档)/i;

// 模型声称"已经提醒/通知你了"，但可能是用 execute 跑了个不可靠的命令行通知（经常不会真的弹出来），
// 而不是调用 send_notification——同样不能只信文字描述，要看有没有真的成功调用过这个工具
const NOTIFY_CLAIM_RE = /(已提醒|已通知|已发送.{0,4}(提醒|通知)|提醒你|通知你)/i;

export class ScheduledTaskManager {
  private static instance: ScheduledTaskManager;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runningIds = new Set<string>();
  private initialized = false;

  static getInstance(): ScheduledTaskManager {
    if (!ScheduledTaskManager.instance) {
      ScheduledTaskManager.instance = new ScheduledTaskManager();
    }
    return ScheduledTaskManager.instance;
  }

  private ensureTable() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        instruction TEXT NOT NULL,
        scheduleType TEXT NOT NULL,
        intervalMinutes INTEGER,
        dailyTime TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        nextRunAt INTEGER,
        lastRunAt INTEGER,
        lastStatus TEXT,
        lastError TEXT,
        lastResult TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    this.ensureColumn('scheduled_tasks', 'workDir', 'workDir TEXT');
    this.ensureColumn('scheduled_tasks', 'allowCommandExecution', 'allowCommandExecution INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('scheduled_tasks', 'consecutiveFailures', 'consecutiveFailures INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('scheduled_tasks', 'learnedNotes', 'learnedNotes TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        startedAt INTEGER NOT NULL,
        finishedAt INTEGER,
        status TEXT,
        resultText TEXT,
        errorText TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task ON scheduled_task_runs(taskId, startedAt DESC)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_task_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        eventType TEXT NOT NULL,
        toolName TEXT,
        content TEXT,
        payloadJson TEXT,
        createdAt INTEGER NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_task_steps_run ON scheduled_task_steps(runId, seq)`);
  }

  private ensureColumn(table: string, columnName: string, columnDefSql: string) {
    const cols: any[] = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === columnName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefSql}`);
    }
  }

  // 应用启动时调用一次；内部有 initialized 保护，重复调用（如 macOS 多次 createWindow）是安全的空操作
  init() {
    if (this.initialized) return;
    this.ensureTable();
    this.initialized = true;

    const rows: ScheduledTaskRow[] = db
      .prepare(`SELECT * FROM scheduled_tasks WHERE enabled = 1 AND nextRunAt IS NULL`)
      .all();
    rows.forEach((row) => {
      const nextRunAt = this.computeNextRunAt(row);
      db.prepare(`UPDATE scheduled_tasks SET nextRunAt = ? WHERE id = ?`).run(nextRunAt, row.id);
    });

    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.initialized = false;
  }

  private computeNextRunAt(
    row: Pick<ScheduledTaskRow, 'scheduleType' | 'intervalMinutes' | 'dailyTime'>,
    from: number = Date.now()
  ): number {
    if (row.scheduleType === 'interval') {
      const minutes = Math.max(1, Number(row.intervalMinutes) || 1);
      return from + minutes * 60_000;
    }
    const [h, m] = String(row.dailyTime || '00:00')
      .split(':')
      .map((n) => parseInt(n, 10) || 0);
    const next = new Date(from);
    next.setHours(h, m, 0, 0);
    if (next.getTime() <= from) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  // 开启"允许执行命令"的任务，间隔类型的间隔不能低于安全下限，防止无人值守下被高频反复执行命令
  private clampIntervalForSafety(intervalMinutes: number | null | undefined, allowCommandExecution: boolean): number {
    const minutes = Math.max(1, Number(intervalMinutes) || 1);
    return allowCommandExecution ? Math.max(minutes, MIN_INTERVAL_MINUTES_WITH_COMMAND) : minutes;
  }

  private resolveWorkDir(row: Pick<ScheduledTaskRow, 'id' | 'workDir'>): string {
    if (row.workDir && fs.existsSync(row.workDir) && fs.statSync(row.workDir).isDirectory()) {
      return row.workDir;
    }
    const dataDir = DataPathManager.getInstance().getDataDir() || app.getPath('userData');
    const dir = path.join(dataDir, 'scheduledTasks', row.id);
    fs.ensureDirSync(dir);
    return dir;
  }

  private tick() {
    const now = Date.now();
    const due: ScheduledTaskRow[] = db
      .prepare(`SELECT * FROM scheduled_tasks WHERE enabled = 1 AND nextRunAt IS NOT NULL AND nextRunAt <= ?`)
      .all(now);
    due.forEach((row) => {
      if (this.runningIds.has(row.id)) return;
      this.runTask(row).catch(() => {});
    });
  }

  private notifyRenderer(payload: any) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('scheduledTask:update', payload);
    });
  }

  private logStep(runId: string, seq: number, eventType: string, toolName: string | null, content: string, payload?: any) {
    db.prepare(
      `INSERT INTO scheduled_task_steps (runId, seq, eventType, toolName, content, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(runId, seq, eventType, toolName, content, payload !== undefined ? JSON.stringify(payload) : null, Date.now());
  }

  // 通用版"经验沉淀"：跑完之后单独调一次模型，把这次的完整步骤记录跟已有经验合并提炼，
  // 存起来给下次执行参考（类似 Skill 的思路，但是任务私有、按任务自己积累）。
  // 只有这次执行真的调用过工具（stepLog 非空）才做，避免纯聊天的任务也白花一次调用；
  // 总结调用本身失败时静默忽略、保留旧经验，不能因为这个锦上添花的步骤影响主任务的成功/失败判定。
  private async distillLearnedNotes(
    taskId: string,
    instruction: string,
    existingNotes: string | null,
    stepLog: string[],
    succeeded: boolean
  ) {
    if (!stepLog.length) return;
    try {
      const model = ModelFactory.getChatModel();
      // 必须把任务原始指令带上：不然总结模型只能看到"工具调用有没有报错"，看不出结果是否真的满足了
      // 任务要求（比如任务要 Word，实际却只生成了 md——过程不报错，但明显没做对），
      // 会把"technically 没出错"误当成"值得沉淀的成功经验"，反而把错误做法当经验固化下来，越学越偏。
      const prompt = `你在帮一个会被反复执行的自动化任务积累经验，目的是让它下次执行时更顺利、少走弯路、少浪费工具调用次数。

任务原始指令（判断这次执行是否真的做对了，要以此为准，不能只看有没有报错）：
${instruction}

已有经验：${existingNotes || '无'}

这次执行过程记录本身${succeeded ? '未报错' : '报错/失败'}，完整步骤记录：
${stepLog.join('\n')}

请先对照"任务原始指令"判断这次执行的结果是否真的满足了要求（比如指令要求生成 Word 文档，实际却只生成了 md/txt，即使过程没报错，也属于没有做对，不能当成正确经验）。
然后结合"已有经验"和这次的判断结果，输出更新后的经验摘要，要求：
1. 只保留下次执行这个任务时用得上的结论性经验（比如什么参数/方法/写法真正满足了要求、什么方法看似能跑但其实没做对及原因），不要复述过程细节。
2. 如果这次的做法没有真正满足任务要求，必须在经验里明确指出"这种做法不对/不够，应该……"，不能当成成功经验保留或强化。
3. 跟已有经验重复或已过时/已被证明错误的内容要合并、去重、纠正、覆盖，不要越攒越长。
4. 如果这次没有值得记录的新经验，原样保留已有经验即可，不要编造。
5. 中文，控制在 ${LEARNED_NOTES_MAX_CHARS / 2} 字以内。
6. 只输出经验摘要本身，不要加多余的说明文字。`;
      const result = await model.invoke([{ role: 'user', content: prompt }]);
      const notes = String((result as any)?.content ?? '').trim().slice(0, LEARNED_NOTES_MAX_CHARS);
      if (notes) {
        db.prepare(`UPDATE scheduled_tasks SET learnedNotes = ? WHERE id = ?`).run(notes, taskId);
        this.notifyRenderer({ id: taskId, learnedNotes: notes });
      }
    } catch {
      // 经验总结失败：静默忽略，保留旧的 learnedNotes 不动
    }
  }

  async runTask(row: ScheduledTaskRow) {
    this.runningIds.add(row.id);
    const runId = getUUid();
    const startedAt = Date.now();
    db.prepare(`INSERT INTO scheduled_task_runs (id, taskId, startedAt, status) VALUES (?, ?, ?, 'running')`).run(
      runId,
      row.id,
      startedAt
    );
    // 立刻推一次"执行中"状态：即使这次调用要跑很久（模型多轮工具调用），页面也能马上看到"正在执行"，
    // 而不是在跑完之前一直显示上一次（甚至"尚未执行"）的旧状态，导致用户分不清到底有没有跑
    this.notifyRenderer({ id: row.id, isRunning: true, lastStatus: 'running' });

    let seq = 0;
    const stepLog: string[] = [];
    try {
      const agentCfg = ConfigManager.getInstance().getConfig().agent;
      const model = ModelFactory.getChatModel({
        customConfig: { provider: agentCfg.provider, modelName: agentCfg.modelName, temperature: agentCfg.temperature },
        tag: 'scheduledTask'
      });

      const workDir = this.resolveWorkDir(row);
      const getWorkDir = async () => workDir;
      const { list_workdir, read_workdir_file } = createWorkdirReadTools({ getSessionWorkDir: getWorkDir });
      const { write_workdir_file } = createWorkdirWriteTool({ getSessionWorkDir: getWorkDir });
      // 用工作目录感知版的 generateWord：生成后直接在主进程内把文件从服务端目录拷贝进任务工作目录，
      // 不再返回下载链接、不需要模型自己想办法把文件弄进工作目录（这就是之前反复生成 md 而不是 Word 的根因）
      const { generateWord } = createWorkdirGenerateWordTool({ getSessionWorkDir: getWorkDir });
      const { send_notification } = createNotifyTool();
      // 联网搜索 / 网页解析 / 报告生成 / 发桌面通知：都是无会话状态的独立工具（不像 execute 需要工作目录确认），
      // 且都没有真实的破坏性副作用（不会弹出可见的浏览器窗口、不会改文件系统之外的东西），
      // 风险跟"读写工作目录文件"一个级别，默认直接开放
      // 原生联网搜索复用对话页的 chat.nativeSearch 开关（同一个开关同一份行为），但按本次实际调用的
      // 定时任务模型（agentCfg.modelName）判断厂商，命中则用厂商原生搜索替代自建爬虫，逻辑与
      // chatServer/index.js 的 agentChat 路由保持一致
      const chatCfg = ConfigManager.getInstance().getConfig()?.chat || {};
      const nativeSearchTools = chatCfg.nativeSearch ? getNativeSearchTools(agentCfg.modelName) : [];
      const tools: any[] = [
        list_workdir,
        read_workdir_file,
        write_workdir_file,
        ...(nativeSearchTools.length ? nativeSearchTools : [searchByOnLine, parseWebPage]),
        generateWord,
        send_notification
      ];
      if (row.allowCommandExecution) {
        const { execute } = createExecuteTool({ getSessionWorkDir: getWorkDir });
        tools.push(execute);
      }
      const toolByName = new Map(tools.map((t) => [t.name, t]));
      const boundModel = model.bindTools(tools);

      // 执行前把当前时间、以及历史沉淀的经验都写进上下文：时间避免模型不知道"今天"是哪天，
      // 经验则是让它少走上次已经踩过的坑（比如上次发现某个引擎/写法不管用）
      const now0 = new Date();
      const weekday = ['日', '一', '二', '三', '四', '五', '六'][now0.getDay()];
      const timeContext = `当前时间：${formatDate(now0)}（星期${weekday}）\n\n`;
      const notesContext = row.learnedNotes
        ? `已知经验（来自历史执行，如与当前实际情况冲突，以实际情况为准）：\n${row.learnedNotes}\n\n`
        : '';
      // 这条务必分清楚"generateWord 不可替代"和"write_workdir_file 只是补充留档"，之前措辞不够精确，
      // 模型误以为可以直接用 write_workdir_file 写个 .md 代替 Word/PDF——那样格式根本不对。
      // 注：generateWord 现在生成后会自动落到工作目录（不再是下载链接），不需要额外担心"怎么把文件弄进工作目录"。
      const docToolHint =
        '重要提示：如果任务明确要求生成 Word/PDF 等文档，必须调用 generateWord 工具生成真正的 .docx/.pdf 文件（生成后会自动保存到你的工作目录），' +
        '不能用 write_workdir_file 写一个 .md/.txt 来代替——那样文件格式跟要求的不一样，不算完成任务。' +
        'write_workdir_file 只用于：任务本身就是要写纯文本/markdown 内容，或者在 generateWord 生成完之后，' +
        '想在工作目录里额外留一份内容副本——这只是锦上添花，不能替代 generateWord 本身。\n\n';
      // 只有开了命令执行的任务才需要这条：提醒用户必须走 send_notification，不能靠 execute 跑命令行糊弄，
      // 更不能自己去操作系统层面建一个独立于本程序的计划任务/服务——那种东西关掉本程序也不会消失，
      // 只会变成一个用户不知情、脱离管控的系统改动，是被严格禁止的高危操作。
      const notifyHint = row.allowCommandExecution
        ? '如果需要提醒用户，必须调用 send_notification 工具，不要用 execute 执行 msg / PowerShell toast 之类的命令行方式弹通知——' +
          '这类命令在无人交互的后台进程里经常不会真的弹出任何东西，即使命令本身执行不报错，也不能算完成提醒。' +
          '严禁通过 execute 创建任何系统级的计划任务/定时任务/服务（比如 schtasks、Task Scheduler、systemd 等），' +
          '这类操作会脱离本程序管控、独立存在（哪怕本程序关闭也不会消失），已被禁止执行。如果任务需要"每次到点都提醒一下"，' +
          '本次执行时调用 send_notification 发一次通知就够了——因为这个任务本身就是被定时反复触发的，不需要也不允许你自己再另外创建一层系统级调度。\n\n'
        : '';
      const messages: any[] = [new HumanMessage(timeContext + notesContext + docToolHint + notifyHint + row.instruction)];
      let finalText = '';
      let hitRoundLimit = true;
      let calledFileWriteTool = false; // 这次执行有没有真的调用过能产出文件的工具
      let calledGenerateWordOk = false; // 有没有真的成功调用过 generateWord（专门针对"指令要求 Word/PDF"这条校验）
      let calledNotifyOk = false; // 有没有真的成功调用过 send_notification
      const requiresDocFormat = REQUIRES_DOC_FORMAT_RE.test(row.instruction);

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await boundModel.invoke(messages);
        messages.push(response);
        const toolCalls = (response as any).tool_calls || [];
        if (!toolCalls.length) {
          const candidateText = String((response as any)?.content ?? '');
          if (FILE_CLAIM_RE.test(candidateText) && !calledFileWriteTool) {
            // 模型嘴上说"已生成/已保存文件"，但这次执行压根没调用过写文件/生成文档的工具——不能直接采信，
            // 打回去让它真正执行；不 break，继续用剩余轮次给它机会，如果始终不动手，最终会耗尽轮次
            // 落到上面已有的"跑满轮次未完成=失败"分支，不需要另外单独处理
            seq += 1;
            this.logStep(runId, seq, 'warning', null, '模型声称已生成文件但未检测到实际的写文件工具调用，已打回要求真正执行');
            stepLog.push('[提醒] 模型声称已生成文件但未实际调用写文件工具，已要求其真正执行'.slice(0, 500));
            messages.push(
              new HumanMessage(
                '你在回复里提到已经生成/保存了文件，但本次执行没有检测到你调用 write_workdir_file 或 generateWord 这类工具的记录。' +
                  '如果确实需要产出文件，请现在立即调用对应工具真正执行，不要只在文字里描述已完成。'
              )
            );
            continue;
          }
          if (requiresDocFormat && !calledGenerateWordOk) {
            // 指令明确要 Word/PDF，但这次执行没有成功调用过 generateWord——光靠前面的 prompt 提示不够可靠，
            // 必须硬性打回去，不能任由它拿 write_workdir_file 写个 .md/.txt 就蒙混过关
            seq += 1;
            this.logStep(runId, seq, 'warning', null, '任务要求 Word/PDF 格式，但未检测到成功的 generateWord 调用，已打回要求重新执行');
            stepLog.push('[提醒] 任务要求 Word/PDF 格式，但未调用 generateWord，已要求其重新执行'.slice(0, 500));
            messages.push(
              new HumanMessage(
                '任务明确要求生成 Word/PDF 格式的文档，但本次执行没有检测到你成功调用 generateWord 工具。' +
                  '请现在立即调用 generateWord 生成正确格式的文件，不要用 write_workdir_file 写 .md/.txt 代替。'
              )
            );
            continue;
          }
          if (NOTIFY_CLAIM_RE.test(candidateText) && !calledNotifyOk) {
            // 模型嘴上说"已经提醒/通知你了"，但没有真的成功调用过 send_notification——
            // 很可能是用 execute 跑了个不可靠的命令行通知，命令没报错但也没真的弹出来
            seq += 1;
            this.logStep(runId, seq, 'warning', null, '模型声称已提醒/通知用户但未检测到成功的 send_notification 调用，已打回要求真正执行');
            stepLog.push('[提醒] 模型声称已提醒/通知但未调用 send_notification，已要求其重新执行'.slice(0, 500));
            messages.push(
              new HumanMessage(
                '你在回复里提到已经提醒/通知用户了，但本次执行没有检测到你成功调用 send_notification 工具。' +
                  '请现在立即调用 send_notification 真正发送系统通知，不要用 execute 执行命令行方式代替。'
              )
            );
            continue;
          }
          finalText = candidateText;
          hitRoundLimit = false;
          break;
        }
        for (const call of toolCalls) {
          seq += 1;
          const callArgsText = JSON.stringify(call.args ?? {});
          this.logStep(runId, seq, 'tool_call', call.name, callArgsText, call.args);
          stepLog.push(`[调用工具] ${call.name} ${callArgsText}`.slice(0, 500));
          let resultText: string;
          try {
            const toolFn = toolByName.get(call.name);
            if (!toolFn) {
              resultText = `未知工具：${call.name}`;
            } else {
              const rawResult = await toolFn.invoke(call.args);
              // 工具返回值不一定是字符串（比如 webSearch/parseWebPage 返回结构化对象）：
              // 直接 String() 会变成毫无信息的 "[object Object]"，模型什么都看不到只能瞎猜/反复重试。
              // 是字符串就直接用，不是字符串就序列化成 JSON 让模型能读到真实字段内容。
              resultText = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
            }
          } catch (err: any) {
            resultText = `工具执行出错：${err?.message || err}`;
          }
          // 只有真的调用成功（工具自己没返回 ❌ 开头的失败提示）才算数，避免"调用了但写失败"也被当成已产出文件
          if (FILE_PRODUCING_TOOLS.has(call.name) && !resultText.trim().startsWith('❌')) {
            calledFileWriteTool = true;
          }
          if (call.name === 'generateWord' && !resultText.includes('生成文件失败')) {
            calledGenerateWordOk = true;
          }
          if (call.name === 'send_notification' && !resultText.trim().startsWith('❌')) {
            calledNotifyOk = true;
          }
          seq += 1;
          this.logStep(runId, seq, 'tool_result', call.name, resultText);
          stepLog.push(`[工具结果] ${call.name} ${resultText}`.slice(0, 500));
          messages.push(new ToolMessage({ content: resultText, tool_call_id: call.id }));
        }
      }

      if (hitRoundLimit) {
        // 跑满轮次也没拿到模型的最终结果，不是"调用完模型就算完成"——按失败处理，
        // 抛出去交给下面统一的失败分支处理（状态标失败、计入连续失败熔断、不触发经验沉淀）
        throw new RoundLimitExceededError(
          `已达到单次执行最大步数上限（${MAX_TOOL_ROUNDS} 轮工具调用），任务未能在限定轮次内完成，判定为执行失败`
        );
      }

      seq += 1;
      this.logStep(runId, seq, 'final', null, finalText);

      const now = Date.now();
      const nextRunAt = this.computeNextRunAt(row, now);
      const resultText = finalText.slice(0, 4000);
      db.prepare(`UPDATE scheduled_task_runs SET finishedAt = ?, status = 'success', resultText = ? WHERE id = ?`).run(
        now,
        resultText,
        runId
      );
      db.prepare(
        `UPDATE scheduled_tasks SET lastRunAt = ?, lastStatus = 'success', lastResult = ?, lastError = NULL, nextRunAt = ?, consecutiveFailures = 0, updatedAt = ? WHERE id = ?`
      ).run(now, resultText, nextRunAt, formatDate(now), row.id);
      await this.distillLearnedNotes(row.id, row.instruction, row.learnedNotes, stepLog, true);
      this.notifyRenderer({
        id: row.id,
        isRunning: false,
        lastRunAt: now,
        lastStatus: 'success',
        lastResult: resultText,
        nextRunAt,
        consecutiveFailures: 0
      });
    } catch (err: any) {
      const now = Date.now();
      const nextRunAt = this.computeNextRunAt(row, now);
      const errMsg = String(err?.message || err).slice(0, 2000);
      seq += 1;
      this.logStep(runId, seq, 'error', null, errMsg);
      db.prepare(`UPDATE scheduled_task_runs SET finishedAt = ?, status = 'fail', errorText = ? WHERE id = ?`).run(
        now,
        errMsg,
        runId
      );

      const consecutiveFailures = (Number(row.consecutiveFailures) || 0) + 1;
      const shouldDisable = consecutiveFailures >= FAILURE_CIRCUIT_BREAKER;
      db.prepare(
        `UPDATE scheduled_tasks SET lastRunAt = ?, lastStatus = 'fail', lastError = ?, nextRunAt = ?, consecutiveFailures = ?, enabled = ?, updatedAt = ? WHERE id = ?`
      ).run(now, errMsg, nextRunAt, consecutiveFailures, shouldDisable ? 0 : row.enabled, formatDate(now), row.id);
      // 跑满轮次没完成的情况不触发经验沉淀：这种"没跑完"本身不是一次值得总结的失败经验
      if (!(err instanceof RoundLimitExceededError)) {
        stepLog.push(`[出错] ${errMsg}`.slice(0, 500));
        await this.distillLearnedNotes(row.id, row.instruction, row.learnedNotes, stepLog, false);
      }
      this.notifyRenderer({
        id: row.id,
        isRunning: false,
        lastRunAt: now,
        lastStatus: 'fail',
        lastError: errMsg,
        nextRunAt,
        consecutiveFailures,
        enabled: shouldDisable ? 0 : row.enabled,
        autoDisabled: shouldDisable
      });
      // 执行失败是"哪怕没开着界面也该让人知道"的场景，弹一个系统桌面通知；
      // 熔断自动停用时用更醒目的标题，跟普通失败区分开
      showDesktopNotification(
        shouldDisable ? '定时任务已自动停用' : '定时任务执行失败',
        shouldDisable
          ? `任务「${row.name}」连续失败 ${consecutiveFailures} 次，已自动停用，请检查后重新启用`
          : `任务「${row.name}」执行失败：${errMsg.slice(0, 100)}`
      );
    } finally {
      this.runningIds.delete(row.id);
    }
  }

  list(): (ScheduledTaskRow & { isRunning: boolean })[] {
    this.ensureTable();
    const rows: ScheduledTaskRow[] = db.prepare(`SELECT * FROM scheduled_tasks ORDER BY createdAt DESC`).all();
    // isRunning 来自内存里的运行中任务集合（服务端真实状态），而不是渲染进程本地状态——
    // 这样即使页面被切走再切回来（组件重新挂载、本地状态丢失），刷新列表也能看到任务其实还在跑，
    // 不会被上一次的旧状态（甚至"尚未执行"）误导
    return rows.map((row) => ({ ...row, isRunning: this.runningIds.has(row.id) }));
  }

  listRuns(taskId: string, limit = 20) {
    this.ensureTable();
    return db
      .prepare(`SELECT * FROM scheduled_task_runs WHERE taskId = ? ORDER BY startedAt DESC LIMIT ?`)
      .all(taskId, limit);
  }

  getRunSteps(runId: string) {
    this.ensureTable();
    return db.prepare(`SELECT * FROM scheduled_task_steps WHERE runId = ? ORDER BY seq ASC`).all(runId);
  }

  create(input: ScheduledTaskInput): string {
    this.ensureTable();
    const id = getUUid();
    const now = Date.now();
    const nowStr = formatDate(now);
    const allowCommandExecution = !!input.allowCommandExecution;
    const intervalMinutes =
      input.scheduleType === 'interval' ? this.clampIntervalForSafety(input.intervalMinutes, allowCommandExecution) : null;
    const nextRunAt = this.computeNextRunAt(
      { scheduleType: input.scheduleType, intervalMinutes, dailyTime: input.dailyTime ?? null },
      now
    );
    db.prepare(
      `INSERT INTO scheduled_tasks (id, name, instruction, scheduleType, intervalMinutes, dailyTime, workDir, allowCommandExecution, enabled, nextRunAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      id,
      input.name,
      input.instruction,
      input.scheduleType,
      intervalMinutes,
      input.dailyTime ?? null,
      input.workDir ?? null,
      allowCommandExecution ? 1 : 0,
      nextRunAt,
      nowStr,
      nowStr
    );
    return id;
  }

  update(id: string, input: Partial<ScheduledTaskInput>) {
    this.ensureTable();
    const row: ScheduledTaskRow = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id);
    if (!row) throw new Error('任务不存在');
    const allowCommandExecution = input.allowCommandExecution ?? !!row.allowCommandExecution;
    const merged: ScheduledTaskRow = {
      ...row,
      ...input,
      intervalMinutes: input.intervalMinutes ?? row.intervalMinutes,
      dailyTime: input.dailyTime ?? row.dailyTime,
      workDir: input.workDir !== undefined ? input.workDir : row.workDir
    } as ScheduledTaskRow;
    const intervalMinutes =
      merged.scheduleType === 'interval' ? this.clampIntervalForSafety(merged.intervalMinutes, allowCommandExecution) : null;
    const nextRunAt = this.computeNextRunAt({ ...merged, intervalMinutes }, Date.now());
    db.prepare(
      `UPDATE scheduled_tasks SET name=?, instruction=?, scheduleType=?, intervalMinutes=?, dailyTime=?, workDir=?, allowCommandExecution=?, nextRunAt=?, updatedAt=? WHERE id=?`
    ).run(
      merged.name,
      merged.instruction,
      merged.scheduleType,
      intervalMinutes,
      merged.dailyTime ?? null,
      merged.workDir ?? null,
      allowCommandExecution ? 1 : 0,
      nextRunAt,
      formatDate(Date.now()),
      id
    );
  }

  toggle(id: string, enabled: boolean) {
    this.ensureTable();
    const row: ScheduledTaskRow = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id);
    if (!row) throw new Error('任务不存在');
    // 用户手动重新启用时，把连续失败计数清零，给任务一个重新开始的机会
    const consecutiveFailures = enabled ? 0 : row.consecutiveFailures;
    const nextRunAt = enabled ? this.computeNextRunAt(row, Date.now()) : row.nextRunAt;
    db.prepare(`UPDATE scheduled_tasks SET enabled = ?, nextRunAt = ?, consecutiveFailures = ?, updatedAt = ? WHERE id = ?`).run(
      enabled ? 1 : 0,
      nextRunAt,
      consecutiveFailures,
      formatDate(Date.now()),
      id
    );
  }

  // 手动编辑/清空积累下来的经验（比如网站改版、网络环境变化导致老经验过时了）
  updateLearnedNotes(id: string, notes: string | null) {
    this.ensureTable();
    db.prepare(`UPDATE scheduled_tasks SET learnedNotes = ?, updatedAt = ? WHERE id = ?`).run(
      notes ? notes.slice(0, LEARNED_NOTES_MAX_CHARS) : null,
      formatDate(Date.now()),
      id
    );
  }

  remove(id: string) {
    this.ensureTable();
    db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
    const runIds: { id: string }[] = db.prepare(`SELECT id FROM scheduled_task_runs WHERE taskId = ?`).all(id);
    const deleteSteps = db.prepare(`DELETE FROM scheduled_task_steps WHERE runId = ?`);
    runIds.forEach((r) => deleteSteps.run(r.id));
    db.prepare(`DELETE FROM scheduled_task_runs WHERE taskId = ?`).run(id);
  }

  async runNow(id: string) {
    this.ensureTable();
    const row: ScheduledTaskRow = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id);
    if (!row) throw new Error('任务不存在');
    await this.runTask(row);
  }
}
