import { storeGet, storeSet } from '@/backend/infrastructure/settings/store';
import type { LearningAccount } from '@/common/contracts/learning';

/** PocketBase 集合记录的公共字段。 */
export interface PbRecord { id: string; created: string; updated: string; [key: string]: unknown }

/** PocketBase 列表响应。 */
interface PbList<T> { items: T[]; page: number; totalPages: number }

/** 主进程持有的 PocketBase 访问入口，令牌不暴露给 renderer，也不持久化。 */
export default class PocketBaseClient {
    private token: string | null = null;
    private account: LearningAccount | null = null;

    /** 当前服务地址。 */
    public getUrl(): string { return storeGet('learning.pocketBaseUrl'); }

    /** 修改服务地址时清除旧服务上的登录态。 */
    public setUrl(value: string): void {
        const url = new URL(value.trim());
        const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
            throw new Error('PocketBase 地址须为 HTTPS，或本机 HTTP 地址');
        }
        storeSet('learning.pocketBaseUrl', url.origin);
        this.logout();
    }

    /** 获取当前账号；应用重启后需要重新登录。 */
    public getAccount(): LearningAccount | null { return this.account; }

    /** 退出账号并清除内存令牌。 */
    public logout(): void { this.token = null; this.account = null; }

    /** 创建普通学习账号。 */
    public async register(email: string, password: string): Promise<void> {
        await this.request('/api/collections/users/records', 'POST', {
            email: email.trim(), password, passwordConfirm: password,
        }, false);
    }

    /** 使用密码登录并将令牌只保存在主进程内存中。 */
    public async login(email: string, password: string): Promise<LearningAccount> {
        this.logout();
        const response = await this.request<{ token: string; record: { id: string; email: string } }>(
            '/api/collections/users/auth-with-password', 'POST', { identity: email.trim(), password }, false,
        );
        this.token = response.token;
        this.account = { id: response.record.id, email: response.record.email };
        return this.account;
    }

    /** 查询当前账号的全部集合记录；服务端规则再次限制归属。 */
    public async list<T extends PbRecord>(collection: string): Promise<T[]> {
        const owner = this.requireAccount().id;
        const result: T[] = [];
        let page = 1;
        for (;;) {
            const query = new URLSearchParams({ page: String(page), perPage: '500', filter: `owner = "${owner}"` });
            const data = await this.request<PbList<T>>(`/api/collections/${collection}/records?${query}`, 'GET');
            result.push(...data.items);
            if (page >= data.totalPages) return result;
            page += 1;
        }
    }

    /** 创建归属当前账号的记录。 */
    public create<T extends PbRecord>(collection: string, data: Record<string, unknown>): Promise<T> {
        return this.request<T>(`/api/collections/${collection}/records`, 'POST', { ...data, owner: this.requireAccount().id });
    }

    /** 更新已授权的记录，集合规则阻止修改 owner。 */
    public update<T extends PbRecord>(collection: string, id: string, data: Record<string, unknown>): Promise<T> {
        return this.request<T>(`/api/collections/${collection}/records/${encodeURIComponent(id)}`, 'PATCH', data);
    }

    /** 删除当前账号可访问的记录。 */
    public delete(collection: string, id: string): Promise<void> {
        return this.request(`/api/collections/${collection}/records/${encodeURIComponent(id)}`, 'DELETE');
    }

    /** 对单个 REST 路径发起请求并显示明确的服务端错误。 */
    private async request<T>(path: string, method: string, body?: unknown, authenticated = true): Promise<T> {
        if (authenticated && !this.token) throw new Error('请先登录学习账号');
        let response: Response;
        try {
            response = await fetch(new URL(path, `${this.getUrl()}/`), {
                method,
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(authenticated ? { Authorization: this.token as string } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(10000),
            });
        } catch (error) {
            throw new Error('无法连接 PocketBase，请检查服务地址与网络连接', { cause: error });
        }
        if (response.status === 401) this.logout();
        if (!response.ok) {
            const error = await response.json().catch(() => null) as { message?: string } | null;
            throw new Error(`PocketBase 请求失败（${response.status}）：${error?.message ?? response.statusText}`);
        }
        if (response.status === 204) return undefined as T;
        return response.json() as Promise<T>;
    }

    /** 获取已登录账号，不允许匿名写入学习数据。 */
    private requireAccount(): LearningAccount {
        if (!this.account) throw new Error('请先登录学习账号');
        return this.account;
    }
}
