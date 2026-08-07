<template>
  <div class="write-style-page" v-loading="pageLoading">
    <div class="toolbar">
      <div>
        <div class="page-title">个人写作画像</div>
        <div class="page-subtitle">
          把写作、人工画像维护、好样本学习拆开，长期维护你自己的作者画像。
        </div>
      </div>
      <div class="toolbar-actions">
        <el-button type="primary" class="action-btn primary-btn" @click="goWrite">
          开始写作
        </el-button>
        <el-button class="action-btn secondary-btn" @click="openProfileDialog">
          维护画像
        </el-button>
        <el-button class="action-btn neon-btn" @click="openSampleDialog">
          <el-icon><Plus /></el-icon>
          增加样本
        </el-button>
      </div>
    </div>

    <div v-if="currentProfile" class="dashboard-grid">
      <section class="hero-card profile-card">
        <div class="hero-head">
          <div>
            <div class="hero-label">当前作者画像</div>
            <div class="hero-title">{{ currentProfile.title || "我的写作画像" }}</div>
          </div>
          <div class="hero-actions">
            <el-badge :value="feedbackCounts.total" :hidden="!feedbackCounts.total" class="feedback-badge">
              <el-button
                type="primary"
                class="action-btn primary-btn feedback-update-btn"
                :loading="feedbackListLoading"
                @click="openFeedbackListDialog"
              >
                从反馈更新画像
              </el-button>
            </el-badge>
            <el-button
              class="action-btn secondary-btn"
              :disabled="!profileHistory.length"
              @click="openHistoryDialog"
            >
              历史版本
            </el-button>
          </div>
        </div>

        <div class="meta-row">
          <div class="meta-chip" v-if="currentProfile.identity">
            <span class="meta-key">身份</span>
            <span class="meta-value">{{ currentProfile.identity }}</span>
          </div>
          <div class="meta-chip" v-if="currentProfile.scene">
            <span class="meta-key">场景</span>
            <span class="meta-value">{{ currentProfile.scene }}</span>
          </div>
          <div class="meta-chip">
            <span class="meta-key">最近更新时间</span>
            <span class="meta-value">
              {{ currentProfile.updateTime || currentProfile.createTime || "--" }}
            </span>
          </div>
        </div>

        <div class="summary-block">
          <div class="block-title">总画像</div>
          <div class="summary-text">
            {{ profileSummary || "先维护画像或增加样本，这里会逐步形成你的个人写作风格画像。" }}
          </div>
        </div>
      </section>

      <section class="side-column">
        <div class="info-card compact-card">
          <div class="block-title">常用表达</div>
          <div class="block-subtitle">优先展示你手动维护的表达；未维护时展示清洗后的样本提取结果。</div>
          <div v-if="currentProfile.preferredPhrases?.length" class="tag-list">
            <el-tag
              v-for="phrase in currentProfile.preferredPhrases"
              :key="phrase"
              size="small"
              effect="plain"
              type="success"
            >
              {{ phrase }}
            </el-tag>
          </div>
          <div v-else class="empty-mini">暂时还没有稳定的常用表达。</div>
        </div>

        <div class="info-card compact-card">
          <div class="block-title">避免表达</div>
          <div class="block-subtitle">这里会过滤掉任务条目、指标阈值这类非写作风格内容。</div>
          <div v-if="currentProfile.avoidPhrases?.length" class="tag-list">
            <el-tag
              v-for="phrase in currentProfile.avoidPhrases"
              :key="phrase"
              size="small"
              effect="plain"
              type="warning"
            >
              {{ phrase }}
            </el-tag>
          </div>
          <div v-else class="empty-mini">暂时还没有需要明确规避的表达。</div>
        </div>
      </section>

      <section class="info-card full-width">
        <div class="card-head">
          <div>
            <div class="block-title">样本维护</div>
            <div class="block-subtitle">
              每条样本都会独立提取摘要、写作手法、风格和核心思想；删除后只更新相似样本索引。
            </div>
          </div>
          <div class="sample-head-actions">
            <div class="sample-count-chip">{{ currentProfile.samples?.length || 0 }} 条样本</div>
            <el-button text type="primary" @click="openSampleDialog">继续增加样本</el-button>
          </div>
        </div>

        <template v-if="currentProfile.samples?.length">
          <div class="sample-list">
            <div v-for="sample in pagedSamples" :key="sample.id" class="sample-item">
              <div class="sample-item-head">
                <div class="sample-main">
                  <div class="sample-name">{{ sample.sourceName || "未命名样本" }}</div>
                  <div class="sample-meta">
                    {{ formatSourceType(sample.sourceType) }} · {{ sample.createTime || "--" }} ·
                    {{ sample.length || 0 }} 字
                  </div>
                </div>
                <el-button
                  text
                  type="danger"
                  class="sample-delete-btn"
                  :loading="deletingSampleId === sample.id"
                  :disabled="deletingSampleId === sample.id"
                  @click="confirmDeleteSample(sample)"
                >
                  删除
                </el-button>
              </div>
              <!-- <div class="sample-preview">{{ sample.preview || "该样本暂时无可展示预览。" }}</div> -->
              <div v-if="hasSampleAnalysis(sample)" class="sample-analysis">
                <div v-if="sample.analysisProfile?.summary" class="sample-analysis-row">
                  <span>摘要</span>
                  <p>{{ sample.analysisProfile.summary }}</p>
                </div>
                <div v-if="sample.analysisProfile?.writingTechniques?.length" class="sample-analysis-row">
                  <span>写作手法</span>
                  <div class="sample-tech-list">
                    <el-tag
                      v-for="technique in sample.analysisProfile.writingTechniques"
                      :key="technique"
                      size="small"
                      effect="plain"
                    >
                      {{ technique }}
                    </el-tag>
                  </div>
                </div>
                <div v-if="sample.analysisProfile?.writingStyle" class="sample-analysis-row">
                  <span>风格</span>
                  <p>{{ sample.analysisProfile.writingStyle }}</p>
                </div>
                <div v-if="sample.analysisProfile?.coreIdea" class="sample-analysis-row">
                  <span>核心思想</span>
                  <p>{{ sample.analysisProfile.coreIdea }}</p>
                </div>
              </div>
            </div>
          </div>

          <div v-if="sampleTotal > samplePageSize" class="sample-pagination">
            <el-pagination
              v-model:current-page="samplePage"
              :page-size="samplePageSize"
              :total="sampleTotal"
              layout="prev, pager, next"
              background
              small
            />
          </div>
        </template>

        <div v-else class="sample-empty">
          <div class="sample-empty-title">还没有写作样本</div>
          <div class="sample-empty-text">
            你可以上传文章、粘贴内容或添加网页链接。后续样本会用于检索相似写法，帮助 AI 更像你。
          </div>
        </div>
      </section>
    </div>

    <div v-else class="empty-panel">
      <el-empty description="还没有作者画像，先维护画像或增加样本。" />
      <div class="empty-actions">
        <el-button type="primary" class="primary-btn" @click="openProfileDialog">先维护画像</el-button>
        <el-button class="neon-btn" @click="openSampleDialog">
          <el-icon><Plus /></el-icon>
          增加样本
        </el-button>
      </div>
    </div>

    <el-dialog
      v-model="profileDialogVisible"
      title="维护作者画像"
      width="620px"
      class="neon-dialog"
      destroy-on-close
      @closed="resetProfileForm"
    >
      <el-form :model="profileForm" label-position="top" class="profile-form">
        <el-form-item label="总画像">
          <el-input
            v-model="profileForm.summary"
            type="textarea"
            :rows="4"
            class="glow-input"
            placeholder="描述你的核心写作风格，例如：语气平实克制，避免情绪化和首句定调，陈述可验证事实，以事实和数据支撑论点。"
            maxlength="200"
            show-word-limit
          />
          <div class="form-tip">
            保存时会自动把下方的身份、场景、常用/避免表达拼接到这段文字后面，不用在这里重复填写。
          </div>
        </el-form-item>
        <el-form-item label="画像名称">
          <el-input
            v-model="profileForm.title"
            class="glow-input"
            placeholder="例如：我的写作画像"
            clearable
          />
        </el-form-item>
        <el-form-item label="用户身份">
          <el-input
            v-model="profileForm.identity"
            class="glow-input"
            placeholder="例如：产品经理、老师、律师、自媒体作者"
            clearable
          />
        </el-form-item>
        <el-form-item label="常见写作场景">
          <el-input
            v-model="profileForm.scene"
            class="glow-input"
            placeholder="例如：工作汇报、公众号、发言稿、朋友圈"
            clearable
          />
        </el-form-item>
        <el-form-item label="希望保留的常用表达">
          <el-input
            v-model="profileForm.preferredPhrases"
            type="textarea"
            :rows="3"
            class="glow-input"
            placeholder="用逗号、分号或换行分隔，例如：先说结论、我更倾向于、值得一提的是"
          />
          <div class="form-tip">这里只填你想长期保留的固定表达，不用把整句任务描述贴进来。</div>
        </el-form-item>
        <el-form-item label="希望避免的表达">
          <el-input
            v-model="profileForm.avoidPhrases"
            type="textarea"
            :rows="3"
            class="glow-input"
            placeholder="例如：赋能、闭环、总而言之、值得一提的是"
          />
          <div class="form-tip">如果你不喜欢某些套话、空话或 AI 味表达，可以直接写在这里。</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="profileDialogVisible = false" class="cancel-btn">取消</el-button>
          <el-button type="primary" @click="saveProfile" :loading="profileSaving" class="confirm-btn">
            保存画像
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="feedbackListDialogVisible"
      title="反馈记录"
      width="820px"
      class="neon-dialog feedback-dialog"
      destroy-on-close
    >
      <div class="feedback-list-head">
        <div class="feedback-list-count">共 {{ feedbackListTotal }} 个会话待处理</div>
      </div>

      <div v-loading="feedbackListLoading" class="feedback-record-list">
        <div v-if="!feedbackList.length" class="empty-mini">暂时还没有待处理的写作反馈。</div>
        <div v-for="item in feedbackList" :key="item.sessionKey" class="feedback-record-item">
          <div class="feedback-record-main">
            <div class="feedback-record-meta">
              <el-tag size="small" effect="plain">{{ item.feedbackCount }} 条反馈</el-tag>
              <el-tag
                size="small"
                :type="item.avgScore >= 8 ? 'success' : item.avgScore <= 6 ? 'danger' : 'info'"
              >
                均分 {{ item.avgScore }}
              </el-tag>
              <span class="feedback-record-time">{{ item.updateTime }}</span>
            </div>
            <div class="feedback-record-text">{{ item.latestPreview || "无修改意见" }}</div>
          </div>
          <div class="feedback-record-actions">
            <el-button text type="primary" @click="viewFeedbackDetail(item)">查看</el-button>
            <el-button text type="danger" @click="confirmDeleteFeedback(item)">删除</el-button>
            <el-button
              text
              type="primary"
              :loading="feedbackSuggesting && activeSessionKey === item.sessionKey"
              :disabled="feedbackSuggesting && activeSessionKey !== item.sessionKey"
              @click="openFeedbackSuggestionDialog(item)"
            >
              从反馈更新画像
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="feedbackListTotal > feedbackListPageSize" class="sample-pagination">
        <el-pagination
          v-model:current-page="feedbackListPage"
          :page-size="feedbackListPageSize"
          :total="feedbackListTotal"
          layout="prev, pager, next"
          background
          small
          @current-change="loadFeedbackList"
        />
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="feedbackListDialogVisible = false" class="cancel-btn">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="feedbackDetailDialogVisible"
      title="会话反馈详情"
      width="680px"
      class="neon-dialog"
      destroy-on-close
    >
      <el-scrollbar height="480" style="padding-right: 18px">
        <div v-if="feedbackDetail?.length" class="feedback-suggestion-panel">
          <div
            v-for="(round, index) in feedbackDetail"
            :key="round.id"
            class="suggestion-section"
          >
            <div class="suggestion-title">第 {{ index + 1 }} 轮 · {{ round.score }}/10 · {{ round.createTime }}</div>
            <div class="feedback-round-row">
              <span>原始需求</span>
              <p>{{ round.userPrompt || "无" }}</p>
            </div>
            <div class="feedback-round-row">
              <span>AI 草稿</span>
              <p>{{ round.aiDraft || "无" }}</p>
            </div>
            <div class="feedback-round-row">
              <span>修改意见</span>
              <p>{{ round.userFeedback || "无" }}</p>
            </div>
            <div class="feedback-round-row" v-if="round.revisedDraft">
              <span>修改后稿件</span>
              <p>{{ round.revisedDraft }}</p>
            </div>
          </div>
        </div>
      </el-scrollbar>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="feedbackDetailDialogVisible = false" class="cancel-btn">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="historyDialogVisible"
      title="历史版本"
      width="640px"
      class="neon-dialog"
      destroy-on-close
    >
      <div v-if="profileHistory.length" class="feedback-record-list">
        <div v-for="entry in profileHistory" :key="entry.savedAt" class="feedback-record-item">
          <div class="feedback-record-main">
            <div class="feedback-record-meta">
              <span class="feedback-record-time">{{ entry.savedAt }}</span>
            </div>
            <div class="feedback-record-text">{{ entry.summary || "（该版本总画像为空）" }}</div>
          </div>
          <div class="feedback-record-actions">
            <el-button
              text
              type="primary"
              :loading="historyRestoring === entry.savedAt"
              @click="restoreHistoryEntry(entry)"
            >
              恢复此版本
            </el-button>
          </div>
        </div>
      </div>
      <div v-else class="empty-mini">还没有可恢复的历史版本。</div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="historyDialogVisible = false" class="cancel-btn">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="feedbackSuggestionDialogVisible"
      title="从反馈更新画像"
      width="760px"
      class="neon-dialog feedback-dialog"
      destroy-on-close
    >
      <div v-if="feedbackSuggestion" class="feedback-suggestion-panel">
        <div class="suggestion-section" v-if="activeSessionRow">
          <div class="suggestion-title">这个会话</div>
          <div class="suggestion-text muted">
            共 {{ activeSessionRow.feedbackCount }} 条反馈 · 均分 {{ activeSessionRow.avgScore }} ·
            {{ activeSessionRow.latestPreview || "无" }}
          </div>
        </div>

        <div class="suggestion-section">
          <div class="suggestion-title">当前总画像</div>
          <div class="suggestion-text muted">
            {{ feedbackSuggestion.currentSummary || "当前还没有稳定总画像。" }}
          </div>
        </div>

        <div class="suggestion-section">
          <div class="suggestion-title">建议合并为 200 字以内总画像</div>
          <el-input
            v-model="feedbackSuggestion.suggestion.summarySuggestion"
            type="textarea"
            :rows="4"
            maxlength="200"
            show-word-limit
            class="glow-input suggestion-input"
          />
          <div class="form-tip">确认后不会追加文本，而是让模型把旧画像和这条建议合并重写到 200 字以内。</div>
        </div>

        <div class="suggestion-grid">
          <div class="suggestion-section">
            <div class="suggestion-title">偏好信号</div>
            <div v-if="feedbackSuggestion.suggestion.preferredSignals?.length" class="signal-list">
              <div
                v-for="item in feedbackSuggestion.suggestion.preferredSignals"
                :key="item"
                class="signal-item signal-item--preferred"
              >
                {{ item }}
              </div>
            </div>
            <div v-else class="empty-mini">暂未提炼到稳定偏好。</div>
          </div>

          <div class="suggestion-section">
            <div class="suggestion-title">避坑信号</div>
            <div v-if="feedbackSuggestion.suggestion.avoidSignals?.length" class="signal-list">
              <div
                v-for="item in feedbackSuggestion.suggestion.avoidSignals"
                :key="item"
                class="signal-item signal-item--avoid"
              >
                {{ item }}
              </div>
            </div>
            <div v-else class="empty-mini">暂未提炼到稳定避坑规则。</div>
          </div>
        </div>

        <div class="suggestion-grid">
          <div class="suggestion-section">
            <div class="suggestion-title">建议合并到常用表达</div>
            <el-input
              v-model="feedbackPreferredPhrasesText"
              type="textarea"
              :rows="3"
              class="glow-input suggestion-input"
              placeholder="用顿号、逗号或换行分隔"
            />
            <div class="form-tip">会和现有常用表达去重合并，最多保留 8 条。</div>
          </div>

          <div class="suggestion-section">
            <div class="suggestion-title">建议合并到避免表达</div>
            <el-input
              v-model="feedbackAvoidPhrasesText"
              type="textarea"
              :rows="3"
              class="glow-input suggestion-input"
              placeholder="用顿号、逗号或换行分隔"
            />
            <div class="form-tip">会和现有避免表达去重合并，最多保留 8 条。</div>
          </div>
        </div>

        <div class="suggestion-section">
          <div class="suggestion-title">依据</div>
          <div v-if="feedbackSuggestion.suggestion.evidence?.length" class="evidence-list">
            <div
              v-for="item in feedbackSuggestion.suggestion.evidence"
              :key="item"
              class="evidence-item"
            >
              {{ item }}
            </div>
          </div>
          <div v-else class="empty-mini">暂无可展示依据。</div>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="feedbackSuggestionDialogVisible = false" class="cancel-btn">
            暂不应用
          </el-button>
          <el-button
            type="primary"
            class="confirm-btn"
            :loading="feedbackApplying"
            @click="applyFeedbackSuggestion"
          >
            应用到总画像
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="sampleDialogVisible"
      title="增加样本"
      width="680px"
      class="neon-dialog"
      destroy-on-close
      @closed="resetSampleForm"
    >
      <el-scrollbar height="460" style="padding-right: 18px">
        <el-form :model="sampleForm" label-position="top" class="profile-form">
          <el-form-item label="样本来源">
            <el-radio-group v-model="sampleForm.type">
              <el-radio value="1">上传文件</el-radio>
              <el-radio value="2">自定义内容</el-radio>
              <el-radio value="3">网站链接</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="sampleForm.type === '2'" label="样本文本">
            <el-input
              v-model="sampleForm.content"
              type="textarea"
              :rows="8"
              class="glow-input"
              placeholder="粘贴最能代表你风格的文章、终稿或片段"
            />
          </el-form-item>

          <el-form-item v-else-if="sampleForm.type === '1'" label="上传样本">
            <div class="upload-row">
              <el-button
                type="primary"
                :icon="Plus"
                class="neon-upload-btn"
                @click="uploadFiles"
                :loading="uploadLoading"
                :disabled="sampleForm.filePaths.length > 0"
              >
                选择样本文件
              </el-button>
              <div class="upload-tip">
                支持 `pdf`、`txt`、`docx`、`doc`每次追加一个样本文件，如需追加多个请重复"增加样本"。
              </div>
            </div>
            <div v-if="sampleForm.filePaths.length" class="file-list">
              <el-tag
                v-for="file in sampleForm.filePaths"
                :key="file.filePath"
                closable
                type="primary"
                @close="removeFile(file.filePath)"
              >
                {{ file.fileName }}
              </el-tag>
            </div>
          </el-form-item>

          <el-form-item v-else label="网站链接">
            <el-input
              v-model="sampleForm.url"
              placeholder="请输入网站地址"
              size="large"
              class="glow-input"
              clearable
            />
          </el-form-item>
        </el-form>
      </el-scrollbar>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="sampleDialogVisible = false" class="cancel-btn">取消</el-button>
          <el-button type="primary" @click="saveSample" :loading="sampleSaving" class="confirm-btn">
            追加到总画像
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from "vue";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  appendProfileSample,
  applyProfileFeedbackSession,
  deleteProfileFeedbackSession,
  deleteProfileSample,
  getCurrentProfile,
  getProfileFeedbackSessionDetail,
  listProfileFeedbackSessions,
  restoreProfileHistory,
  suggestProfileFeedbackSession,
  updateCurrentProfile,
} from "@renderer/api/writeStyle";
import router from "../../../router";

