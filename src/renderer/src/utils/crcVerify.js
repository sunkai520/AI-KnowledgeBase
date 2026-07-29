function hexToBytes(hexString) {
  const bytes = [];
  for (let i = 0; i < hexString.length; i += 2) {
    bytes.push(parseInt(hexString.substr(i, 2), 16));
  }
  return bytes;
}

function crc16Modbus(bytes) {
  let crc = 0xffff;
  const polynomial = 0xa001;

  for (let i = 0; i < 58; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ polynomial;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}

export function verifyCRC(hexData) {
  const bytes = hexToBytes(hexData.replace(/\s/g, ""));
  if (bytes.length !== 60) {
    throw new Error("数据长度必须为60字节(30个十六进制字符对)");
  }

  const calculatedCRC = crc16Modbus(bytes);
  const receivedCRC = (bytes[59] << 8) | bytes[58];

  return {
    isValid: calculatedCRC === receivedCRC,
    calculated: calculatedCRC.toString(16).toUpperCase().padStart(4, "0"),
    received: receivedCRC.toString(16).toUpperCase().padStart(4, "0"),
  };
}
