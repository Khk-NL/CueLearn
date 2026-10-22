import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LearningContext, LearningWord, ReviewRating } from '@/common/contracts/learning';

/** 一张到期卡片的交互入参。 */
interface ReviewCardProps {
    word: LearningWord;
    busy: boolean;
    onPlay: (context: LearningContext) => Promise<void>;
    onRate: (rating: ReviewRating, durationMs: number) => Promise<void>;
}

/** 先用原句和原声帮助回忆，揭示释义后才允许记录复习评分。 */
export default function ReviewCard({ word, busy, onPlay, onRate }: ReviewCardProps) {
    const [revealed, setRevealed] = useState(false);
    const clock = useRef({ elapsedMs: 0, runningSince: null as number | null });
    const { t } = useTranslation('learning');

    /** 仅累计卡片可见且未等待提交的时间；隐藏、请求等待和卸载时暂停。 */
    useEffect(() => {
        const timer = clock.current;
        /** 先结算上一段，再根据当前可见性决定是否开始新一段计时。 */
        const updateClock = () => {
            const now = performance.now();
            if (timer.runningSince !== null) {
                timer.elapsedMs += now - timer.runningSince;
            }
            timer.runningSince = !busy && document.visibilityState !== 'hidden' ? now : null;
        };
        updateClock();
        document.addEventListener('visibilitychange', updateClock);
        return () => {
            document.removeEventListener('visibilitychange', updateClock);
            if (timer.runningSince !== null) {
                timer.elapsedMs += performance.now() - timer.runningSince;
                timer.runningSince = null;
            }
        };
    }, [busy]);

    /** 在点击评分时读取可见学习时长，单位毫秒，不把后续网络耗时算入作答。 */
    const submitRating = (rating: ReviewRating, submittedAt: number) => {
        const runningMs = clock.current.runningSince === null ? 0 : submittedAt - clock.current.runningSince;
        const durationMs = Math.max(0, Math.round(clock.current.elapsedMs + runningMs));
        return onRate(rating, durationMs);
    };

    return <article className="rounded-xl border p-4 space-y-3">
        <h2 className="text-xl font-semibold">{word.word}</h2>
        {word.contexts.length === 0
            ? <p className="text-sm text-muted-foreground">{t('importedWordHint')}</p>
            : word.contexts.map((context) => <div key={context.id} className="rounded bg-muted p-2 space-y-1">
                <p>{context.sentence}</p>
                <button type="button" className="text-sm underline" disabled={!context.available || busy} onClick={() => void onPlay(context)}>
                    {context.available ? t('playSentence', { title: context.mediaTitle, seconds: context.startSeconds.toFixed(1) }) : t('missingVideo')}
                </button>
            </div>)}
        {!revealed
            ? <button type="button" className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={() => setRevealed(true)}>{t('showMeaning')}</button>
            : <><p aria-live="polite">{word.meaning || t('noMeaning')}</p><div className="flex gap-2">
                {(['forgot', 'unsure', 'remembered'] as ReviewRating[]).map((rating) =>
                    <button key={rating} type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => void submitRating(rating, performance.now())}>{t(rating)}</button>)}
            </div></>}
    </article>;
}
