#!/usr/bin/env node
/**
 * 卡片实验室的数据生成器
 *
 * 解析每个内容块组件自己声明的 props interface（`web/src/components/content/*.tsx`），
 * 产出 `web/src/components/content/content-cards.generated.json`——实验室左侧的 kind 列表
 * 与右侧的字段表单全部由它驱动。
 *
 * 为什么用 TypeScript 的解析器而不是正则：正则可以抠「字段名: 类型」，但抠不出可选性、
 * 字符串字面量联合的成员，也读不到 JSDoc 里的例值。
 *
 * **只用语法树，不建 Program**：本脚本看的是「声明怎么写」，不需要类型推导——建
 * `createProgram` 会把整条 import 链（含 React 类型）拉进来，内存占用高到在低配机器上
 * 会 OOM。`ts.createSourceFile` 一个文件一次，够用且快。
 *
 * 用法（仓库根）：
 *
 *   node web/tools/gen-content-cards.mjs           写盘
 *   node web/tools/gen-content-cards.mjs --check   重算并比对，与源码不一致就退出码 1
 *
 * 幂等：无时间戳、键序固定、内容不变不写盘（避免 dev 期改文件触发 HMR 重载实验室）。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(HERE, '..', '..');
const CONTENT_DIR = join(ROOT, 'web', 'src', 'components', 'content');
/** 协议里的字符串字面量别名（`SubjectKind` 这类）在被跨文件引用时要能解析成下拉选项。 */
const PROTOCOL_FILE = join(ROOT, 'bangumi', 'src', 'web', 'protocol.ts');
/** 名字 → 字符串字面量联合的成员；由 `readAliases()` 填。 */
let ALIASES = new Map();

function readAliases() {
  const aliases = new Map();
  const source = ts.createSourceFile(PROTOCOL_FILE, readFileSync(PROTOCOL_FILE, 'utf8'), ts.ScriptTarget.ES2023, true);
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || !ts.isUnionTypeNode(statement.type)) continue;
    const members = statement.type.types;
    if (!members.every(item => ts.isLiteralTypeNode(item) && ts.isStringLiteral(item.literal))) continue;
    aliases.set(statement.name.text, members.map(item => item.literal.text));
  }
  return aliases;
}
const SECTIONS_FILE = join(ROOT, 'web', 'src', 'page', 'library', 'constants', 'sections.ts');
const OUT_FILE = join(CONTENT_DIR, 'content-cards.generated.json');
const TS_PATH = join(ROOT, 'bangumi', 'node_modules', 'typescript', 'lib', 'typescript.js');

/** 不是「一种内容块」的模块：分发器、注册表、原语、兜底块。 */
const SKIP = new Set([
  'index.tsx', 'registry.tsx', 'payload.ts', 'ContentRaw.tsx',
  'ContentErrorBoundary.tsx', 'ContentSkeleton.tsx', 'MessageBlocks.tsx', 'markdown.tsx',
]);

const ts = (await import(pathToFileURL(TS_PATH).href)).default;

function fail(message) {
  const error = new Error(message);
  error.isGeneratorError = true;
  throw error;
}

/* ---------------------------------------------------------------- 解析工具 */

/** 取 JSDoc 正文（`/** ... *\/` 里的内容，去掉标签行）。 */
function docOf(node) {
  const comment = ts.getJSDocCommentsAndTags(node).find(item => item.kind === ts.SyntaxKind.JSDoc);
  if (comment === undefined) return '';
  return (ts.getTextOfJSDocComment(comment.comment) ?? '').trim();
}

/** 从注释里拆出「说明」与「例值」：约定写法是 `说明（例：值）`。 */
function splitExample(text) {
  const match = /^([\s\S]*?)（\s*例\s*[：:]\s*([\s\S]*?)）\s*$/.exec(text);
  if (match !== null) return { hint: match[1].trim(), example: match[2].trim() };
  return { hint: text.trim(), example: '' };
}

/** 去掉联合里的 `undefined`（可选性已由 `?` 表达，这里只是兜底）。 */
function unwrapUnion(typeNode) {
  if (!ts.isUnionTypeNode(typeNode)) return typeNode;
  const members = typeNode.types.filter(item => item.kind !== ts.SyntaxKind.UndefinedKeyword);
  return members.length === 1 ? members[0] : typeNode;
}

