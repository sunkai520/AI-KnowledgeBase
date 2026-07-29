<template>
  <div
    class="quiz-component"
    :class="{ 'is-drag-over': isDragOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="handleDrop"
  >
    <div v-if="selectFiles.length > 0" class="selectFiles">
      <div v-for="(k, index) in selectFiles" :key="index" class="file">
        <div v-if="k.type !== 'image'" class="textDoc">
          <CircleCloseFilled
            class="close"
            @click.stop="del(index)"
          ></CircleCloseFilled>
          <TextDoc :docObj="k"></TextDoc>
        </div>

        <div v-if="k.type == 'image'" class="image">
          <CircleCloseFilled
            class="close"
            @click.stop="del(index)"
          ></CircleCloseFilled>
          <img :src="k.content" class="uploadImg" />
        </div>
      </div>
    </div>
    <el-input
      v-model="inputValue"
      style="width: 100%"
      :autosize="{ minRows: 2, maxRows: 7 }"
      type="textarea"
      :placeholder="
        writeId ? '请将写作内容粘贴到这里！' : '有问题尽管问小助手吧！(Enter 发送，Shift+Enter 换行)'
      "
      @keydown.enter.prevent="handleEnter"
      @paste="handlePaste"
    />
    <div class="quiz-operation">
      <div class="quiz-operation-left">
        <div class="uploadBtn" @click="upload">
          <el-tooltip effect="dark" placement="top">
            <template #content>
              <!-- <p>文档数量：1个</p> -->
              <p>文件类型：pdf、txt、docx、doc、image</p>
              <!-- <p>大小不超过10M</p> -->
            </template>
            <p>
              <img
                style="width: 12px; height: 12px"
                src="../assets/img/attachment.png"
                alt=""
              />
            </p>
          </el-tooltip>
        </div>

        <p
          v-if="!writeId && showInternetToggle"
          class="toggle-btn"
          :class="{ active: internetChecked }"
          @click="onChangeInternetChecked"
        >
          <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9s1.3-6.5 3.8-9z" />
          </svg>
          互联网搜索
        </p>
        <p
          v-if="!writeId"
          class="toggle-btn"
          :class="{ active: localChecked }"
          @click="onChangelocalChecked"
        >
          <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          本地知识库
        </p>

        <el-dropdown
          v-if="showPermissionSelect"
          trigger="click"
          placement="top-start"
          popper-class="permission-dropdown-popper"
          @command="onPermissionLevelChange"
        >
          <p class="toggle-btn permission-btn" :class="{ active: permissionLevel === 'auto' }">
            <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            {{ permissionLevel === "auto" ? "1级·自动同意" : "2级·需人工确认" }}
            <el-icon class="permission-caret"><CaretBottom /></el-icon>
          </p>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="auto" :class="{ 'is-active': permissionLevel === 'auto' }">
                1级 · 自动同意执行命令
              </el-dropdown-item>
              <el-dropdown-item command="confirm" :class="{ 'is-active': permissionLevel === 'confirm' }">
                2级 · 需人工确认
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

      </div>
      <div class="quiz-operation-right">
        <!-- <el-select
          v-if="type == '1'"
          v-model="instrumentValue"
          placeholder="工具选择"
          style="width: 110px; height: 36px; margin-right: 12px"
        >
          <el-option
            v-for="item in instrumentOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select> -->
        <el-select
          v-if="writeId && showSampleSelect && sampleOptions.length"
          v-model="selectedSampleIds"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          clearable
          :multiple-limit="2"
          :filter-method="filterSamples"
          :no-match-text="sampleKeyword ? '没有匹配样本' : '暂无样本'"
          popper-class="sample-select-popper"
          :placeholder="sampleSelectFocused ? '' : '参考文章'"
          class="sample-select"
          @focus="onSampleSelectFocus"
          @blur="onSampleSelectBlur"
          @visible-change="onSampleDropdownVisible"
        >
          <el-option
            v-for="item in visibleSampleOptions"
            :key="item.id"
            :label="formatSampleLabel(item)"
            :value="item.id"
          />
        </el-select>
        <div class="submit" @click="loading ? onStop() : onSubmit()">
          <div v-if="loading" class="stop-btn">
            <span></span>
          </div>
          <template v-else>
            <img
              v-if="inputValue"
              src="../assets/img/arrows-checked.png"
              alt=""
            />
            <img v-else src="../assets/img/arrows-default.png" alt="" />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
  
   <script>
