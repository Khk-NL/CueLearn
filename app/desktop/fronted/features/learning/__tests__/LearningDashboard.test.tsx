import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import messages from '@/fronted/i18n/locales/zh-CN/learning.json';
import LearningDashboard from '../LearningDashboard';

const i18n = createInstance();
let courseUrl = 'http://127.0.0.1:8011';
let reviewCount = 0;
let receivedDuration: unknown;

/** 通过真实页面展示IPC边界返回的业务状态，不mock学习API或卡片。 */
function renderDashboard() {
    return render(<I18nextProvider i18n={i18n}><MemoryRouter>
        <LearningDashboard /><Toaster />
    </MemoryRouter></I18nextProvider>);
}

beforeAll(async () => {
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { learning: messages } }, defaultNS: 'learning' });
});

beforeEach(() => {
    courseUrl = 'http://127.0.0.1:8011';
    reviewCount = 0;
    receivedDuration = undefined;
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    vi.spyOn(window.electron, 'call').mockImplementation(async (path, params) => {
        switch (path) {
            case 'learning/session':
                return { url: 'http://127.0.0.1:8090', account: { id: 'synthetic-account', email: 'demo@example.invalid' }, courseUrl } as never;
            case 'learning/overview':
                return {
                    words: [{ id: 'word-demo', word: 'context', meaning: '语境', contexts: [], reviews: reviewCount,
                        dueAt: reviewCount ? '2999-01-01T00:00:00Z' : '2000-01-01T00:00:00Z' }],
                    stats: { due: reviewCount ? 0 : 1, completedToday: reviewCount, recentRememberedRate: reviewCount ? 1 : 0 },
                } as never;
            case 'learning/notebooks':
            case 'watch-history/list':
                return [] as never;
            case 'learning/review':
                receivedDuration = (params as { durationMs: number }).durationMs;
                reviewCount += 1;
                return { status: 'failed', reason: 'synthetic-unavailable' } as never;
            case 'learning/course/server/set':
                courseUrl = (params as { url: string }).url;
                return undefined as never;
            default:
                throw new Error(`测试未声明的IPC调用：${path}`);
        }
    });
});

afterEach(() => {
    cleanup();
    toast.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('课程采集在学习页的反馈', () => {
    it('评分保存但采集失败时仍更新学习进度，并提示不要重复评分', async () => {
        renderDashboard();
        await screen.findByRole('heading', { name: 'context' });
        fireEvent.click(screen.getByRole('button', { name: '显示释义' }));
        fireEvent.click(screen.getByRole('button', { name: '记得' }));
        expect(await screen.findByText(messages.courseReviewCaptureFailed)).toBeInTheDocument();
        expect(await screen.findByText(messages.noDue)).toBeInTheDocument();
        expect(screen.getByText('待复习 0 · 今日完成 1 · 近七日记得比例 100%')).toBeInTheDocument();
        expect(reviewCount).toBe(1);
        expect(typeof receivedDuration).toBe('number');
        expect(receivedDuration).toBeGreaterThanOrEqual(0);
    });

    it('留空保存后关闭课程采集并移除报表入口', async () => {
        renderDashboard();
        await screen.findByRole('button', { name: '查看课程报表' });
        fireEvent.change(screen.getByLabelText('课程采集服务地址（可选）'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: '保存采集地址' }));
        expect(await screen.findByText(messages.courseCollectionDisabled)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '查看课程报表' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'context' })).toBeInTheDocument();
    });
});
