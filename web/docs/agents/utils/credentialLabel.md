# 凭据来源措辞（`utils/credentialLabel.ts`）

## 简介

凭据来源四态的共用措辞表：它为什么单独成文件、四态含义，以及改动规则。

同一句措辞出现在**两个**地方：

- `components/dialog/ModelDialog.tsx`：提供方下拉里每个选项的后缀（`deepseek · 已保存在本机 · 2 个模型`）；
- `components/dialog/SettingsDialog.tsx`：设置「模型配置」行的当前值（`deepseek · 已保存在本机`）。

放在任一组件里都会让另一处复制一份，措辞随后漂移。抽到这里后，**改文案只有一个位置**。

四态来自协议 `ProviderOptionView.authSource`，由宿主侧 `session.ts` 的 `authSourceOf()` 归一。

**不覆盖**：判定逻辑——哪些提供方可清除在 `ModelDialog`，能否保存到本机看 `catalog.canPersistCredentials`（见 §规则）。

上层：[readme.md](readme.md)。

## 使用说明

- **改措辞、或协议新增 `authSource` 取值前先读 §规则**：三条约定都在那里；`Record<...>` 会让漏写直接编译失败，不要用 `Partial` 绕过。
- **只想查某个 `authSource` 的含义或文案**：直接查 §索引 的四态表与 `AUTH_LABEL`，不必通读本文。
- 只是疑惑"这么小为何单独成文件"：读 §简介 里「同一句措辞出现在**两个**地方」那两段即可。
- 本层通用规则（无组件无 hook、不复制协议类型、错误只抛出、文案集中）见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 只放措辞，不放判定

哪些提供方可清除、能否保存到本机等判定分别在 `ModelDialog`（`authSource === 'stored'`）与 `catalog.canPersistCredentials`，不要在这里加逻辑。

**违反后果**：判定分散（清除资格在 `ModelDialog`、能否保存看 `catalog`）。

### 新增 `authSource` 时协议与宿主先改

新增一种 `authSource` 时：协议与宿主先加（`ProviderOptionView` 与 `authSourceOf`），这里再补一行——`Record<...>` 会让漏写直接编译失败。**不要用 `Partial` 绕过。**

### 文案 4–6 字、不带句号

因为它被拼进 `provider · 状态 · N 个模型` 这种行内串。

**违反后果**：被拼进 `provider · 状态 · N 个模型` 时读起来断裂。

## 索引

### `AUTH_LABEL` 与四态

```ts
export const AUTH_LABEL: Record<ProviderOptionView['authSource'], string> = {
  runtime: '本次运行已填入',
  environment: '来自环境变量',
  stored: '已保存在本机',
  none: '尚未配置',
};
```

四态与界面含义：

| 值 | 含义 | 界面上的实际含义 |
|---|---|---|
| `runtime` | 本次运行里由浏览器填入的密钥 | 进程重启后需要重填 |
| `environment` | 来自环境变量 | 与浏览器无关，重启仍在 |
| `stored` | 来自本机凭据存储（`auth.json`） | 重启后仍然生效，可被「清除已保存的密钥」删除 |
| `none` | 尚未配置 | 需要先填密钥，模型列表才可用 |

### 想找的东西 → 去哪

| 想找的东西 | 去哪 |
|---|---|
| 为什么 9 行也单独成文件 | §简介 里「同一句措辞出现在**两个**地方」那两段（两个消费点与措辞漂移的理由） |
| 某个 `authSource` 的文案与界面含义 | §索引 的「`AUTH_LABEL` 与四态」 |
| 改动约定 | §规则（只放措辞、新增取值先改协议与宿主、文案 4–6 字不带句号） |
