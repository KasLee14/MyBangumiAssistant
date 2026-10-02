// 只用于离线CLI测试：让管道输入通过TTY入口检查，仍走普通文本展示。
import './dialogue-preload.mjs';
Object.defineProperty(process.stdin,'isTTY',{value:true});
