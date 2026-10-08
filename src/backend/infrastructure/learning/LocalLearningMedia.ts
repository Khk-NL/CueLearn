import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { storeGet, storeSet } from '@/backend/infrastructure/settings/store';

/** 本机文件关联，不会提交给 PocketBase。 */
export interface MediaBinding { mediaPath: string; subtitlePath?: string; videoId?: string }

/** 为跨设备记录提供不含绝对路径的媒体指纹与本机映射。 */
export default class LocalLearningMedia {
    /** 取文件大小与首尾采样计算指纹，避免读取整部视频。 */
    public async fingerprint(filePath: string): Promise<string> {
        const handle = await fs.open(filePath, 'r');
        try {
            const stat = await handle.stat();
            if (!stat.isFile()) throw new Error('学习资料不是文件');
            const size = Math.min(stat.size, 65536);
            const first = Buffer.alloc(size);
            const last = Buffer.alloc(size);
            await handle.read(first, 0, size, 0);
            await handle.read(last, 0, size, Math.max(0, stat.size - size));
            return createHash('sha256').update(String(stat.size)).update(first).update(last).digest('hex');
        } finally {
            await handle.close();
        }
    }

    /** 在本机保存指纹到文件路径的关联。 */
    public remember(key: string, binding: MediaBinding): void {
        const map = this.readMap();
        map[key] = {
            ...map[key], mediaPath: binding.mediaPath,
            ...(binding.subtitlePath !== undefined ? { subtitlePath: binding.subtitlePath } : {}),
            ...(binding.videoId !== undefined ? { videoId: binding.videoId } : {}),
        };
        storeSet('learning.mediaPaths', JSON.stringify(map));
    }

    /** 查找仍存在的本地文件；路径失效时要求用户重新关联。 */
    public async resolve(key: string, requireSubtitle = false): Promise<MediaBinding | null> {
        const binding = this.readMap()[key];
        if (!binding) return null;
        try {
            await fs.access(binding.mediaPath);
            if (requireSubtitle) {
                if (!binding.subtitlePath) return null;
                await fs.access(binding.subtitlePath);
            }
            return binding;
        } catch {
            return null;
        }
    }

    /** 从设置读取本机映射，损坏的设置数据应直接暴露。 */
    private readMap(): Record<string, MediaBinding> {
        const value = JSON.parse(storeGet('learning.mediaPaths')) as Record<string, MediaBinding>;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本机媒体映射格式错误');
        return value;
    }

}