const pageLoading = ref(false);
const profileSaving = ref(false);
const sampleSaving = ref(false);
const uploadLoading = ref(false);
const feedbackSuggesting = ref(false);
const feedbackApplying = ref(false);
const deletingSampleId = ref(null);
const currentProfile = ref(null);
const profileDialogVisible = ref(false);
const sampleDialogVisible = ref(false);
const feedbackSuggestionDialogVisible = ref(false);
const feedbackSuggestion = ref(null);
const feedbackPreferredPhrasesText = ref("");
const feedbackAvoidPhrasesText = ref("");
const samplePage = ref(1);
const samplePageSize = 5;

const feedbackListDialogVisible = ref(false);
const feedbackListLoading = ref(false);
const feedbackList = ref([]);
const feedbackListTotal = ref(0);
const feedbackListPage = ref(1);
const feedbackListPageSize = 10;
const feedbackCounts = reactive({ total: 0 });
const feedbackDetailDialogVisible = ref(false);
const feedbackDetail = ref(null);
const activeSessionKey = ref(null);
const activeSessionRow = ref(null);
const activeFeedbackIds = ref([]);
const historyDialogVisible = ref(false);
const historyRestoring = ref(null);

const profileForm = reactive({
  title: "",
  scene: "",
  identity: "",
  preferredPhrases: "",
  avoidPhrases: "",
  summary: "",
});

