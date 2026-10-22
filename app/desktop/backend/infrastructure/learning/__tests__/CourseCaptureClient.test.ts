import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CourseCaptureClient, { type CourseCapturePayload } from '../CourseCaptureClient';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';

/** 使用设置边界的内存实现与真实HTTP服务核对匿名采集协议。 */
describe('本机课程采集', () => {
    let server: Server;
    let url: string;
    let client: CourseCaptureClient;
    let settings: SettingsStore;
    let received: CourseCapturePayload[];
    let status: number;
    let invalidReceipt: boolean;

    beforeEach(async () => {
        const values = new Map<string, string>([['learning.courseApiUrl', ''], ['learning.courseAnonymousIds', '{}']]);
        settings = {
            get: (key) => values.get(key) ?? '',
            set: (key, value) => { values.set(key, value ?? ''); return true; },
        };
        client = new CourseCaptureClient(settings);
        received = []; status = 201; invalidReceipt = false;
        server = createServer(async (req, res) => {
            let body = '';
            for await (const chunk of req) body += chunk;
            const payload = JSON.parse(body) as CourseCapturePayload;
            received.push(payload);
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ event_id: invalidReceipt ? 'wrong' : payload.event_id,
                vocabulary_item_id: 1, learning_event_id: 2,
                review_event_id: payload.event_type === 'review_submitted' ? 3 : null }));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('测试服务未监听TCP端口');
        url = `http://127.0.0.1:${address.port}`;
    });
    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });

    it('默认关闭，开启后匿名身份跨实例稳定且账号和服务之间隔离', () => {
        expect(client.prepare('http://localhost:8090', 'account-a')).toBeNull();
        client.setUrl(url);
        const scope = client.prepare('http://localhost:8090', 'account-a')!;
        expect(scope.userKey).toMatch(/^anon_[a-f0-9]{32}$/);
        expect(new CourseCaptureClient(settings).prepare('http://localhost:8090', 'account-a')).toEqual(scope);
        expect(client.prepare('http://localhost:8090', 'account-b')!.userKey).not.toBe(scope.userKey);
        expect(client.prepare('http://localhost:8091', 'account-a')!.userKey).not.toBe(scope.userKey);
        expect(settings.get('learning.courseAnonymousIds')).not.toContain('account-a');
        expect(client.eventId(scope, 'review-a')).toBe(client.eventId(scope, 'review-a'));
        expect(client.eventId(scope, 'review-b')).not.toBe(client.eventId(scope, 'review-a'));
        client.setUrl('');
        expect(client.prepare('http://localhost:8090', 'account-a')).toBeNull();
    });

    it('拒绝无鉴权远程地址及损坏的身份配置', () => {
        for (const value of ['https://127.0.0.1', 'http://example.com', `${url}/api`, `${url}?token=x`, 'http://a:b@localhost']) {
            expect(() => client.setUrl(value)).toThrow();
        }
        client.setUrl(url);
        settings.set('learning.courseAnonymousIds', '{');
        expect(() => client.prepare('http://localhost:8090', 'account-a')).toThrow();
    });

    it('真实HTTP请求使用冻结的匿名归属及原句，正确映射模糊评分', async () => {
        client.setUrl(url);
        const scope = client.prepare('http://localhost:8090', 'private-account')!;
        client.setUrl('');
        const payload: CourseCapturePayload = {
            user_key: scope.userKey, event_id: client.eventId(scope, 'review-record'), event_type: 'review_submitted',
            occurred_at: '2026-10-22T01:00:00Z', word: 'context', definition: '语境',
            contexts: [{ sentence: 'Remember words in context.', media_fingerprint: 'abc', subtitle_index: 2, start_seconds: 4 }],
            rating: client.rating('unsure'), duration_ms: 1234,
        };
        expect(await client.send(scope, payload)).toEqual({ status: 'captured' });
        expect(received).toEqual([payload]);
        expect(received[0].rating).toBe('vague');
        expect(JSON.stringify(received)).not.toContain('private-account');
        expect(JSON.stringify(received)).not.toContain(scope.salt);
    });

    it('服务拒绝或回执不匹配时明确返回采集失败', async () => {
        client.setUrl(url);
        const scope = client.prepare('http://localhost:8090', 'account-a')!;
        const payload: CourseCapturePayload = { user_key: scope.userKey, event_id: client.eventId(scope, 'save'),
            event_type: 'word_saved', occurred_at: '2026-10-22T01:00:00Z', word: 'context', definition: '', contexts: [] };
        status = 409;
        expect(await client.send(scope, payload)).toEqual({ status: 'failed', reason: 'http_409' });
        status = 201; invalidReceipt = true;
        expect(await client.send(scope, payload)).toEqual({ status: 'failed', reason: 'invalid_receipt' });
    });
});
