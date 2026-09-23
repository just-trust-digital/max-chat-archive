class ZipArchive {
  constructor() { this.parts = []; this.entries = []; this.offset = 0; }
  static crc(bytes) {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
  }
  static header(length) { return new DataView(new ArrayBuffer(length)); }
  add(name, bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new TextEncoder().encode(String(bytes));
    const path = new TextEncoder().encode(name);
    if (path.length > 65535 || bytes.length > 0xffffffff) throw new Error('Файл превышает ограничения ZIP.');
    const crc = ZipArchive.crc(bytes);
    const offset = this.offset;
    const local = ZipArchive.header(30);
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
    local.setUint16(26, path.length, true);
    this.parts.push(local.buffer, path, bytes);
    this.offset += 30 + path.length + bytes.length;
    this.entries.push({ path, crc, size: bytes.length, offset });
  }
  blob() {
    const central = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const head = ZipArchive.header(46);
      head.setUint32(0, 0x02014b50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true);
      head.setUint16(8, 0x0800, true); head.setUint32(16, entry.crc, true);
      head.setUint32(20, entry.size, true); head.setUint32(24, entry.size, true);
      head.setUint16(28, entry.path.length, true); head.setUint32(42, entry.offset, true);
      central.push(head.buffer, entry.path); centralSize += 46 + entry.path.length;
    }
    if (this.entries.length > 65535 || this.offset + centralSize > 0xffffffff) throw new Error('Архив слишком большой для ZIP.');
    const end = ZipArchive.header(22);
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true); end.setUint32(12, centralSize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...central, end.buffer], { type: 'application/zip' });
  }
}
