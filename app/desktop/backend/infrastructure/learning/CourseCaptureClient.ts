import { createHash, randomUUID } from 'node:crypto';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type { CourseCaptureResult, ReviewRating } from '@/common/contracts/learning';

/** 仅本机持久化的匿名标识及事件散列盐，不发送原始账号标识。 */
interface AnonymousIdentity { userKey: string; salt: string }

/** 一次业务开始时冻结的采集目标，避免账号或地址切换污染归属。 */
export interface CourseCaptureScope extends AnonymousIdentity { url: string }

/** 从已保存词条生成的分析快照，不包含本机路径和视频标题。 */
export interface CourseWordSnapshot {
    word: string;
    definition: string;
    contexts: Array<{ sentence: string; media_fingerprint: string; subtitle_index: number; start_seconds: number }>;
}

/** 课程桥接受的原子事件请求；与PocketBase事实保存分开处理。 */
export interface CourseCapturePayload extends CourseWordSnapshot {
    user_key: string;
    event_id: string;
    event_type: 'word_saved' | 'review_submitted';
    occurred_at: string;
    rating?: 'forgot' | 'vague' | 'remembered';
    duration_ms?: number;
}

/** 主进程访问本机课程服务，使用匿名快照写入分析副本。 */
@injectable()
export default class CourseCaptureClient {
    /** 复用既有设置存储；网络请求不进入渲染进程。 */
    constructor(@inject(TYPES.SettingsStore) private readonly settings: SettingsStore) {}

    /** 读取用户明确配置的采集地址；空值表示关闭。 */
    public getUrl(): string { return this.settings.get('learning.courseApiUrl'); }

    /** 保存本机服务地址，空值关闭采集，不修改PocketBase连接。 */
    public setUrl(value: string): void {
        const trimmed = value.trim();
        this.settings.set('learning.courseApiUrl', trimmed ? this.localUrl(trimmed) : '');
    }

    /** 只允许当前无鉴权课程服务监听的本机HTTP来源。 */
    private localUrl(value: string): string {
        const url = new URL(value);
        if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
            url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
            throw new Error('课程采集服务须为本机 HTTP 地址');
        }
        return url.origin;
    }

    /** 为服务与账号组合建立随机匿名身份，仅返回本次操作的不可变配置。 */
    public prepare(pocketBaseUrl: string, ownerId: string): CourseCaptureScope | null {
        const configured = this.getUrl();
        if (!configured) return null;
        const url = this.localUrl(configured);
        const identities: unknown = JSON.parse(this.settings.get('learning.courseAnonymousIds'));
        if (!identities || typeof identities !== 'object' || Array.isArray(identities)) throw new Error('课程匿名标识配置无效');
        const map = identities as Record<string, AnonymousIdentity>;
        for (const identity of Object.values(map)) {
            if (!identity || typeof identity.userKey !== 'string' || !/^anon_[a-f0-9]{32}$/.test(identity.userKey) ||
                typeof identity.salt !== 'string' || !/^[a-f0-9-]{36}$/.test(identity.salt)) throw new Error('课程匿名标识配置无效');
        }
        const key = createHash('sha256').update(`${pocketBaseUrl}\0${ownerId}`).digest('hex');
        if (!map[key]) {
            map[key] = { userKey: `anon_${randomUUID().replaceAll('-', '')}`, salt: randomUUID() };
            this.settings.set('learning.courseAnonymousIds', JSON.stringify(map));
        }
        return { url, ...map[key] };
    }

    /** 生成不泄露PocketBase主键的事件标识，复习使用已提交事件的稳定ID。 */
    public eventId(scope: CourseCaptureScope, sourceId: string): string {
        return createHash('sha256').update(`${scope.salt}\0${sourceId}`).digest('hex');
    }

    /** 映射课程与桌面评分用语，不改变桌面FSRS排程。 */
    public rating(value: ReviewRating): 'forgot' | 'vague' | 'remembered' {
        return value === 'unsure' ? 'vague' : value;
    }

    /** 向冻结的本机目标发送一次原子快照；失败独立返回，不重发主业务。 */
    public async send(scope: CourseCaptureScope, payload: CourseCapturePayload): Promise<CourseCaptureResult> {
        try {
            const response = await fetch(`${scope.url}/desktop/captures`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
                body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
            });
            if (![200, 201].includes(response.status)) return { status: 'failed', reason: `http_${response.status}` };
            const receipt = await response.json() as Record<string, unknown>;
            if (receipt.event_id !== payload.event_id || !Number.isSafeInteger(receipt.vocabulary_item_id) ||
                !Number.isSafeInteger(receipt.learning_event_id) ||
                (payload.event_type === 'review_submitted' && !Number.isSafeInteger(receipt.review_event_id))) {
                return { status: 'failed', reason: 'invalid_receipt' };
            }
            return { status: 'captured' };
        } catch { return { status: 'failed', reason: 'network_or_response' }; }
    }
}
