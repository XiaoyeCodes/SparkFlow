import { readFileSync } from 'node:fs';
import ts from 'typescript';
const { outputText } = ts.transpileModule(readFileSync(new URL('../../server/dailyhotService.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { createDailyHotService } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const service = createDailyHotService({ root: process.cwd(), log: () => {} });
const status = await service.start();
process.send?.(status);
process.on('message', async (message) => { if (message === 'stop') { await service.stop(); process.exit(0); } });
process.on('disconnect', async () => { await service.stop(); process.exit(0); });
