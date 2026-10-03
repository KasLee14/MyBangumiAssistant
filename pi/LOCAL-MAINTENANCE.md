# 本地 Pi 维护说明

`pi/` 是 MyBangumiAssistant 自主维护的普通源码目录，和应用源码使用同一个 Git 仓库。它不再是 Git 子模块，也不自动跟随上游升级。

## 初始来源

- 来源仓库：https://github.com/earendil-works/pi
- 导入提交：`9fba660cf1caca0ade5bea72269352416e595a19`
- 初始模型目录 revision：`sha256-d28b6de6985826060b6e2ccf589d16800d9fdbc40681ae4c698421c92d2ff86f`
- 原有 MIT 许可证及版权声明保留在 `LICENSE` 中。

提交号仅用于记录来源，不是构建约束。可以直接修改本地实现，无需保持源码与原始提交一致。

## 开发与构建

Bangumi 通过 `file:../pi/packages/...` 引用本地 Pi 包。Pi 包之间继续使用现有 npm workspaces 组织，不需要发布到 npm。

在 MyBangumiAssistant 根目录运行 `node bootstrap-pi.mjs`，会校验仓库内的模型目录、安装锁定的 npm 依赖、生成模型数据，再构建本地 Pi 和应用。初始化不需要 Pi 上游仓库或 `pi.dev`，也不需要 Git/curl；npm 安装仍需联网。

`node bootstrap-pi.mjs --catalog-only` 仅从内置目录生成并校验模型数据，不安装依赖、不构建。生成的数据、`dist/` 和 `node_modules/` 不提交到仓库。

Pi 的既有发布、上游目录更新脚本及文档作为原始源码的一部分保留，根目录初始化不会执行这些发布或更新流程。日常开发以本说明及 MyBangumiAssistant 根目录 README 为准。

## 自主修改与模型目录维护

直接编辑 `pi/packages/`，把修改作为 MyBangumiAssistant 的代码变更一起审查和提交。原始来源记录保持不变；后续修改历史由主仓库 Git 记录。是否参考或引入上游改动，由本项目维护者决定。

内置模型目录位于主仓库的 `vendor-data/pi-model-catalog.json`。需要修改目录时，由维护者审查数据内容，同时更新根目录 `bootstrap-pi.mjs` 中的 `CATALOG_REVISION` 和本目录的 `nix/model-catalog.json`，再执行 `--catalog-only` 验证。该 JSON 使用原始字节的 SHA-256，主仓库 `.gitattributes` 禁止对其转换换行。

个人 API Key、认证和模型覆盖配置仍保存在应用数据目录，不能写入内置模型目录或提交到仓库。
