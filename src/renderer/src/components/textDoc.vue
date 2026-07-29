<template>
  <div class="textDoc">
    <img :src="doc" />
    <div>
      <div class="name">{{ docObj.fileName }}</div>
      <div class="des">{{ docObj.sizeFormatted }}</div>
    </div>
  </div>
</template>

<script setup>
import { doc } from "@renderer/assets/base64.ts";
let props = defineProps({
  docObj: {
    type: Object,
    default: () => {
      return {};
    },
  },
});
</script>

<style lang="scss" scoped>
.textDoc {
  display: flex;
  align-items: center;
  cursor: pointer;
  background-color: #e9e6e6;
  padding: 5px 20px;
  border-radius: 10px;
  position: relative;
  img {
    width: 30px;
    height: 30px;
    margin-right: 10px;
  }
  .name {
    max-width: 100px;
    overflow: hidden;
    /* 第二步：让文本不会换行， 在同一行继续 */
    white-space: nowrap;
    /* 第三步：用省略号来代表未显示完的文本 */
    text-overflow: ellipsis;
    margin-bottom: 5px;
  }
  .des {
    font-size: 14px;
    color: #00000069;
  }
}
</style>