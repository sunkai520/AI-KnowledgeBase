<template>
  <div class="write-style-page">
    <div class="toolbar">
      <div>
        <div class="page-title">个人写作画像</div>
        <div class="page-subtitle">记录身份、场景、常用表达和参考样本，让 AI 更像你本人在写。</div>
      </div>
      <div class="toolbar-actions">
          <el-input
            v-model="keyWord"
          placeholder="搜索标题、身份、场景、画像"
          clearable
          style="width: 260px"
          :suffix-icon="Search"
          @input="inputChange"
        />
        <el-button type="primary" class="create-btn" @click="showAdd = true">
          <el-icon><Plus /></el-icon>
          新建画像
        </el-button>
      </div>
    </div>

    <div class="cards-wrap" v-loading="tableLoading">
      <div v-if="articles.length" class="cards-grid">
        <div
          v-for="item in articles"
          :key="item.id"
          class="profile-card"
        >
          <div class="card-top">
            <div>
              <div class="card-title">{{ item.title }}</div>
              <div class="card-meta">
                <span>{{ sourceTypeLabel(item.sourceType) }}</span>
                <span v-if="item.scene">场景：{{ item.scene }}</span>
                <span v-if="item.identity">身份：{{ item.identity }}</span>
              </div>
            </div>
            <el-dropdown>
              <el-icon class="menu-icon"><Menu /></el-icon>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item>
                    <el-button size="small" text @click="aiWrite(item)">AI写作</el-button>
                  </el-dropdown-item>
                  <el-dropdown-item>
                    <el-button type="danger" size="small" text @click="remove(item.id)">删除</el-button>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <div class="field-block">
            <div class="field-label">摘要</div>
            <div class="field-text clamp-3">{{ item.content }}</div>
          </div>

          <div class="field-block" v-if="item.styleProfile?.summary">
            <div class="field-label">画像</div>
            <div class="field-text clamp-4">{{ item.styleProfile.summary }}</div>
          </div>

          <div class="tags-block" v-if="item.preferredPhrases?.length">
            <div class="field-label">常用表达</div>
            <div class="tags-row">
              <el-tag
                v-for="phrase in item.preferredPhrases"
                :key="phrase"
                size="small"
                effect="plain"
                type="success"
              >
                {{ phrase }}
              </el-tag>
            </div>
          </div>

          <div class="tags-block" v-if="item.avoidPhrases?.length">
            <div class="field-label">避免表达</div>
            <div class="tags-row">
              <el-tag
                v-for="phrase in item.avoidPhrases"
                :key="phrase"
                size="small"
                effect="plain"
                type="warning"
              >
                {{ phrase }}
              </el-tag>
            </div>
          </div>

          <div class="field-block">
            <div class="field-label">样本摘录</div>
            <div class="field-text clamp-4">{{ item.samplePreview || "暂无样本摘录" }}</div>
          </div>

          <div class="card-footer">{{ item.createTime }}</div>
        </div>
      </div>

      <div v-else class="empty-wrap">
        <el-empty description="还没有个人写作画像，先上传你的文章样本试试" />
      </div>
    </div>

    <div class="pagination" v-if="articles.length > 0">
      <el-pagination
        background
        v-model:currentPage="pageConfig.page"
        v-model:page-size="pageConfig.pageSize"
        layout="prev, pager, next"
        :total="pageConfig.total"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>

    <el-dialog
      v-model="showAdd"
      title="新建个人写作画像"
      width="680px"
      @closed="reset"
    >
      <el-form :model="form" label-position="top">
        <el-form-item label="样本来源">
          <el-radio-group v-model="form.type">
            <el-radio value="1">上传文章</el-radio>
            <el-radio value="2">自定义内容</el-radio>
            <el-radio value="3">网站链接</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="写作场景">
          <el-input v-model="form.scene" placeholder="例如：工作汇报、公众号、朋友圈、发言稿" />
        </el-form-item>

        <el-form-item label="用户身份">
          <el-input v-model="form.identity" placeholder="例如：产品经理、老师、律师、自媒体作者" />
        </el-form-item>

        <el-form-item label="希望保留的常用表达">
          <el-input
            v-model="form.preferredPhrases"
            type="textarea"
            :rows="2"
            placeholder="可选。用逗号、分号或换行分隔，例如：很多时候、说到底、我更倾向于"
          />
        </el-form-item>

        <el-form-item label="希望避免的表达">
          <el-input
            v-model="form.avoidPhrases"
            type="textarea"
            :rows="2"
            placeholder="可选。比如：赋能、闭环、值得一提的是、总而言之"
          />
        </el-form-item>

        <el-form-item v-if="form.type === '2'" label="样本文本">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            placeholder="粘贴你自己的文章、改好的终稿，或者最能代表你风格的内容"
          />
        </el-form-item>

        <el-form-item v-else-if="form.type === '1'" label="上传文章">
          <div class="upload-row">
            <el-button type="primary" :icon="Plus" @click="uploadFiles" :loading="uploadLoading">
              选择文件
            </el-button>
            <div class="upload-tip">支持 `pdf`、`txt`、`docx`、`doc`、`pptx`，多文件会合并为同一份画像样本。</div>
          </div>
          <div v-if="form.filePaths.length" class="file-list">
            <el-tag
              v-for="file in form.filePaths"
              :key="file.filePath"
              closable
              @close="removeFile(file.filePath)"
            >
              {{ file.fileName }}
            </el-tag>
          </div>
        </el-form-item>

        <el-form-item v-else label="网站链接">
          <el-input v-model="form.url" placeholder="请输入网站地址" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="confirm" :loading="addLoading">生成画像</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from "vue";