const sampleForm = reactive({
  type: "1",
  content: "",
  url: "",
  filePaths: [],
});

const profileSummary = computed(() => {
  return currentProfile.value?.styleProfile?.summary || "";
});

const sampleTotal = computed(() => currentProfile.value?.samples?.length || 0);
const pagedSamples = computed(() => {
  const samples = currentProfile.value?.samples || [];
  const start = (samplePage.value - 1) * samplePageSize;
  return samples.slice(start, start + samplePageSize);
});

const profileHistory = computed(() => currentProfile.value?.styleProfile?.summaryHistory || []);

function normalizeSamplePage() {
  const maxPage = Math.max(1, Math.ceil(sampleTotal.value / samplePageSize));
  if (samplePage.value > maxPage) {
    samplePage.value = maxPage;
  }
}

function fillProfileForm() {
  profileForm.title = currentProfile.value?.title || "";
  profileForm.scene = currentProfile.value?.scene || "";
  profileForm.identity = currentProfile.value?.identity || "";
  profileForm.preferredPhrases = (currentProfile.value?.preferredPhrases || []).join("、");
  profileForm.avoidPhrases = (currentProfile.value?.avoidPhrases || []).join("、");
  // 用 extractedSummary（不带"画像名称：xxx；用户身份：xxx"这类自动拼接的元信息）做编辑框初始值，
  // 保存时后端会照旧把这些元信息重新拼接到展示用的 summary 上，编辑框里不用重复出现这段拼接文本
  profileForm.summary =
    currentProfile.value?.styleProfile?.extractedSummary || currentProfile.value?.styleProfile?.summary || "";
}

