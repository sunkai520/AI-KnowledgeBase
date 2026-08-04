import { tool } from "@langchain/core/tools";
import * as z from "zod";
import {
  generateImageFromText,
  generateVideoFromImage,
  generateVideoFromFirstLastFrame,
  generateVideoFromReferences,
} from "./mediaProvider";
import { composeVideo, extractLastFrame } from "./videoComposer";

// 文生图
export const generateImageTool = tool(
  async ({ prompt, size }) => {
    try {
      const { url } = await generateImageFromText({ prompt, size });
      return `图片已生成：${url}\n（如果后续还要用这张图生成视频，请直接复用这个地址；图片本身已自动展示给用户了，你的最终回复不需要再重复这个地址或用 markdown 语法插入图片，简单描述/确认一下即可）`;
    } catch (e) {
      return `图片生成失败：${e.message}`;
    }
  },
  {
    name: "generate_image",
    description:
      "文生图：根据文字描述生成一张图片。常用于给「图生视频」准备素材，也可直接用于配图需求。返回的图片地址可直接传给 generate_video_from_image。",
    schema: z.object({
      prompt: z.string().describe("图片内容的详细文字描述，越具体效果越好（画面主体、风格、构图、光线等）"),
      size: z.string().optional().describe("图片尺寸，如 1024*1024、1280*720，不传则使用默认 1024*1024"),
    }),
  }
);

// 图生视频
export const generateVideoFromImageTool = tool(
  async ({ imagePath, prompt, duration }) => {
    try {
      const { url } = await generateVideoFromImage({ imagePath, prompt, duration });
      return `视频已生成：${url}\n（如果后续还要用这段视频拼接成片，请直接复用这个地址传给 compose_video；视频本身已自动展示给用户了，你的最终回复不需要再重复这个地址或插入视频标签，简单描述/确认一下即可）`;
    } catch (e) {
      return `视频生成失败：${e.message}`;
    }
  },
  {
    name: "generate_video_from_image",
    description:
      "图生视频：基于一张图片（通常是 generate_image 生成的图片地址）和运镜/动效描述，生成一段短视频素材。" +
      "生成的视频地址可以作为素材传给 compose_video 做多段拼接。" +
      "注意：如果同一个角色/场景需要分成多段视频（比如单段最长15秒，但要延长同一个镜头的时长超过这个上限），" +
      "优先用 generate_video_from_frames（首尾帧）：把这一段的结束画面也指定出来，一步生成过渡视频，" +
      "只有在拿不到明确的结束画面时才退回旧办法——用 extract_video_last_frame 取上一段视频的最后一帧作为这一段的输入图片。" +
      "如果需要同时把多个元素（比如角色图+场景图+道具图）融合进同一段视频，改用 generate_video_from_references。" +
      "用户如果明确要求了具体时长（比如「生成10秒的视频」），一定要把这个数字原样传给 duration 参数精确控制，" +
      "不要靠多次调用/多段拼接去凑时长，否则拼接后的总时长会跟用户要求的对不上。",
    schema: z.object({
      imagePath: z.string().describe("图片地址，通常是 generate_image 返回的图片 URL，或 extract_video_last_frame 的输出"),
      prompt: z.string().optional().describe("对视频运镜/动效的描述，如镜头如何运动、画面如何变化"),
      duration: z.number().optional().describe("视频时长（秒），整数，支持2-15秒；用户没有明确要求时长时不传，模型会用默认时长（约5秒）"),
    }),
  }
);

// 首尾帧生视频
export const generateVideoFromFramesTool = tool(
  async ({ firstImagePath, lastImagePath, prompt, duration }) => {
    try {
      const { url } = await generateVideoFromFirstLastFrame({ firstImagePath, lastImagePath, prompt, duration });
      return `视频已生成：${url}\n（如果后续还要用这段视频拼接成片，请直接复用这个地址传给 compose_video；视频本身已自动展示给用户了，你的最终回复不需要再重复这个地址或插入视频标签，简单描述/确认一下即可）`;
    } catch (e) {
      return `视频生成失败：${e.message}`;
    }
  },
  {
    name: "generate_video_from_frames",
    description:
      "首尾帧生视频：给定起始画面和结束画面各一张图，生成两者之间的过渡视频。" +
      "最适合「同一镜头分段延长」的场景：把上一段的结束画面（可用 extract_video_last_frame 截取）当作这一段的起始图，" +
      "再指定这一段想结束在什么画面，一次生成就能保证动作/构图从头到尾连贯，不需要再靠多次尝试凑效果。" +
      "生成的视频地址可以作为素材传给 compose_video 做多段拼接。",
    schema: z.object({
      firstImagePath: z.string().describe("起始画面图片地址"),
      lastImagePath: z.string().describe("结束画面图片地址"),
      prompt: z.string().optional().describe("对过渡过程/运镜的描述"),
      duration: z.number().optional().describe("视频时长（秒），不传则使用模型默认时长；部分模型可能固定时长，实际以生成结果为准"),
    }),
  }
);

