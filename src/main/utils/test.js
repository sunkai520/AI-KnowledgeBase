import {
  browserOpen,
  browserState,
  browserClick,
  browserInput,
  browserWait,
  browserScroll,
  browserDoctor,
  browserScreenshot
} from "./browser-use.js";

export async function test() {
// let hj =await browserDoctor()
// console.log(hj,"hj")
let rr = await browserOpen("https://www.xiaohongshu.com/explore/69bcac55000000001f0034a6?xsec_token=ABOdUmh3U5H1xL6S2uEXzmty3JjnhMV_Hf0rjbpgylMFM=&xsec_source=pc_feed", {
  headed: true,
  // useLocalChrome:true,
  // executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"
});
await browserWait()
// let sss = await browserScreenshot();
// return 
let tt = await browserState();
await browserWait()
console.log(tt,"ttq1")
//   let cc  = await browserClick(21);
//   console.log(cc,"cc")
let ii = await browserInput(30,"hello");
console.log(ii,"ii")
await browserWait()
let tt1 = await browserState();
await browserWait()
let cc  = await browserClick(13);
await browserWait()
let result = await browserState();
await browserWait()
let bb =await browserScroll();
console.log(bb,"nn")

}
