<template>
  <div class="quick-model-bar">
    <el-select
      v-model="modelName"
      filterable
      allow-create
      default-first-option
      clearable
      size="small"
      placeholder="当前模型"
      class="quick-model-select"
      popper-class="quick-model-popper"
      :loading="loadingModelOptions"
    >
      <!-- 当前配置的模型名可能还没被下面这批异步拉取到的列表覆盖到（或者本来就不在厂商返回的列表里，
           比如用户手动输入过的模型名）：el-select 在 filterable 模式下，只有能在 el-option 里找到匹配项
           才会显示对应文字，找不到就会显示空白而不是回退成原始字符串——所以这里补一个"合成选项"兜底 -->
      <el-option v-if="modelName && !modelOptions.includes(modelName)" :key="modelName" :label="modelName" :value="modelName" />
      <el-option v-for="m in modelOptions" :key="m" :label="m" :value="m" />
    </el-select>
    <el-select
      v-model="reasoningEffort"
      size="small"
      placeholder="极速"
      class="quick-effort-select"
      popper-class="quick-model-popper"
    >
      <el-option label="极速" value="none" />
      <el-option label="推理：低" value="low" />
      <el-option label="推理：中" value="medium" />
      <el-option label="推理：高" value="high" />
    </el-select>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";

// 快速切换本轮对话使用的模型/推理强度，覆盖模型配置页的全局设置；
// "极速" 是 "none"——强制不带 reasoning 参数，不会回退到全局默认强度（见后端各 server 的 modelOverride 处理）
const props = defineProps({
  // 用哪个模型配置段做默认值/拉取模型列表："chat"（AI助手/AI写作）或 "agent"（AI超级员工）
  configKey: { type: String, default: "chat" },
});
const modelName = defineModel("modelName", { default: "" });
const reasoningEffort = defineModel("reasoningEffort", { default: "" });

const modelOptions = ref([]);
const loadingModelOptions = ref(false);
let initialized = false;

onMounted(async () => {
  try {
    const cfg = await window.electronAPI.getModelConfig();
    const sectionCfg = cfg?.[props.configKey] || {};
    const savedModel = await window.electronAPI.getSetting?.(`quickModelName:${props.configKey}`);
    const savedEffort = await window.electronAPI.getSetting?.(`quickReasoningEffort:${props.configKey}`);
    modelName.value = savedModel || sectionCfg.modelName || "";
    // agent 段没有自己的 reasoningEffort 配置，跟 streaming 一样继承全局 chat 段的默认值（见 modelFactory.ts）
    reasoningEffort.value = savedEffort || sectionCfg.reasoningEffort || cfg?.chat?.reasoningEffort || "high";
    const providerCfg = cfg?.providers?.[sectionCfg.provider];
    if (providerCfg?.baseUrl) {
      loadingModelOptions.value = true;
      const res = await window.electronAPI.listModels({ baseUrl: providerCfg.baseUrl, apiKey: providerCfg.apiKey || "" });
      if (res?.success) modelOptions.value = res.models || [];
    }
  } catch (e) {
    console.error("加载快速模型切换失败", e);
  } finally {
    loadingModelOptions.value = false;
    initialized = true;
  }
});

watch(modelName, (val) => {
  if (initialized) window.electronAPI.setSetting?.(`quickModelName:${props.configKey}`, val);
});
watch(reasoningEffort, (val) => {
  if (initialized) window.electronAPI.setSetting?.(`quickReasoningEffort:${props.configKey}`, val);
});
</script>

<style scoped lang="scss">
.quick-model-bar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 2px 8px;
  .quick-model-select {
    width: 160px;
  }
  .quick-effort-select {
    width: 96px;
  }
  :deep(.el-select__wrapper) {
    min-height: 26px;
    border-radius: 14px !important;
    background: #ffffff !important;
    box-shadow: 0 0 0 1px #e3e8f0 inset !important;
  }
  :deep(.el-select__wrapper.is-focused),
  :deep(.el-select__wrapper:hover) {
    box-shadow: 0 0 0 1px #93c5fd inset !important;
  }
  :deep(.el-select__placeholder),
  :deep(.el-select__selected-item) {
    font-size: 12px;
    color: #2563eb;
  }
}
</style>
