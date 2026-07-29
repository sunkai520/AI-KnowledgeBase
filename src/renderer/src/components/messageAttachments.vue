<template>
  <div v-if="items.length > 0" class="message-attachments">
    <div v-for="(item, index) in items" :key="index" class="file">
      <div v-if="item.missing" class="missing">
        <el-icon><WarningFilled /></el-icon>
        <span>文件已失效</span>
      </div>
      <div v-else-if="item.type === 'image'" class="image">
        <img :src="item.content" class="uploadImg" />
      </div>
      <div v-else class="textDoc">
        <TextDoc :docObj="item"></TextDoc>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { WarningFilled } from "@element-plus/icons-vue";
import TextDoc from "./textDoc.vue";

const props = defineProps({
  files: {
    type: String,
    default: "",
  },
});

const items = ref([]);
// 按路径缓存已解析的附件，避免同一条历史消息反复触发 IPC 读取/编码
const cache = new Map();

async function resolveFiles(filesStr) {
  const paths = String(filesStr || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    items.value = [];
    return;
  }
  const resolved = await Promise.all(
    paths.map(async (filePath) => {
      if (cache.has(filePath)) return cache.get(filePath);
      const result = await window.electronAPI.readStoredAttachment(filePath);
      const item = result ? result : { filePath, fileName: filePath.split(/[\\/]/).pop(), missing: true };
      cache.set(filePath, item);
      return item;
    })
  );
  items.value = resolved;
}

watch(() => props.files, (val) => resolveFiles(val), { immediate: true });
</script>

<style scoped lang="scss">
.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 8px;
  .uploadImg {
    height: 50px;
    border-radius: 10px;
  }
  .missing {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    border-radius: 10px;
    background-color: #f0f0f0;
    color: #999;
    font-size: 13px;
  }
}
</style>