import { Plus, Search, Menu } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import pageHooks from "@renderer/hooks/pageHooks";
import { add, list, del } from "@renderer/api/writeStyle";
import router from "../../../router";
import { debounce } from "../../../utils/common";

const articles = ref([]);
const addLoading = ref(false);
const uploadLoading = ref(false);
const keyWord = ref("");
const showAdd = ref(false);
const tableLoading = ref(false);

const { pageConfig, handleSizeChange, handleCurrentChange } = pageHooks(
  () => getList(),
  { pageSize: 9 }
);

const form = reactive({
  type: "1",
  content: "",
  url: "",
  filePaths: [],
  scene: "",
  identity: "",
  preferredPhrases: "",
  avoidPhrases: "",
});

const inputChange = debounce(() => {
  pageConfig.page = 1;
  getList();
});

function sourceTypeLabel(sourceType) {
  if (sourceType === "upload") return "上传样本";
  if (sourceType === "manual") return "自定义样本";
  if (sourceType === "website") return "网站样本";
  return "写作样本";
}

function reset() {
  form.type = "1";
  form.content = "";
  form.url = "";
  form.filePaths = [];
  form.scene = "";
  form.identity = "";
  form.preferredPhrases = "";
  form.avoidPhrases = "";
}

async function uploadFiles() {
  uploadLoading.value = true;
  const res = await window.electronAPI.selectFile().finally(() => {
    uploadLoading.value = false;
  });
  if (!res || res.length === 0) return;
  const existing = new Set(form.filePaths.map((item) => item.filePath));
  res.forEach((file) => {
    if (!existing.has(file.filePath)) {
      form.filePaths.push(file);
    }
  });
}

function removeFile(filePath) {
  form.filePaths = form.filePaths.filter((item) => item.filePath !== filePath);
}

async function confirm() {
  if (form.type === "1" && form.filePaths.length === 0) {
    ElMessage.warning("请先选择样本文件");
    return;
  }
  if (form.type === "2" && !form.content.trim()) {
    ElMessage.warning("请输入样本文本");
    return;
  }
  if (form.type === "3" && !form.url.trim()) {
    ElMessage.warning("请输入网站链接");
    return;
  }

  addLoading.value = true;
  try {
    await add({ ...form });
    ElMessage.success("画像生成成功");
    showAdd.value = false;
    getList();
  } finally {
    addLoading.value = false;
  }
}

function aiWrite(item) {
  router.push({
    path: "/home/chat",
    query: {
      id: item.id,
    },
  });
}

function remove(id) {
  ElMessageBox.confirm("确定删除这份写作画像吗？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  }).then(async () => {
    await del({ id });
    ElMessage.success("删除成功");
    getList();
  });
}

async function getList() {
  tableLoading.value = true;
  try {
    const res = await list({
      page: pageConfig.page,
      pageSize: pageConfig.pageSize,
      keyWord: keyWord.value,
    });
    articles.value = res.data.list || [];
    pageConfig.total = res.data.total || 0;
  } finally {
    tableLoading.value = false;
  }
}

onMounted(() => {
  getList();
});
</script>

<style scoped lang="scss">
.write-style-page {
  height: 100%;
  display: flex;
  flex-direction: column;
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
}

.create-btn {
  height: 40px;
}

.cards-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 18px;
}

.profile-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: 16px;
  background: linear-gradient(145deg, #1e2d4a 0%, #162238 100%);
  border: 1px solid rgba(99, 148, 255, 0.24);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.25);
}

.card-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #eef2ff;
  line-height: 1.4;
}

.card-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: #8aa0c9;
}

.menu-icon {
  cursor: pointer;
  color: #94a3b8;
}

.field-block,
.tags-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: #8fb2ff;
  font-weight: 600;
}

.field-text {
  font-size: 13px;
  color: #d5def1;
  line-height: 1.7;
}

.clamp-3,
.clamp-4 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.clamp-3 {
  -webkit-line-clamp: 3;
}

.clamp-4 {
  -webkit-line-clamp: 4;
}

.tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.card-footer {
  margin-top: auto;
  font-size: 12px;
  color: #7184aa;
}

.pagination {
  display: flex;
  justify-content: center;
}

.empty-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-tip {
  font-size: 12px;
  color: #7f8fb0;
}

.file-list {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
