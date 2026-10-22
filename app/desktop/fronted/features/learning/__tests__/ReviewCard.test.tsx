import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { LearningWord } from '@/common/contracts/learning';
import messages from '@/fronted/i18n/locales/zh-CN/learning.json';
import ReviewCard from '../ReviewCard';

const i18n = createInstance();
const word: LearningWord = {
    id: 'synthetic-word', word: 'context', meaning: '语境', dueAt: '2026-10-22T00:00:00Z', reviews: 0,
    contexts: [],
};

/** 将卡片的实际提交结果显示为文本，断言用户可见的交互结果。 */
function CardHarness({ busy = false }: { busy?: boolean }) {
    const [result, setResult] = useState('');
    return <I18nextProvider i18n={i18n}>
        <ReviewCard word={word} busy={busy} onPlay={async () => undefined}
            onRate={async (rating, durationMs) => { setResult(`${rating}:${durationMs}`); }} />
        <output aria-label="提交结果">{result}</output>
    </I18nextProvider>;
}

beforeAll(async () => {
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { learning: messages } }, defaultNS: 'learning' });
});

let now = 0;
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
    now = 0;
    visibility = 'visible';
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('语境复习卡片', () => {
    it('先回忆再揭示释义，并把实际作答毫秒数交给评分', () => {
        render(<CardHarness />);
        expect(screen.queryByRole('button', { name: '记得' })).not.toBeInTheDocument();
        expect(screen.queryByText('语境')).not.toBeInTheDocument();
        now = 1800;
        fireEvent.click(screen.getByRole('button', { name: '显示释义' }));
        expect(screen.getByText('语境')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '记得' }));
        expect(screen.getByLabelText('提交结果')).toHaveTextContent('remembered:1800');
    });

    it('窗口隐藏期间不累计作答时长', () => {
        render(<CardHarness />);
        act(() => {
            now = 1200;
            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
        });
        act(() => {
            now = 11200;
            visibility = 'visible';
            document.dispatchEvent(new Event('visibilitychange'));
        });
        now = 12000;
        fireEvent.click(screen.getByRole('button', { name: '显示释义' }));
        fireEvent.click(screen.getByRole('button', { name: '模糊' }));
        expect(screen.getByLabelText('提交结果')).toHaveTextContent('unsure:2000');
    });

    it('等待请求时禁用评分且不把网络等待计入时长', () => {
        const { rerender } = render(<CardHarness />);
        fireEvent.click(screen.getByRole('button', { name: '显示释义' }));
        now = 1000;
        rerender(<CardHarness busy />);
        expect(screen.getByRole('button', { name: '忘记' })).toBeDisabled();
        now = 8000;
        rerender(<CardHarness />);
        now = 9000;
        fireEvent.click(screen.getByRole('button', { name: '忘记' }));
        expect(screen.getByLabelText('提交结果')).toHaveTextContent('forgot:2000');
    });

    it('取消卡片不生成评分，下一张从零开始计时', () => {
        const first = render(<CardHarness />);
        now = 5000;
        first.unmount();
        render(<CardHarness />);
        expect(screen.getByLabelText('提交结果')).toHaveTextContent('');
        now = 5500;
        fireEvent.click(screen.getByRole('button', { name: '显示释义' }));
        fireEvent.click(screen.getByRole('button', { name: '记得' }));
        expect(screen.getByLabelText('提交结果')).toHaveTextContent('remembered:500');
    });
});
