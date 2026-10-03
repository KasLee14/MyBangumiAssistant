# 凭据来源措辞（`utils/credentialLabel.ts`）

## 使用说明

### 这份文档是什么

凭据来源四态的共用措辞表：它为什么单独成文件、四态含义，以及改动规则。

上层：[readme.md](readme.md)。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §为什么 9 行也单独成文件 | 疑惑"这么小为何单独成文件"、想把它合并进组件之前 |
| §内容 | 改措辞、或协议新增 `authSource` 取值时 |
| §规则 | 收尾核对（三条约定） |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **只放措辞，不放判定** —— 违反后果：判定分散（清除资格在 `ModelDialog`、能否保存看 `catalog`）。
2. **新增 `authSource` 时协议与宿主先改**，`Record<...>` 会让漏写直接编译失败 —— 不要用 `Partial` 绕过。
3. **文案 4–6 字、不带句号** —— 违反后果：被拼进 `provider · 状态 · N 个模型` 时读起来断裂。

## 为什么 9 行也单独成文件

同一句措辞出现在**两个**地方：

- `components/dialog/ModelDialog.tsx`：提供方下拉里每个选项的后缀（`deepseek · 已保存在本机 · 2 个模型`）；
- `components/dialog/SettingsDialog.tsx`：设置「模型配置」行的当前值（`deepseek · 已保存在本机`）。

放在任一组件里都会让另一处复制一份，措辞随后漂移。抽到这里后，**改文案只有一个位置**。

## 内容

```ts
export const AUTH_LABEL: Record<ProviderOptionView['authSource'], string> = {
  runtime: '本次运行已填入',
  environment: '来自环境变量',
  stored: '已保存在本机',
  none: '尚未配置',
};
```

四态来自协议 `ProviderOptionView.authSource`，由宿主侧 `session.ts` 的 `authSourceOf()` 归一：

| 值 | 含义 | 界面上的实际含义 |
|---|---|---|
| `runtime` | 本次运行里由浏览器填入的密钥 | 进程重启后需要重填 |
| `environment` | 来自环境变量 | 与浏览器无关，重启仍在 |
| `stored` | 来自本机凭据存储（`auth.json`） | 重启后仍然生效，可被「清除已保存的密钥」删除 |
| `none` | 尚未配置 | 需要先填密钥，模型列表才可用 |

## 规则

1. **只放措辞，不放判定**：哪些提供方可清除、能否保存到本机等判定分别在 `ModelDialog`（`authSource === 'stored'`）与 `catalog.canPersistCredentials`，不要在这里加逻辑。
2. 新增一种 `authSource` 时：协议与宿主先加（`ProviderOptionView` 与 `authSourceOf`），这里再补一行——`Record<...>` 会让漏写直接编译失败。
3. 文案保持 4–6 个字、不带句号，因为它被拼进 `provider · 状态 · N 个模型` 这种行内串。