import { computed, onMounted, onUnmounted, nextTick, reactive, toRefs, watch } from "vue";
import { ElMessage } from "element-plus";
//   import { chatServiceUploadAndParse, wordsCheck } from "../api/index.ts";
import { CaretBottom, CircleCloseFilled } from "@element-plus/icons-vue";
import TextDoc from "./textDoc.vue";

export default {
  components: { TextDoc },
  props: {
    loading: {
      type: Boolean,
      default: false,
    },
    //写作模式
    writeId: {
      type: Number,
      default: "",
    },
    showInternetToggle: {
      type: Boolean,
      default: true,
    },
    showSampleSelect: {
      type: Boolean,
      default: false,
    },
    sampleOptions: {
      type: Array,
      default: () => [],
    },
    showPermissionSelect: {
      type: Boolean,
      default: false,
    },
    permissionLevel: {
      type: String,
      default: "confirm",
    },
  },
  setup(props, { emit }) {
    const states = reactive({
      inputValue: "",
      instrumentValue: "scripts_gen",
      instrumentOptions: [
        {
          value: "idea_gen",
          label: "创意生成",
        },
        {
          value: "scripts_gen",
          label: "脚本生成",
        },
      ],
      internetChecked: true,
      localChecked: false,
      selectFiles: [],
      isDragOver: false,
      dragDepth: 0,
      selectedSampleIds: [],
      sampleKeyword: "",
      samplePage: 1,
      samplePageSize: 20,
      sampleSelectFocused: false,
    });
    let sampleDropdownScrollEl = null;

    const filteredSampleOptions = computed(() => {
      const keyword = states.sampleKeyword.trim().toLowerCase();
      const list = props.sampleOptions || [];
      if (!keyword) return list;
      return list.filter((item) => getSampleSearchText(item).includes(keyword));
    });
    const visibleSampleOptions = computed(() =>
      filteredSampleOptions.value.slice(0, states.samplePage * states.samplePageSize)
    );
    watch(
      () => props.sampleOptions,
      (list) => {
        const validIds = new Set((list || []).map((item) => item.id));
        states.selectedSampleIds = states.selectedSampleIds.filter((id) => validIds.has(id));
        states.samplePage = 1;
      },
      { deep: true }
    );
    onMounted(async () => {
      try {
        const saved = await window.electronAPI.getSetting?.('localChecked');
        if (saved !== undefined && saved !== null) states.localChecked = saved;
        const savedInternet = await window.electronAPI.getSetting?.('internetChecked');
        if (savedInternet !== undefined && savedInternet !== null) states.internetChecked = savedInternet;
      } catch {}
    });
    onUnmounted(() => {
      unbindSampleDropdownScroll();
    });
    function del(index) {
      states.selectFiles.splice(index, 1);
    }

    function addFileIfNew(f) {
      if (!f) return;
      const index = states.selectFiles.findIndex((item) => item.filePath === f.filePath);
      if (index < 0) states.selectFiles.push(f);
    }

    async function upload() {
      let res = await window.electronAPI.selectFile();
      res.forEach(addFileIfNew);
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    // 真实文件（文件管理器复制/拖入）走路径复用；截图工具/网页复制的图片没有对应磁盘文件，先落盘再入队。
    // Electron 32 起渲染进程 File 对象不再自带 path，需通过 preload 暴露的 webUtils.getPathForFile 解析。
    async function resolveDroppedOrPastedFile(file) {
      if (!file) return;
      const filePath = await window.electronAPI.getPathForFile(file);
      if (filePath) {
        addFileIfNew(await window.electronAPI.resolvePastedFile(filePath));
      } else if (file.type.startsWith("image/")) {
        const dataUrl = await blobToDataUrl(file);
        addFileIfNew(await window.electronAPI.savePastedImage(dataUrl));
      }
    }

    // 纯文本粘贴不受影响——clipboardData.items 里没有 kind='file' 的条目，走不到这里。
    async function handlePaste(event) {
      const items = event.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        await resolveDroppedOrPastedFile(file);
      }
    }

    function onDragEnter() {
      states.dragDepth += 1;
      states.isDragOver = true;
    }
    function onDragOver() {}
    function onDragLeave() {
      states.dragDepth = Math.max(0, states.dragDepth - 1);
      if (states.dragDepth === 0) states.isDragOver = false;
    }
    async function handleDrop(event) {
      states.dragDepth = 0;
      states.isDragOver = false;
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (const file of files) {
        await resolveDroppedOrPastedFile(file);
      }
    }

    const onChangeInternetChecked = () => {
      states.internetChecked = !states.internetChecked;
      window.electronAPI.setSetting?.('internetChecked', states.internetChecked);
    };
    const onChangelocalChecked = () => {
      states.localChecked = !states.localChecked;
      window.electronAPI.setSetting?.('localChecked', states.localChecked);
    };
    const onPermissionLevelChange = (value) => {
      emit("update:permissionLevel", value);
    };
    const onStop = () => {
      emit("stop");
    };
    const onSubmit = () => {
      if (states.inputValue.trim() === "") return;
      emit("componentParams", {
        question: states.inputValue,
        uploadedDocs: states.selectFiles,
        useExternalResource: props.showInternetToggle ? states.internetChecked : false,
        chatMode: states.instrumentValue,
        localChecked: states.localChecked,
        selectedSampleIds: states.selectedSampleIds.slice(0, 2),
      });
      states.inputValue = "";
      states.selectFiles = [];
    };

    function formatSampleLabel(item = {}) {
      const name = item.sourceName || item.title || `样本 ${item.id}`;
      const suffix = item.length ? ` · ${item.length}字` : "";
      return `${name}${suffix}`;
    }

    function getSampleSearchText(item = {}) {
      const analysis = item.analysisProfile || {};
      return [
        item.sourceName,
        item.title,
        item.preview,
        analysis.summary,
        analysis.writingStyle,
        analysis.coreIdea,
        ...(analysis.writingTechniques || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    }

    function filterSamples(keyword = "") {
      states.sampleKeyword = String(keyword || "").trim().toLowerCase();
      states.samplePage = 1;
      nextTick(() => bindSampleDropdownScroll());
    }

    function loadMoreSamplesOnScroll() {
      if (!sampleDropdownScrollEl) return;
      const { scrollTop, scrollHeight, clientHeight } = sampleDropdownScrollEl;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 32;
      if (!nearBottom) return;
      if (visibleSampleOptions.value.length >= filteredSampleOptions.value.length) return;
      states.samplePage += 1;
    }

    function unbindSampleDropdownScroll() {
      if (!sampleDropdownScrollEl) return;
      sampleDropdownScrollEl.removeEventListener("scroll", loadMoreSamplesOnScroll);
      sampleDropdownScrollEl = null;
    }

    function bindSampleDropdownScroll() {
      unbindSampleDropdownScroll();
      sampleDropdownScrollEl =
        document.querySelector(".sample-select-popper .el-select-dropdown__wrap") ||
        document.querySelector(".sample-select-popper .el-scrollbar__wrap");
      if (sampleDropdownScrollEl) {
        sampleDropdownScrollEl.addEventListener("scroll", loadMoreSamplesOnScroll, { passive: true });
      }
    }

    function onSampleDropdownVisible(visible) {
      states.sampleSelectFocused = visible;
      if (visible) {
        states.samplePage = 1;
        nextTick(() => bindSampleDropdownScroll());
      } else {
        states.sampleKeyword = "";
        states.samplePage = 1;
        unbindSampleDropdownScroll();
      }
    }

    function onSampleSelectFocus() {
      states.sampleSelectFocused = true;
    }

    function onSampleSelectBlur() {
      states.sampleSelectFocused = false;
    }

    function handleEnter(e) {
      if (e.shiftKey) {
        // Shift+Enter 插入换行
        const pos = e.target.selectionStart;
        states.inputValue = states.inputValue.slice(0, pos) + '\n' + states.inputValue.slice(pos);
        nextTick(() => { e.target.selectionStart = e.target.selectionEnd = pos + 1; });
      } else {
        onSubmit();
      }
    }

    return {
      upload,
      handleEnter,
      handlePaste,
      handleDrop,
      onDragEnter,
      onDragOver,
      onDragLeave,
      CircleCloseFilled,
      CaretBottom,
      ...toRefs(states),
      onChangeInternetChecked,
      onChangelocalChecked,
      onPermissionLevelChange,
      onSubmit,
      onStop,
      del,
      formatSampleLabel,
      filterSamples,
      onSampleDropdownVisible,
      onSampleSelectFocus,
      onSampleSelectBlur,
      visibleSampleOptions,
    };
  },
};
</script>
  
   <style scoped lang="scss">
::v-deep .el-textarea__inner {
  background-color: white;
  color: black;
}
::v-deep .el-select__suffix {
  display: none;
}
::v-deep .is-focused {
  background-color: aliceblue !important;
}
::v-deep .is-focused span {
  color: #409eff !important;
}
::v-deep .el-select__wrapper {
  text-align: center;
}
::v-deep .el-textarea__inner {
  box-shadow: none !important;
}
::v-deep .el-select__wrapper {
  border-radius: 18px !important;
  height: 100%;
}
::v-deep .el-select__placeholder.is-transparent {
  color: #777777 !important;
}
.selectFiles {
  display: flex;
  flex-wrap: wrap;
  .file {
    margin-right: 10px;
  }
  .uploadImg {
    height: 50px;
    border-radius: 10px;
  }
  .textDoc,
  .image {
    position: relative;
  }
  .close {
    width: 15px;
    position: absolute;
    right: 2px;
    top: 2px;
    cursor: pointer;
    z-index: 999999;
  }
}
.uploadBtn {
  p {
    width: 32px;
    height: 32px;
    background: #ffffff;
    border: 1px solid #e3e8f0;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    &:hover {
      border-color: #93c5fd;
      background: #f5f9ff;
    }
  }
}

.quiz-component {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  transition: box-shadow 0.15s ease;
  &.is-drag-over {
    box-shadow: 0 0 0 2px #0073e5 inset;
  }
  header {
    width: 100%;
    height: 38px;
    background: #c9dbf3;
    display: flex;
    align-items: center;
    border-radius: 10px 10px 0 0;
    padding-left: 12px;
    margin-bottom: 12px;
    img {
      width: 12px;
      height: 12px;
    }
    p {
      margin-left: 6px;
      font-weight: bold;
      font-size: 14px;
      color: #333333;
    }
  }
  .quiz-operation {
    width: 100%;
    height: 36px;
    margin-top: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    &-left {
      display: flex;
      align-items: center;
      gap: 10px;
      .toggle-btn {
        height: 32px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        background: #ffffff;
        border: 1px solid #e3e8f0;
        border-radius: 16px;
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        color: #4a5568;
        white-space: nowrap;
        user-select: none;
        transition: all 0.2s ease;
        .toggle-icon {
          width: 15px;
          height: 15px;
          margin-right: 6px;
        }
        &:hover {
          border-color: #93c5fd;
          color: #2563eb;
          background: #f5f9ff;
        }
        &.active {
          background: #0073e5;
          border-color: #0073e5;
          color: #ffffff;
          box-shadow: 0 2px 6px rgba(0, 115, 229, 0.3);
        }
      }
      .permission-btn {
        .permission-caret {
          margin-left: 6px;
          font-size: 12px;
          transition: color 0.2s ease;
        }
        &.active .permission-caret {
          color: #ffffff;
        }
      }
    }
    &-right {
      display: flex;
      align-items: center;
      gap: 10px;
      .sample-select {
        width: 210px;
        height: 36px;
      }
      .sample-select :deep(.el-select__wrapper) {
        min-height: 32px;
        height: 32px;
        padding: 0 12px;
        background: #ffffff !important;
        border: 1px solid #bfdbfe !important;
        border-radius: 16px !important;
        box-shadow: none !important;
      }
      .sample-select :deep(.el-select__selection) {
        min-width: 0;
        max-width: calc(100% - 28px);
      }
      .sample-select :deep(.el-select__suffix) {
        display: flex !important;
        width: 22px;
        flex: 0 0 22px;
        color: #2563eb !important;
      }
      .sample-select :deep(.el-select__wrapper:hover),
      .sample-select :deep(.el-select__wrapper.is-focused) {
        background: #f8fbff !important;
        border-color: #2563eb !important;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12) !important;
      }
      .sample-select :deep(.el-select__placeholder),
      .sample-select :deep(.el-select__selected-item) {
        color: #1e3a8a !important;
        font-size: 13px;
        font-weight: 700;
      }
      .sample-select :deep(.el-select__input) {
        color: #0f172a !important;
        font-weight: 600;
      }
      .sample-select :deep(.el-tag) {
        max-width: 112px;
        color: #1d4ed8 !important;
        background: #dbeafe !important;
        border-color: #93c5fd !important;
        border-radius: 999px !important;
        overflow: hidden;
      }
      .sample-select :deep(.el-tag__content) {
        min-width: 0;
        max-width: 82px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #1d4ed8 !important;
        font-weight: 700;
      }
      .sample-select :deep(.el-tag__close) {
        color: #1d4ed8 !important;
        background: rgba(37, 99, 235, 0.12) !important;
      }
      .submit {
        height: 32px;
        width: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .stop-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #409eff;
        display: flex;
        align-items: center;
        justify-content: center;
        span {
          display: block;
          width: 12px;
          height: 12px;
          background: #fff;
          border-radius: 2px;
        }
      }
    }
  }
}

:global(.sample-select-popper) {
  background: #ffffff !important;
  border: 1px solid #dbeafe !important;
  border-radius: 10px !important;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14) !important;
  overflow: hidden;
}

