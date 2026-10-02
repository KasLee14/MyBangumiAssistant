// 固定桥接入口的离线替身；状态仅落在测试临时用户目录。
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const stateFile = join(dirname(process.env.BGM_CONFIG_DIR), 'fixture-state.json');
let collection = { subject_id: 400602, type: 3, rate: 8, ep_status: 28, vol_status: 0, comment: '原短评', tags: ['测试'], private: false };
try { collection = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const [command, id, account, body] = process.argv.slice(3);
if (command === 'snapshot' && id === '400602') console.log(JSON.stringify({ ok: true, data: { collection, accountId: 7 } }));
else if (command === 'mutate' && id === '400602' && account === '7') {
  const request = JSON.parse(body);
  if (request.kind !== 'collection') throw new Error('unexpected offline mutation');
  const { status, ...fields } = request.patch;
  collection = { ...collection, ...fields, type: status };
  await writeFile(stateFile, JSON.stringify(collection));
  console.log(JSON.stringify({ ok: true, data: { submitted: true } }));
} else throw new Error('测试禁止访问真实服务，未知桥接调用');
