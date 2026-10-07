import fs from 'node:fs';
import ts from 'typescript';
const all=['resource-store.ts','resource-contract.ts','resource-policy.ts','model-projection.ts'];
const methods=new Set(['call','readCachedResource','readCachedFields','verifyCachedBinding','observeViewer','cacheScope','clearCandidateDetails','cacheCandidateDetails']);
for(const file of [...all,'service.ts','catalog.ts','pi-tools.ts','client.ts','server.ts','transport.ts']) {
 const path=`src/mcp/${file}`;let source=fs.readFileSync(path,'utf8');let parsed=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 const selected=[];const isNew=all.includes(file);
 function choose(node){
  if(isNew && ts.isSourceFile(node))selected.push(node);
  else if(file==='service.ts'&&(ts.isMethodDeclaration(node)&&methods.has(node.name.getText(parsed))||ts.isConstructorDeclaration(node)))selected.push(node);
  else if(file==='client.ts'&&ts.isMethodDeclaration(node)&&node.name.getText(parsed)==='readCachedResource')selected.push(node);
  else if(file==='transport.ts'&&ts.isMethodDeclaration(node)&&['validateCachedContext','cachedContextKey'].includes(node.name.getText(parsed)))selected.push(node);
  else if(file==='catalog.ts'&&ts.isForOfStatement(node)&&node.getStart(parsed)>source.indexOf('// 模型字段投影'))selected.push(node);
  else if(file==='pi-tools.ts'&&ts.isFunctionDeclaration(node)&&['jsonResult','prepareModelToolArguments'].includes(node.name?.getText(parsed)))selected.push(node);
  else if(file==='server.ts'&&ts.isExpressionStatement(node)&&node.getText(parsed).includes("z.literal('bangumi/readCachedResource')"))selected.push(node);
  ts.forEachChild(node,choose);
 }
 choose(parsed);
 const inserts=new Set();
 function expand(node){
  if(ts.isBlock(node)){
    inserts.add(node.getStart(parsed)+1);inserts.add(node.end-1);
    for(const statement of node.statements){inserts.add(statement.getStart(parsed));inserts.add(statement.end);}
  }
  if(ts.isArrayLiteralExpression(node)&&node.elements.length>12){inserts.add(node.getStart(parsed)+1);inserts.add(node.end-1);for(const element of node.elements)inserts.add(element.getStart(parsed));}
  ts.forEachChild(node,expand);
 }
 for(const node of selected)expand(node);
 for(const pos of [...inserts].sort((a,b)=>b-a))if(source[pos-1]!=='\n'&&source[pos]!=='\n')source=source.slice(0,pos)+'\n'+source.slice(pos);
 const host={getScriptFileNames:()=>[path],getScriptVersion:()=> '1',getScriptSnapshot:name=>name===path?ts.ScriptSnapshot.fromString(source):undefined,
 getCurrentDirectory:()=>process.cwd(),getCompilationSettings:()=>({}),getDefaultLibFileName:()=>'',fileExists:fs.existsSync,readFile:name=>fs.readFileSync(name,'utf8')};
 const service=ts.createLanguageService(host);const edits=service.getFormattingEditsForDocument(path,{indentSize:2,tabSize:2,convertTabsToSpaces:true,newLineCharacter:'\n',insertSpaceAfterCommaDelimiter:true,insertSpaceAfterSemicolonInForStatements:true,insertSpaceBeforeAndAfterBinaryOperators:true,insertSpaceAfterKeywordsInControlFlowStatements:true,insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces:true});
 for(const edit of edits.sort((a,b)=>b.span.start-a.span.start))source=source.slice(0,edit.span.start)+edit.newText+source.slice(edit.span.start+edit.span.length);
 source=source.replace(/\n[ \t]*\n[ \t]*\n/g,'\n\n');fs.writeFileSync(path,source);
}
