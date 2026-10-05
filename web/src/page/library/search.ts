import { LIBRARY_SECTIONS, type LibrarySection } from './samples';

/**
 * 顶部搜索框的过滤逻辑。
 *
 * 对齐 ant.design 文档站的体验：输入即过滤左侧导航。命中口径覆盖四类——kind 名（`subjects`）、
 * 中文标题（`条目集合 SubjectCards`）、参数表里的字段名与枚举值（`rating`、`grid`），
 * 以及**示例数据本身**（搜「轻音」能定位到 subjects，因为界面上就是那几个字）。
 */
export function filterSections(query: string): LibrarySection[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...LIBRARY_SECTIONS];
  return LIBRARY_SECTIONS.filter(section => matches(section, needle));
}

function matches(section: LibrarySection, needle: string): boolean {
  if (section.kind.toLowerCase().includes(needle)) return true;
  if (section.title.toLowerCase().includes(needle)) return true;
  if (section.summary.toLowerCase().includes(needle)) return true;
  if (section.title.replace(/\s+/g, '').toLowerCase().includes(needle.replace(/\s+/g, ''))) return true;
  if (JSON.stringify(section.payload).toLowerCase().includes(needle)) return true;
  return section.params.some(param =>
    param.field.toLowerCase().includes(needle)
    || (param.values ?? '').toLowerCase().includes(needle)
    || param.type.toLowerCase().includes(needle)
    || param.note.toLowerCase().includes(needle),
  );
}