function resetProfileForm() {
  fillProfileForm();
}

function resetSampleForm() {
  sampleForm.type = "1";
  sampleForm.content = "";
  sampleForm.url = "";
  sampleForm.filePaths.splice(0, sampleForm.filePaths.length);
}

async function loadCurrentProfile() {
  pageLoading.value = true;
  try {
    const res = await getCurrentProfile();
    currentProfile.value = res.data || null;
    normalizeSamplePage();
    fillProfileForm();
    await loadFeedbackCounts();
  } finally {
    pageLoading.value = false;
  }
}

function goWrite() {
  if (!currentProfile.value?.id) {
    ElMessage.warning("请先维护画像或增加样本后再开始写作");
    return;
  }
  router.push({
    path: "/home/writeStyle/editor",
    query: {
      id: currentProfile.value.id,
    },
  });
}

function openProfileDialog() {
  fillProfileForm();
  profileDialogVisible.value = true;
}

function openSampleDialog() {
  sampleDialogVisible.value = true;
}

function parsePhraseText(value = "") {
  return String(value || "")
    .replace(/[，；、]/g, ",")
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadFeedbackCounts() {
  if (!currentProfile.value?.id) return;
  try {
    const res = await listProfileFeedbackSessions({
      profileId: currentProfile.value.id,
      page: 1,
      pageSize: 1,
    });
    feedbackCounts.total = res.data?.total || 0;
  } catch {
    // 计数仅用于展示提示，静默失败即可。
  }
}

async function openFeedbackListDialog() {
  if (!currentProfile.value?.id) {
    ElMessage.warning("请先创建写作画像");
    return;
  }
  feedbackListPage.value = 1;
  feedbackListDialogVisible.value = true;
  await loadFeedbackList();
}

async function loadFeedbackList() {
  if (!currentProfile.value?.id) return;
  feedbackListLoading.value = true;
  try {
    const res = await listProfileFeedbackSessions({
      profileId: currentProfile.value.id,
      page: feedbackListPage.value,
      pageSize: feedbackListPageSize,
    });
    feedbackList.value = res.data?.list || [];
    feedbackListTotal.value = res.data?.total || 0;
    feedbackCounts.total = res.data?.total || 0;
  } finally {
    feedbackListLoading.value = false;
  }
}

async function viewFeedbackDetail(item) {
  const res = await getProfileFeedbackSessionDetail({
    profileId: currentProfile.value.id,
    sessionKey: item.sessionKey,
  });
  feedbackDetail.value = res.data;
  feedbackDetailDialogVisible.value = true;
}

async function confirmDeleteFeedback(item) {
  try {
    await ElMessageBox.confirm(
      `删除后这个会话里的 ${item.feedbackCount} 条反馈都将无法再用于更新画像，确定继续吗？`,
      "删除会话反馈",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      }
    );
  } catch {
    return;
  }

  await deleteProfileFeedbackSession({
    profileId: currentProfile.value.id,
    sessionKey: item.sessionKey,
  });
  ElMessage.success("会话反馈已删除");
  await loadFeedbackList();
}

