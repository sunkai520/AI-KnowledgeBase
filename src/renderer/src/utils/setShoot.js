/**
 * 字节转换
 */
export function utils_hex_to_uint8array(hex) {
  hex = hex.replace(/\s*/g, ""); //remove space
  var uint8 = [];
  for (let i = 0, j = 0; i < hex.length; i += 2) {
    uint8[j++] = parseInt(hex.substring(i, i + 2), 16);
  }
  var arrayBuffer_uint8 = new Uint8Array(uint8.length);
  for (let i = 0; i < uint8.length; i++) {
    arrayBuffer_uint8[i] = uint8[i];
  }
  return arrayBuffer_uint8;
}
/**
 *
 * @param {*} uint8Array
 * @returns 将十进制数组转换成16进制字符串
 */
export function uint8ArrayToHex(uint8Array) {
  return Array.prototype.map
    .call(uint8Array, (x) => {
      // 将每个元素转换为16进制字符串，并确保是两位
      const hex = ("00" + x.toString(16)).slice(-2);
      return hex;
    })
    .join(" "); // 将所有16进制字符串连接成一个完整的字符串
}

export function sendCmd(serialPortValue, cmd) {
  // let data = utils_hex_to_uint8array("01 03 00 00 55H AAH");
  let code = calculateCRC16Modbus(cmd);
  let data = utils_hex_to_uint8array(code);
  // window.electronAPI.sendLog("===" + cmd);
  window.electronAPI.sendMessages({
    path: serialPortValue,
    data: data,
  });
}
// 设置wifi模块内容信息
export function sendCmd2(serialPortValue, cmd) {
  let asciiCodes = stringToAscii(cmd);
  console.log(
    asciiToString(asciiCodes),
    "将ascii转义回字符串看是否拼接是否正确"
  );
  window.electronAPI.sendMessages({
    path: serialPortValue,
    data: asciiCodes,
  });
}
// 字符串转 ASCII/Unicode 数组
function stringToAscii(str) {
  return Array.from(str).map((ch) => ch.charCodeAt(0));
}

// ASCII/Unicode 数组转字符串
function asciiToString(arr) {
  return arr.map((code) => String.fromCharCode(code)).join("");
}
// 实弹验证的软件发送给硬件数据
export function sendCmd1(cmd) {
  let code = calculateCRC16Modbus(cmd);
  window.electronAPI.sendLog("精度报靶软件已经发送指令：" + code);
  let data = utils_hex_to_uint8array(code);
  window.electron.ipcRenderer.send("send-command", code.split(" ")[0], data); // 触发主进程发送
}
/*计算CRC-16/MODBUS校验位高低位*/
export function calculateCRC16Modbus(dataHexString) {
  let resultStr = dataHexString.replace(/\s/g, "");
  const dataBytes = [];
  for (let i = 0; i < resultStr.length; i += 2) {
    dataBytes.push(parseInt(resultStr.substr(i, 2), 16));
  }
  let crc = 0xffff;
  const polynomial = 0xa001; // This is the polynomial x^16 + x^15 + x^2 + 1
  for (const byte of dataBytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x0001) {
        crc = ((crc >> 1) ^ polynomial) & 0xffff;
      } else {
        crc >>= 1;
      }
    }
  }

  crc = pad(crc.toString(16).toUpperCase(), 4); //补0(不然会出八阿哥)
  let crcArr = new Array(2);
  crcArr[0] = crc.substring(2, 4);
  crcArr[1] = crc.substring(0, 2);
  let code = crcArr[1] + " " + crcArr[0];
  return dataHexString + " " + code;
}
// 将十六进制转换为二进制
export function hexToBinary(hex) {
  // 将16进制转换为10进制
  const decimal = parseInt(hex, 16);
  // 将10进制转换为二进制
  const binary = decimal.toString(2);
  return pad(binary, 8);
}
//将十进制转换为二进制
export function tenextendtwo(decimalNumber) {
  return decimalNumber.toString(2).padStart(8, "0");
}
// 将十进制转换成十六进制
export function tenextendsixteen(val) {
  var str = "";
  const arr = val.split(" ");
  arr.forEach((element, index) => {
    str +=
      Number(element).toString(16).padStart(2, "0") +
      (index == arr.length - 1 ? "" : " ");
  });
  return str;
}
// 左侧补齐0
function pad(str, max) {
  str = str.toString();
  return str.length < max ? pad("0" + str, max) : str;
}
//靶机返回数据每个位代表的含义
/**
 * 1：本机地址
    2：功能码01(回发来自计算机的“功能码01”)
    		将此字节回发，表示靶机已接收到相关命令。
3：功能码02（4个传感器的激发状态）
    		bit:0 —  0:传感器1无触发；		1:传感器1已触发；
          	bit:1 —  0:传感器2无触发；		1:传感器2已触发；
         	bit:2 —  0:传感器3无触发；		1:传感器3已触发；
          	bit:3 —  0:传感器4无触发；		1:传感器3已触发；
     	4：功能码03（坐标有效功能码）
    		  >03H时：表示检测到有效坐标
    	为03H时：表示无有效坐标
5：X坐标高字节
    		bit:7 = 1时：表示负坐标
    		bit:7 = 0时：表示正坐标
6：X坐标低字节（mm）
   备注：X坐标高字节低7位和X坐标低字节共同组成X坐标绝对值。    
7：Y坐标高字节
			bit:7 = 1时：表示负坐标
    		bit:7 = 0时：表示正坐标
8：Y坐标低字节（mm）
   备注：Y坐标高字节低7位和Y坐标低字节共同组成Y坐标绝对值。
9：子弹速度高字节
10：子弹速度低字节（m/S）
11：环境温度字节（℃）
12：电池电量字节
靶机可以发送实际电量0％-- 100％
13：主控制器负载状态字节
    		表示控制器负载工作状态
   	 		bit:0=1   照明开
    	bit:0=0   照明关
       bit:1=0   靶机非显示状态
       bit:1=1   靶机显示状态
       bit:2=0   靶机非隐藏状态
       bit:2=1   靶机隐藏状态
       bit:4 / bit:3 = 0/0  照明灯为白光   
       bit:4 / bit:3 = 0/1  照明灯为黄光
       bit:4 / bit:3 = 1/0  照明灯为激光
14：主控制器故障字节
    			bit:0=1   控制器EEPROM 故障
    			bit:1=1   控制器环境温度传感器故障
    			bit:2=1   靶机内部通讯故障
				bit:3=1   起倒电机故障或水平位置光电开关故障
				bit:4=1   起倒电机故障或垂直位置光电开关故障
              bit:5=1   电池故障
    	15：传感器01故障字节（前）
    		用于导电靶自检    		
16：导电靶牌区域短路检测单元01（详见导电靶牌粘连故障协议）
17：导电靶牌区域短路检测单元02（详见导电靶牌粘连故障协议）
18：导电靶牌区域短路检测单元03（详见导电靶牌粘连故障协议）
 */
