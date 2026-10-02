/** 仅识别完整模型回答中明确要求本轮作品选择的句子，不扫描工具结果。 */
export function subjectSelectionQuestion(content: string): string | null {
  let fenced = false;
  for (const line of content.split('\n')) {
    const text = line.trim().replace(/\*\*/g, '');
    if (/^```|^~~~/.test(text)) { fenced = !fenced; continue; }
    if (fenced || /^(?:>|[“"『])/.test(text) || /如果|如需|假如|若|示例|例文|引述/.test(text)
      || /(?:不用|无需|不必|不要|不需要|不会|不再)(?:让你|要求你)?(?:回复|选择|确认|告诉我|先确认)/.test(text)) continue;
    if (/(?:请|麻烦)(?:你|您)?(?:告诉我|回复|回答|选择|选一下|确认|输入).{0,70}(?:序号|编号|哪一[部本项个]|哪[个部本项]|哪部作品|作品|条目|候选)/.test(text)
      || /(?:需要先确认|你(?:指的是|指|想查询|想查|要查询|要查)).{0,40}(?:哪一[部本项个]|哪[个部本项]|哪部作品)/.test(text)) return text.slice(0,300);
  }
  return null;
}