// 参考生视频：多张参考图融合成一段视频
export const generateVideoFromReferencesTool = tool(
  async ({ imagePaths, prompt, duration }) => {
    try {
      const { url } = await generateVideoFromReferences({ imagePaths, prompt, duration });
      return `视频已生成：${url}\n（如果后续还要用这段视频拼接成片，请直接复用这个地址传给 compose_video；视频本身已自动展示给用户了，你的最终回复不需要再重复这个地址或插入视频标签，简单描述/确认一下即可）`;
    } catch (e) {
      return `视频生成失败：${e.message}`;
    }
  },
  {
    name: "generate_video_from_references",
    description:
      "参考生视频：传入1~5张参考图（比如角色图、场景图、道具图），模型把这些元素融合进同一段视频。" +
      "在 prompt 里用 character1、character2 等依次指代 imagePaths 数组里第1、第2张图，" +
      "比如 imagePaths 第一张是角色照片，prompt 里就写「character1 在海边散步」。" +
      "适合「让这个角色出现在这个场景里」这类需要同时保留多个视觉元素的生成需求，" +
      "跟只能吃一张图的 generate_video_from_image 不是一回事。" +
      "生成的视频地址可以作为素材传给 compose_video 做多段拼接。",
    schema: z.object({
      imagePaths: z.array(z.string()).min(1).max(5).describe("参考图片地址列表，最多5张，按顺序对应 prompt 里的 character1/character2/..."),
      prompt: z.string().describe("画面内容描述，用 character1/character2 等指代对应的参考图"),
      duration: z.number().optional().describe("视频时长（秒），支持2-10秒，不传则使用默认时长（约5秒）"),
    }),
  }
);

// 截取视频最后一帧：用于同一镜头分段延长时的动作接力（避免每段都用同一张原图导致的跳变）
export const extractLastFrameTool = tool(
  async ({ videoPath }) => {
    try {
      const { url } = await extractLastFrame(videoPath);
      return `末帧已截取：${url}\n（这张图可以直接作为下一段 generate_video_from_image 的输入图片，保证动作接续上一段结束的画面）`;
    } catch (e) {
      return `截取末帧失败：${e.message}`;
    }
  },
  {
    name: "extract_video_last_frame",
    description:
      "从一段视频里截取最后一帧存成图片。适用场景：同一个镜头/场景需要分成多段视频拼接来延长时长时，" +
      "把上一段视频的最后一帧作为下一段 generate_video_from_image 的输入图，让动作/位置从上一段结束的地方自然延续，而不是每段都从同一张静态图重新开始（那样拼接处会有明显的动作跳变）。",
    schema: z.object({
      videoPath: z.string().describe("视频地址，通常是 generate_video_from_image 返回的视频 URL"),
    }),
  }
);

// 视频自动拼接
export const composeVideoTool = tool(
  async ({ clips, bgmUrl, outputName }) => {
    try {
      const { url } = await composeVideo({ clips, bgmUrl, outputName });
      return `成片已合成：${url}\n（成片已自动展示给用户了，你的最终回复不需要再重复这个地址或插入视频标签，简单描述/确认一下即可）`;
    } catch (e) {
      return `视频合成失败：${e.message}`;
    }
  },
  {
    name: "compose_video",
    description:
      "把多段视频素材按顺序拼接成一条完整视频，自带简单淡入淡出转场，支持逐段字幕和背景音乐。" +
      "素材通常来自多次调用 generate_video_from_image 得到的视频地址，按用户要求的分镜顺序传入 clips。" +
      "适合「做一个xx场景的短视频/广告片」这类需要先规划分镜、逐段生成素材、最后合成一条视频的任务。",
    schema: z.object({
      clips: z
        .array(
          z.object({
            videoPath: z.string().describe("视频素材地址，通常是 generate_video_from_image 返回的视频 URL"),
            subtitle: z.string().optional().describe("这一段素材要叠加显示的字幕文字，不传则不加字幕"),
          })
        )
        .min(1)
        .describe("按播放顺序排列的视频片段列表"),
      bgmUrl: z.string().optional().describe("背景音乐文件地址（本地路径或 URL），不传则不加背景音乐"),
      outputName: z.string().optional().describe("输出文件名（不含扩展名），不传则自动生成"),
    }),
  }
);
