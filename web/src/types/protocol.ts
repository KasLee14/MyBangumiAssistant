/**
 * 跨端协议的**唯一入口**（re-export 中转）。
 *
 * 定义只有一份，在宿主 `bangumi/src/web/protocol.ts`（见仓库根 `AGENTS.md` 规则 3：
 * 跨端类型只有一份，在宿主侧，前端**不复制**）。这里只做 `export type *` 转发，
 * 不产生第二份定义。
 *
 * 为什么要有这一层：协议类型被前端各层消费（`page/`、`components/`、`utils/`、
 * `constants/`、`types/`），此前每个消费点都写一遍
 * `'../../../../bangumi/src/web/protocol'` 这类深路径——协议文件换位置、
 * 或某个文件在目录改造中改变深度，都要逐处重算相对深度。收敛到本文件后，
 * 消费点只依赖 `types/protocol`，深度变化由这一行承担。
 */

export type * from '../../../bangumi/src/web/protocol';
