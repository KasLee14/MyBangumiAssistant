import type { ContentBlockView } from './protocol';

/**
 * 内容块的 kind 清单（12 个定制组件的 `type`）。
 *
 * **从协议派生，不再手写第二份清单**：`ContentBlockView` 的 `type` 正是那 12 个组件名
 * （文本块在 `TextBlock` 里，不属于这个联合），所以协议加一种块时这里自动跟随。
 * 改造前这里是一份手写的 12 成员联合，与协议各写一遍，靠注册表末尾的
 * `ContentRegistryCoverage` 断言夹住；派生之后那条断言变成恒等，已一并删除。
 *
 * 取值就是**组件名**（与 `components/content/` 的文件名一致），因此不需要「语义名 → 组件」
 * 的对照表。真正的穷尽检查在注册表：`satisfies { [K in ContentKind]: ContentRenderer }`
 * 要求每个 kind 都有组件，少一个就编译失败。
 *
 * 类型本身放这里（而不是注册表）：它同时被注册表、文档页数据与调试页消费，是跨模块共享的
 * 叶子定义。留在注册表会让纯数据层反向依赖组件实现。
 *
 * 只写 `import type`：本文件是**纯类型叶子**，运行期不带任何依赖——`page/library/constants/
 * sections.ts` 会被宿主测试以 `data:` 模块加载，这条链上不能有任何运行期引用。
 */
export type ContentKind = ContentBlockView['type'];