/** 字段类型 → 实验室控件。返回 null 表示这个字段不进表单（回调之类）。 */
function controlOf(typeNode, kind, interfaces) {
  const node = unwrapUnion(typeNode);

  if (ts.isArrayTypeNode(node)) {
    // 数组：元素是对象且能解析出字段 → 结构化列表编辑器；否则退回 JSON 文本框。
    const itemShape = shapeOf(unwrapUnion(node.elementType), interfaces);
    if (itemShape === undefined) return { kind: 'json', value: '[]' };
    return { kind: 'list', itemFields: fieldsOf(itemShape, kind, interfaces), value: '[]' };
  }
  if (ts.isTypeLiteralNode(node)) return { kind: 'json', value: '{}' };
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    // 跨文件的字符串字面量别名（`SubjectKind`）→ 下拉，而不是「一段 JSON」。
    const alias = ALIASES.get(name);
    if (alias !== undefined) return { kind: 'select', options: alias, value: alias[0] };
    if (name === 'Record' || name === 'Array' || name === 'ReadonlyArray') return { kind: 'json', value: name === 'Record' ? '{}' : '[]' };
    return { kind: 'json', value: '{}' };
  }
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) return controlOf(node.type, kind, interfaces);

  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword: return { kind: 'text', value: '' };
    case ts.SyntaxKind.NumberKeyword: return { kind: 'number', value: '0' };
    case ts.SyntaxKind.BooleanKeyword: return { kind: 'select', options: ['true', 'false'], value: 'true' };
    default: break;
  }

  if (ts.isUnionTypeNode(node) && node.types.every(item => ts.isLiteralTypeNode(item) && ts.isStringLiteral(item.literal))) {
    const options = node.types.map(item => item.literal.text);
    return { kind: 'select', options, value: options[0] };
  }

  return null;
}