async function openFeedbackSuggestionDialog(item) {
  if (feedbackSuggesting.value) return;
  activeSessionKey.value = item.sessionKey;
  activeSessionRow.value = item;
  feedbackSuggesting.value = true;
  try {
    const res = await suggestProfileFeedbackSession({
      profileId: currentProfile.value.id,
      sessionKey: item.sessionKey,
    });
    feedbackSuggestion.value = res.data;
    activeFeedbackIds.value = res.data?.feedbackIds || [];
    feedbackPreferredPhrasesText.value = (res.data?.suggestion?.preferredPhrases || []).join("、");
    feedbackAvoidPhrasesText.value = (res.data?.suggestion?.avoidPhrases || []).join("、");
    feedbackSuggestionDialogVisible.value = true;
  } catch {
    // axios 响应拦截器已经统一提示错误，这里避免重复弹窗。
  } finally {
    feedbackSuggesting.value = false;
  }
}

async function applyFeedbackSuggestion() {
  if (!currentProfile.value?.id || !feedbackSuggestion.value?.suggestion || !activeSessionKey.value) return;
  const summary = String(feedbackSuggestion.value.suggestion.summarySuggestion || "").trim();
  if (!summary) {
    ElMessage.warning("画像建议不能为空");
    return;
  }

  feedbackApplying.value = true;
  try {
    const res = await applyProfileFeedbackSession({
      profileId: currentProfile.value.id,
      sessionKey: activeSessionKey.value,
      feedbackIds: activeFeedbackIds.value,
      suggestion: {
        ...feedbackSuggestion.value.suggestion,
        summarySuggestion: summary,
        preferredPhrases: parsePhraseText(feedbackPreferredPhrasesText.value),
        avoidPhrases: parsePhraseText(feedbackAvoidPhrasesText.value),
      },
    });
    currentProfile.value = res.data || currentProfile.value;
    fillProfileForm();
    feedbackSuggestionDialogVisible.value = false;
    feedbackSuggestion.value = null;
    feedbackPreferredPhrasesText.value = "";
    feedbackAvoidPhrasesText.value = "";
    activeSessionKey.value = null;
    activeSessionRow.value = null;
    activeFeedbackIds.value = [];
    ElMessage.success("总画像已根据这个会话的反馈更新");
    await loadFeedbackList();
  } finally {
    feedbackApplying.value = false;
  }
}

