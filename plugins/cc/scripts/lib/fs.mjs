export function isProbablyText(buffer) {
  if (!buffer || buffer.length === 0) return true;
  const limit = Math.min(buffer.length, 4096);
  let controlBytes = 0;
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return false;
    if (buffer[i] < 7 || (buffer[i] > 13 && buffer[i] < 32) || buffer[i] === 127) controlBytes += 1;
  }
  return controlBytes / limit <= 0.3;
}