/** 数组元素的对象形状：内联字面量，或同文件里能找到的具名 interface（`SubjectCardProps[]`）。 */
function shapeOf(elementNode, interfaces) {
  if (ts.isTypeLiteralNode(elementNode)) return elementNode;
  if (ts.isTypeReferenceNode(elementNode)) {
    const found = interfaces.get(elementNode.typeName.getText());
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 一个 interface 的字段元数据。 */
function fieldsOf(interfaceNode, kind, interfaces) {
  const fields = [];
  for (const member of interfaceNode.members) {
    if (!ts.isPropertySignature(member) || member.name === undefined) continue;
    const key = member.name.getText();
    const typeNode = member.type;
    if (typeNode === undefined) continue;
    const control = controlOf(typeNode, kind, interfaces);
    if (control === null) fail(`${kind}.${key} 的类型无法进表单：${typeNode.getText()}`);
    const { hint, example } = splitExample(docOf(member));
    // 例值优先用注释里的；没有就按控件给一个可编辑的空值。
    const value = example !== '' ? example : control.value ?? '';
    const entry = { key, kind: control.kind };
    if (control.options !== undefined) entry.options = control.options;
    if (control.itemFields !== undefined) entry.itemFields = control.itemFields;
    entry.required = member.questionToken === undefined;
    entry.optional = member.questionToken !== undefined;
    entry.value = value;
    entry.hint = hint;
    fields.push(entry);
  }
  return fields;
}

/* ---------------------------------------------------------------- 中文名与顺序 */

/** 文档页的 `LIBRARY_SECTIONS` 提供了 kind 的中文标题与顺序：name = title 去掉尾部的 kind。 */
function readSectionTitles() {
  const source = ts.createSourceFile(SECTIONS_FILE, readFileSync(SECTIONS_FILE, 'utf8'), ts.ScriptTarget.ES2023, true);
  const titles = new Map();
  const order = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'LIBRARY_SECTIONS' && node.initializer !== undefined) {
      const array = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (!ts.isArrayLiteralExpression(array)) return;
      for (const element of array.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        let kind;
        let title;
        for (const property of element.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = property.name.getText();
          if (key === 'kind' && ts.isStringLiteral(property.initializer)) kind = property.initializer.text;
          if (key === 'title' && ts.isStringLiteral(property.initializer)) title = property.initializer.text;
        }
        if (kind === undefined || title === undefined) continue;
        order.push(kind);
        titles.set(kind, title.replace(kind, '').trim() === '' ? kind : title.replace(kind, '').trim());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (order.length === 0) fail('读不出 LIBRARY_SECTIONS 的 kind 列表');
  return { titles, order };
}

/* ---------------------------------------------------------------- 主流程 */

function collect() {
  ALIASES = readAliases();

  const files = readdirSync(CONTENT_DIR)
    .filter(name => name.endsWith('.tsx') && !SKIP.has(name))
    .sort();
  if (files.length === 0) fail(`${CONTENT_DIR} 下没有组件文件`);

  const { titles, order } = readSectionTitles();
  const cards = [];
  const seen = new Set();

  for (const name of files) {
    const kind = name.replace(/\.tsx$/, '');
    // 一个文件一次解析；`createProgram` 会把整条 import 链拉进来，没必要。
    const source = ts.createSourceFile(join(CONTENT_DIR, name), readFileSync(join(CONTENT_DIR, name), 'utf8'), ts.ScriptTarget.ES2023, true);
    if (source === undefined) fail(`program 里没有 ${name}`);

    // 约定：props 就叫 `<Kind>Props`；载荷是数组根时另有一个 `<Kind>ItemProps`。
    let propsInterface;
    let itemInterface;
    let root = 'object';
    // 同文件里所有 interface：数组字段的元素类型常是具名 interface（`SubjectCardProps[]`）。
    const interfaces = new Map();
    for (const statement of source.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        interfaces.set(statement.name.text, statement);
        if (statement.name.text === `${kind}Props`) propsInterface = statement;
        if (statement.name.text === `${kind}ItemProps`) itemInterface = statement;
      }
      if (ts.isTypeAliasDeclaration(statement) && statement.name.text === `${kind}Props`) {
        if (ts.isArrayTypeNode(statement.type)) root = 'array';
      }
    }

    const shape = root === 'array' ? itemInterface : propsInterface;
    if (shape === undefined) fail(`${name} 里找不到 ${root === 'array' ? `${kind}ItemProps` : `${kind}Props`} interface`);
    if (!seen.has(kind)) {
      seen.add(kind);
      cards.push({
        kind,
        name: titles.get(kind) ?? kind,
        componentFile: name,
        root,
        fields: fieldsOf(shape, kind, interfaces),
      });
    }
  }

  // 顺序跟文档页一致（同一张表驱动导航与实验室列表）；缺一条时报错，避免「加了组件但实验室没有」。
  const ordered = [];
  for (const kind of order) {
    const card = cards.find(item => item.kind === kind);
    if (card === undefined) fail(`组件目录里没有 ${kind}.tsx（sections.ts 有它）`);
    ordered.push(card);
  }
  for (const card of cards) {
    if (!order.includes(card.kind)) fail(`${card.kind}.tsx 没有对应的 LIBRARY_SECTIONS 条目`);
  }
  return ordered;
}

function render(cards) {
  return `${JSON.stringify({ version: 1, cards }, null, 2)}\n`;
}

function main() {
  const checking = process.argv.includes('--check');
  const next = render(collect());
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : null;

  if (checking) {
    if (current !== next) {
      fail('content-cards.generated.json 与组件源码不一致；运行 node web/tools/gen-content-cards.mjs 重新生成');
    }
    console.log('content-cards.generated.json 与源码一致');
    return;
  }

  if (current === next) {
    console.log('content-cards.generated.json 已是最新，未改动');
  } else {
    writeFileSync(OUT_FILE, next, 'utf8');
    console.log(`写入 ${OUT_FILE}`);
  }

  for (const card of JSON.parse(next).cards) {
    const summary = card.fields.map(field => `${field.key}:${field.kind}${field.options ? `(${field.options.join('|')})` : ''}`).join(', ');
    console.log(`[${card.kind}] ${card.name} · ${card.root} → ${card.fields.length} 个字段`);
    console.log(`  ${summary}`);
  }
}

try {
  main();
} catch (error) {
  if (error && error.isGeneratorError) console.error(`生成失败：${error.message}`);
  else console.error(`生成失败（未预期错误）：${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
}