function openHistoryDialog() {
  historyDialogVisible.value = true;
}

async function restoreHistoryEntry(entry) {
  if (!currentProfile.value?.id) return;
  try {
    await ElMessageBox.confirm("恢复后当前总画像会变为一条新的历史记录，确定恢复这个版本吗？", "恢复历史版本", {
      type: "warning",
      confirmButtonText: "恢复",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }

  historyRestoring.value = entry.savedAt;
  try {
    const res = await restoreProfileHistory({
      profileId: currentProfile.value.id,
      savedAt: entry.savedAt,
    });
    currentProfile.value = res.data || currentProfile.value;
    fillProfileForm();
    ElMessage.success("已恢复到该历史版本");
  } finally {
    historyRestoring.value = null;
  }
}

async function saveProfile() {
  const existedBeforeSave = Boolean(currentProfile.value?.id);
  profileSaving.value = true;
  try {
    await updateCurrentProfile({ ...profileForm });
    ElMessage.success(existedBeforeSave ? "画像已更新" : "画像已创建");
    profileDialogVisible.value = false;
    await loadCurrentProfile();
  } finally {
    profileSaving.value = false;
  }
}

async function uploadFiles() {
  uploadLoading.value = true;
  const res = await window.electronAPI.selectFile().finally(() => {
    uploadLoading.value = false;
  });
  if (!res || res.length === 0) return;
  if (res.length > 1) {
    ElMessage.warning("样本每次只能上传一个文件，已取第一个");
  }
  sampleForm.filePaths.splice(0, sampleForm.filePaths.length, res[0]);
}

function removeFile(filePath) {
  const index = sampleForm.filePaths.findIndex((item) => item.filePath === filePath);
  if (index >= 0) {
    sampleForm.filePaths.splice(index, 1);
  }
}

async function saveSample() {
  if (sampleForm.type === "1" && sampleForm.filePaths.length === 0) {
    ElMessage.warning("请先选择样本文件");
    return;
  }
  if (sampleForm.type === "2" && !sampleForm.content.trim()) {
    ElMessage.warning("请输入样本文本");
    return;
  }
  if (sampleForm.type === "3" && !sampleForm.url.trim()) {
    ElMessage.warning("请输入网站链接");
    return;
  }

  sampleSaving.value = true;
  try {
    await appendProfileSample({
      ...sampleForm,
      filePaths: [...sampleForm.filePaths],
    });
    ElMessage.success("样本已追加，并已提取样本特征");
    sampleDialogVisible.value = false;
    resetSampleForm();
    await loadCurrentProfile();
  } finally {
    sampleSaving.value = false;
  }
}

function formatSourceType(type) {
  if (type === "upload") return "上传文件";
  if (type === "website") return "网站链接";
  return "自定义内容";
}

function hasSampleAnalysis(sample) {
  const analysis = sample?.analysisProfile || {};
  return Boolean(
    analysis.summary ||
      analysis.writingStyle ||
      analysis.coreIdea ||
      analysis.writingTechniques?.length
  );
}

async function confirmDeleteSample(sample) {
  if (!sample?.id || deletingSampleId.value === sample.id) return;

  try {
    await ElMessageBox.confirm(
      "删除后只会更新相似样本检索结果，不会重建总画像，确定继续吗？",
      "删除样本",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      }
    );
  } catch {
    return;
  }

  deletingSampleId.value = sample.id;
  try {
    await deleteProfileSample({ id: sample.id });
    ElMessage.success("样本已删除，样本索引已更新");
    await loadCurrentProfile();
  } finally {
    deletingSampleId.value = null;
  }
}

onMounted(() => {
  loadCurrentProfile();
});
</script>

<style scoped lang="scss">
.write-style-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  gap: 18px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: #e8eaf6;
}

