import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const control = resolve('artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src');
const source = execFileSync('git', ['show', 'HEAD:bangumi/test/candidate-readers.test.mjs'], { cwd: '..', encoding: 'utf8' });
const diagnostic = source.replaceAll('../dist/src/', pathToFileURL(control + '/').href)
  .replace('assert.equal(calls, 2); assert.equal(again.coverage.failedFieldCount, 0); assert.equal(again.coverage.complete, true);',
    'console.log("CANDIDATE_DEBUG", JSON.stringify({ coverage: again.coverage, stage: again.stage, row: store.get(again.resultRef, publicBinding).rows[0] })); assert.equal(calls, 2); assert.equal(again.coverage.failedFieldCount, 0); assert.equal(again.coverage.complete, true);');
writeFileSync('artifacts/benchmarks/presentation-20261008/verification/candidate-baseline.test.mjs', diagnostic);