:global(.sample-select-popper .el-popper__arrow::before) {
  background: #ffffff !important;
  border-color: #dbeafe !important;
}

:global(.sample-select-popper .el-select-dropdown) {
  background: #ffffff !important;
}

:global(.sample-select-popper .el-select-dropdown__wrap),
:global(.sample-select-popper .el-scrollbar__wrap) {
  max-height: 260px !important;
}

:global(.sample-select-popper .el-select-dropdown__list) {
  padding: 6px !important;
}

:global(.sample-select-popper .el-select-dropdown__item) {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 10px !important;
  min-height: 34px !important;
  height: auto !important;
  padding: 7px 28px 7px 12px !important;
  color: #0f172a !important;
  background: #ffffff !important;
  border-radius: 8px !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  line-height: 1.45 !important;
  white-space: normal !important;
}

:global(.sample-select-popper .el-select-dropdown__item span) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global(.sample-select-popper .el-select-dropdown__item .el-icon) {
  right: 8px !important;
  color: #2563eb !important;
  flex-shrink: 0 !important;
}

:global(.sample-select-popper .el-select-dropdown__item:hover),
:global(.sample-select-popper .el-select-dropdown__item.hover) {
  color: #1d4ed8 !important;
  background: #dbeafe !important;
}

:global(.sample-select-popper .el-select-dropdown__item.selected) {
  color: #2563eb !important;
  background: #dbeafe !important;
  font-weight: 700 !important;
}