.page-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: #7f8fb0;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.action-btn {
  height: 40px;
  border-radius: 12px;
}

.primary-btn {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
  border: none !important;
  color: #fff !important;
}

.secondary-btn {
  border: 1px solid rgba(99, 148, 255, 0.4) !important;
  color: #dbeafe !important;
  background: rgba(30, 41, 59, 0.6) !important;
}

.dashboard-grid {
  flex: 0 0 auto;
  min-height: min-content;
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.9fr);
  grid-template-rows: auto auto;
  gap: 18px;
  padding-bottom: 24px;
}

.profile-card,
.info-card,
.empty-panel {
  border-radius: 18px;
  background: linear-gradient(145deg, #1e2d4a 0%, #162238 100%);
  border: 1px solid rgba(99, 148, 255, 0.24);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.25);
}

.hero-card {
  padding: 22px;
}

.hero-head,
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.hero-label,
.block-title {
  font-size: 12px;
  font-weight: 700;
  color: #8fb2ff;
  letter-spacing: 0.04em;
}

.hero-title {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
  color: #eef2ff;
}

.hero-actions {
  display: flex;
  gap: 8px;
}

.feedback-update-btn {
  min-width: 132px;
}

.feedback-badge :deep(.el-badge__content) {
  border: none;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.meta-chip {
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.28);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.meta-key {
  font-size: 12px;
  color: #8aa0c9;
}

.meta-value {
  font-size: 14px;
  color: #eef2ff;
  font-weight: 600;
}

.summary-block {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-text,
.sample-preview,
.empty-mini,
.block-subtitle,
.sample-empty-text,
.form-tip {
  font-size: 13px;
  line-height: 1.8;
  color: #cdd8ee;
}

.block-subtitle {
  margin-top: 6px;
}

.side-column {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.compact-card,
.full-width {
  padding: 18px;
}

.full-width {
  grid-column: 1 / -1;
  min-height: min-content;
}

.tag-list {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sample-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sample-count-chip {
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.12);
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 600;
}

.sample-list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.sample-pagination {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}

.sample-pagination :deep(.el-pagination.is-background .btn-prev),
.sample-pagination :deep(.el-pagination.is-background .btn-next),
.sample-pagination :deep(.el-pagination.is-background .el-pager li) {
  background: rgba(15, 23, 42, 0.32);
  color: #bfdbfe;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.sample-pagination :deep(.el-pagination.is-background .el-pager li.is-active) {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  border-color: transparent;
}

.sample-item {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.24);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.sample-item-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.sample-main {
  min-width: 0;
}

.sample-name {
  font-size: 15px;
  font-weight: 700;
  color: #eef2ff;
  word-break: break-all;
}

.sample-meta {
  margin-top: 6px;
  font-size: 12px;
  color: #8aa0c9;
}

.sample-delete-btn {
  padding: 0;
}

.sample-preview {
  margin-top: 10px;
  word-break: break-word;
}

.sample-analysis {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(125, 211, 252, 0.14);
}

.sample-analysis-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 10px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.7;
  color: #dce8ff;
}

.sample-analysis-row span {
  color: #7dd3fc;
  font-weight: 700;
}

.sample-analysis-row p {
  margin: 0;
  word-break: break-word;
}

.sample-tech-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sample-empty {
  margin-top: 18px;
  padding: 24px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.22);
  border: 1px dashed rgba(148, 163, 184, 0.18);
}

.sample-empty-title {
  font-size: 15px;
  font-weight: 700;
  color: #eef2ff;
}

.sample-empty-text {
  margin-top: 8px;
}

.empty-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
}

