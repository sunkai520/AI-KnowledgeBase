// 视频自动拼接：多段素材按顺序拼接成一条成片，支持简单淡入淡出转场 + 字幕烧录 + 背景音乐。
// 分三步走（比单个巨型 filter_complex 更容易保证正确性）：
//   1. 逐段单独处理（统一分辨率/帧率 + 转场淡入淡出 + 字幕），输出规格完全一致的临时文件
//   2. concat 分离器无损拼接（各段规格一致，可以 -c copy，不用重新编码，速度快）
//   3. 可选：叠加背景音乐（循环铺满，按最短对齐裁剪）
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { getSystemPath } from "../utils/common";
import { resolveLocalMediaPath, GENERATED_DIR } from "./mediaProvider";

const fs = require("fs-extra");
const path = require("path");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const TARGET_FPS = 25;
const TRANSITION_SEC = 0.4;

// ffmpeg filter 语法里冒号/反斜杠是特殊字符，路径统一转正斜杠 + 转义盘符冒号
function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function findSubtitleFont() {
  const candidates =
    process.platform === "win32"
      ? ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc"]
      : process.platform === "darwin"
      ? ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Light.ttc"]
      : ["/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(new Error(`读取素材时长失败：${err.message}`));
      resolve(Number(data?.format?.duration) || 0);
    });
  });
}

function runFfmpeg(build) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    build(cmd);
    cmd
      .on("error", (err) => reject(new Error(err.message)))
      .on("end", () => resolve())
      .run();
  });
}

// 单段素材：统一规格 + 转场淡入淡出 + 字幕烧录，输出到临时文件
async function processClip(clip, index, total, tmpDir, fontFile) {
  const duration = await probeDuration(clip.localPath);
  const filters = [
    `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${TARGET_FPS}`,
  ];
  if (index > 0) filters.push(`fade=t=in:st=0:d=${TRANSITION_SEC}`);
  if (index < total - 1 && duration > TRANSITION_SEC * 2) {
    filters.push(`fade=t=out:st=${(duration - TRANSITION_SEC).toFixed(2)}:d=${TRANSITION_SEC}`);
  }

  if (clip.subtitle && fontFile) {
    const txtPath = path.join(tmpDir, `sub-${index}.txt`);
    fs.writeFileSync(txtPath, clip.subtitle, "utf-8");
    filters.push(
      `drawtext=fontfile='${escapeFilterPath(fontFile)}':textfile='${escapeFilterPath(txtPath)}':` +
        `fontsize=32:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-th-50`
    );
  }

  const outPath = path.join(tmpDir, `clip-${index}.mp4`);
  await runFfmpeg((cmd) => {
    cmd
      .input(clip.localPath)
      .videoFilters(filters)
      .outputOptions(["-an", "-c:v libx264", "-preset veryfast", "-pix_fmt yuv420p"])
      .output(outPath);
  });
  return outPath;
}

// 截取一段视频的最后一帧，存成图片。用于「同一镜头分段延长」时的接力：
// 上一段视频的结束画面作为下一段图生视频的起始图，保证动作/位置连续，不在拼接处跳变。
export async function extractLastFrame(videoPath) {
  const localPath = await resolveLocalMediaPath(videoPath, "videos", "mp4");
  const duration = await probeDuration(localPath);
  const seekTime = Math.max(0, duration - 0.1);

  const dir = path.join(getSystemPath("uploads"), GENERATED_DIR, "images");
  fs.ensureDirSync(dir);
  const filename = `lastframe-${Date.now()}-${Math.round(Math.random() * 1e9)}.png`;
  const outPath = path.join(dir, filename);

  await runFfmpeg((cmd) => {
    cmd.input(localPath).seekInput(seekTime).outputOptions(["-frames:v 1", "-q:v 2"]).output(outPath);
  });

  return { filePath: outPath, url: `http://127.0.0.1:5120/uploads/${GENERATED_DIR}/images/${filename}` };
}

// 截取视频首帧存成小图，用作"创作管理"列表的视频封面。
// 直接在网格里渲染 <video> 标签会导致多个视频并发解码，容易卡死出现黑块，
// 所以列表只展示这张静态截图，真正的 <video> 只在点击预览时才创建。
export async function extractPosterFrame(localVideoPath, outPath) {
  fs.ensureDirSync(path.dirname(outPath));
  await runFfmpeg((cmd) => {
    cmd
      .input(localVideoPath)
      .seekInput(0.1)
      .outputOptions(["-frames:v 1", "-q:v 4", "-vf scale=480:-1"])
      .output(outPath);
  });
  return outPath;
}

/**
 * @param {Array<{videoPath: string, subtitle?: string}>} clips 按播放顺序排列的素材
 * @param {string} [bgmUrl] 背景音乐地址（本地路径/URL），不传则不加
 * @param {string} [outputName] 输出文件名（不含扩展名）
 */
export async function composeVideo({ clips, bgmUrl, outputName }) {
  if (!Array.isArray(clips) || clips.length === 0) throw new Error("clips 不能为空");

  const uploadsDir = getSystemPath("uploads");
  const tmpDir = path.join(uploadsDir, "tmp", `compose-${Date.now()}`);
  fs.ensureDirSync(tmpDir);
  const fontFile = findSubtitleFont();

  try {
    // 1. 解析每段素材为本地文件路径
    const localClips = [];
    for (const c of clips) {
      const localPath = await resolveLocalMediaPath(c.videoPath, "videos", "mp4");
      localClips.push({ ...c, localPath });
    }

    // 2. 逐段处理
    const processed = [];
    for (let i = 0; i < localClips.length; i++) {
      processed.push(await processClip(localClips[i], i, localClips.length, tmpDir, fontFile));
    }

    // 3. concat 分离器无损拼接（同规格，可 -c copy）
    const listPath = path.join(tmpDir, "list.txt");
    fs.writeFileSync(
      listPath,
      processed.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
      "utf-8"
    );
    const concatPath = path.join(tmpDir, "concat.mp4");
    await runFfmpeg((cmd) => {
      cmd.input(listPath).inputOptions(["-f concat", "-safe 0"]).outputOptions(["-c copy"]).output(concatPath);
    });

    // 4. 背景音乐（可选）：循环铺满整段时长，按最短对齐裁剪
    const videoDir = path.join(uploadsDir, GENERATED_DIR, "videos");
    fs.ensureDirSync(videoDir);
    const filename = `${outputName || "compose-" + Date.now()}.mp4`;
    const finalPath = path.join(videoDir, filename);

    if (bgmUrl) {
      const bgmLocalPath = await resolveLocalMediaPath(bgmUrl, "audio", "mp3");
      await runFfmpeg((cmd) => {
        cmd
          .input(concatPath)
          .input(bgmLocalPath)
          .inputOptions(["-stream_loop -1"])
          .outputOptions(["-map 0:v:0", "-map 1:a:0", "-c:v copy", "-c:a aac", "-shortest"])
          .output(finalPath);
      });
    } else {
      fs.copyFileSync(concatPath, finalPath);
    }

    return { filePath: finalPath, url: `http://127.0.0.1:5120/uploads/${GENERATED_DIR}/videos/${filename}` };
  } finally {
    fs.removeSync(tmpDir);
  }
}
