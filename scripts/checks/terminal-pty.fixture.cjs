// PTY 回归用的最小全屏程序：不访问网络、模型、数据库或用户文件。
const esc = String.fromCharCode(27);
const output = (text) => process.stdout.write(text);
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('PTY-PROBE-NOT-A-TTY');
  process.exit(2);
}
process.stdin.setRawMode(true);
process.stdin.resume();

function draw() {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  output(`${esc}[2J${esc}[H${esc}[1;36mPTY-PROBE-READY${esc}[0m\r\n`);
  output(`TTY: input=${process.stdin.isTTY} output=${process.stdout.isTTY}\r\n`);
  output(`TERM:${process.env.TERM}\r\n`);
  output(`PTY-SIZE:${cols}x${rows} PID:${process.pid}\r\n`);
  output('按方向键 / Tab / Ctrl+W；Ctrl+C 退出测试程序，保留 shell。\r\n');
  output(`${esc}[${Math.max(1, rows - 1)};1H${esc}[32mPTY-FOOTER:${cols}x${rows}${esc}[0m`);
  output(`${esc}[7;1H`);
}

output(`${esc}[?1049h`);
draw();
// 活屏必须应答，但切换任务或收起/展开不应重放查询并再次应答。
output(`${esc}[6n`);
process.stdout.on('resize', () => {
  draw();
  output(`PTY-RESIZE:${process.stdout.columns}x${process.stdout.rows}\r\n`);
});
process.stdin.on('data', (chunk) => {
  const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  output(`PTY-HEX:${data.toString('hex')}\r\n`);
  if (data.includes(3)) {
    process.stdin.setRawMode(false);
    output(`${esc}[?1049lPTY-CTRL-C\r\n`);
    process.exit(0);
  }
});