.empty-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.upload-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-tip {
  font-size: 12px;
  color: #7f8fb0;
  line-height: 1.7;
}

.file-list {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.profile-form :deep(.el-form-item__label) {
  color: #94a3b8;
  font-weight: 600;
}

.glow-input :deep(.el-input__wrapper),
.glow-input :deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
  color: #f1f5f9 !important;
  border-radius: 12px !important;
}

.glow-input :deep(.el-input__wrapper:hover),
.glow-input :deep(.el-textarea__inner:hover) {
  border-color: rgba(102, 126, 234, 0.5) !important;
}

.glow-input :deep(.el-input__wrapper.is-focus),
.glow-input :deep(.el-textarea__inner:focus) {
  border-color: #667eea !important;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1) !important;
}

.glow-input :deep(.el-input__inner),
.glow-input :deep(.el-textarea__inner) {
  color: #f1f5f9 !important;
}

.glow-input :deep(.el-input__inner::placeholder),
.glow-input :deep(.el-textarea__inner::placeholder) {
  color: #64748b !important;
}

.neon-btn,
.neon-upload-btn,
.confirm-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  border: none !important;
  color: #fff !important;
}

.neon-upload-btn {
  align-self: flex-start;
  padding: 12px 24px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  border-radius: 12px !important;
  box-shadow: 0 0 20px rgba(102, 126, 234, 0.5) !important;
}

:deep(.el-radio__input.is-checked .el-radio__inner) {
  background: #667eea !important;
  border-color: #667eea !important;
}

:deep(.el-radio__input.is-checked + .el-radio__label) {
  color: #667eea !important;
}

:deep(.el-radio__label) {
  color: #94a3b8 !important;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 10px;
}

.feedback-suggestion-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.feedback-list-head {
  margin-bottom: 12px;
  font-size: 13px;
  color: #8aa0c9;
}

.feedback-record-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 480px;
  overflow-y: auto;
  padding-right: 4px;
}

.feedback-record-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.22);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.feedback-record-main {
  min-width: 0;
  flex: 1;
}

.feedback-record-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.feedback-record-time {
  font-size: 12px;
  color: #8aa0c9;
}

.feedback-record-text {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: #dce8ff;
  word-break: break-word;
}

.feedback-record-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.feedback-round-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 10px;
  align-items: flex-start;
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: #dce8ff;
}

.feedback-round-row span {
  color: #7dd3fc;
  font-weight: 700;
}

.feedback-round-row p {
  margin: 0;
  word-break: break-word;
}

.suggestion-section {
  padding: 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.2);
  border: 1px solid rgba(125, 211, 252, 0.14);
}

.suggestion-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #7dd3fc;
}

.suggestion-text {
  font-size: 13px;
  line-height: 1.8;
  color: #dce8ff;
}

.suggestion-text.muted {
  color: #aebbd3;
}

.suggestion-input {
  display: block;
}

.suggestion-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.signal-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.signal-item {
  padding: 9px 10px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.signal-item--preferred {
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(74, 222, 128, 0.2);
}

.signal-item--avoid {
  color: #fde68a;
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid rgba(250, 204, 21, 0.2);
}

.evidence-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.evidence-item {
  padding: 9px 10px;
  border-radius: 10px;
  color: #dce8ff;
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(125, 211, 252, 0.12);
  font-size: 13px;
  line-height: 1.6;
}

.cancel-btn {
  background: transparent !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: #94a3b8 !important;
}

.cancel-btn:hover {
  border-color: rgba(255, 255, 255, 0.4) !important;
  color: #f1f5f9 !important;
}

@media (max-width: 1100px) {
  .toolbar {
    flex-direction: column;
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }

  .full-width {
    grid-column: auto;
  }

  .sample-item-head,
  .sample-head-actions,
  .hero-head,
  .card-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .sample-analysis-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .suggestion-grid {
    grid-template-columns: 1fr;
  }

  .feedback-record-item {
    flex-direction: column;
  }

  .feedback-record-actions {
    flex-direction: row;
    align-items: center;
  }
}
</style>
