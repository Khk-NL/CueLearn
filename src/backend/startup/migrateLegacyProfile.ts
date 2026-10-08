import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

/** 在数据库与配置模块加载之前复制旧版用户状态，保留原数据目录不变。 */
export function migrateLegacyProfile(): void {
    const target = app.getPath('userData');
    const source = path.join(path.dirname(target), 'DashPlayer');
    if (source === target || !fs.existsSync(source)) return;
    for (const name of ['config.json', 'config.dev.json', 'data', 'data-dev', 'Local Storage']) {
        const from = path.join(source, name);
        const to = path.join(target, name);
        if (!fs.existsSync(from) || fs.existsSync(to)) continue;
        fs.mkdirSync(target, { recursive: true });
        const staged = path.join(target, `.${name}.migration-${randomUUID()}`);
        try {
            fs.cpSync(from, staged, { recursive: true });
            fs.renameSync(staged, to);
        } catch (cause) {
            fs.rmSync(staged, { recursive: true, force: true });
            throw cause;
        }
    }
}

migrateLegacyProfile();
