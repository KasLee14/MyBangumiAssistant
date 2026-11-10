# web/tools：前端构建期脚本

`web/` 没有自己的 `package.json`（vite 的 root 就是它，由 `bangumi/vite.config.ts` 驱动），
所以这里的脚本**不挂 npm script**，直接在仓库根用 `node` 跑。

## `gen-content-cards.mjs`

解析 `web/src/components/content/` 下每个组件自己声明的 props interface（字段名、可选性、
枚举成员、JSDoc 说明与 `（例：…）` 例值），生成
`web/src/components/content/content-cards.generated.json`——卡片实验室（`/lab`）的字段表单
全部由它驱动。

```bash
node web/tools/gen-content-cards.mjs            # 写盘（内容没变则不写）
node web/tools/gen-content-cards.mjs --check    # 只比对，不一致退出码 1
```

规则：

1. **生成物不许手改**——改组件的 props 或 JSDoc，再跑一次。
2. 组件的 props interface 必须叫 `<Kind>Props`（载荷是数组根的另有 `<Kind>ItemProps`），
   且必须与协议载荷等价（每个组件内有 `AssertTrue<Equal<…>>` 断言，不一致是编译错误）。
3. 例值写在字段注释里，格式 `说明（例：值）`；没有例值时按控件给一个空值
   （`text` → 空串、`number` → `0`、`select` → 第一个选项、`json` → `[]` / `{}`）。
4. 脚本要求「组件目录的 kind 集合」与文档页 `LIBRARY_SECTIONS` 的 kind 集合**双向相等**：
   加了组件没加示例、或加了示例没加组件，都会失败。