:global(.sample-select-popper .el-select-dropdown__empty) {
  color: #64748b !important;
  background: #ffffff !important;
  padding: 14px 0 !important;
}

:global(.sample-select-popper .el-scrollbar__bar.is-vertical > div) {
  background-color: rgba(37, 99, 235, 0.28) !important;
}

:global(.permission-dropdown-popper) {
  background: #ffffff !important;
  border: 1px solid #e3e8f0 !important;
  border-radius: 10px !important;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14) !important;
}

:global(.permission-dropdown-popper .el-popper__arrow::before) {
  background: #ffffff !important;
  border-color: #e3e8f0 !important;
}

:global(.permission-dropdown-popper .el-dropdown-menu) {
  padding: 6px !important;
  background: #ffffff !important;
}

:global(.permission-dropdown-popper .el-dropdown-menu__item) {
  border-radius: 8px !important;
  font-size: 13px !important;
  color: #4a5568 !important;
  padding: 8px 14px !important;
  white-space: nowrap !important;
}

:global(.permission-dropdown-popper .el-dropdown-menu__item:hover) {
  background: #f5f9ff !important;
  color: #2563eb !important;
}

:global(.permission-dropdown-popper .el-dropdown-menu__item.is-active) {
  color: #0073e5 !important;
  font-weight: 700 !important;
  background: #eaf3ff !important;
}
</style>
  
