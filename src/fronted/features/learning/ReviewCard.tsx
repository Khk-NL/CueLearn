import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LearningContext, LearningWord, ReviewRating } from '@/common/contracts/learning';

/** 一张到期卡片的交互入参。 */
interface ReviewCardProps {
    word: LearningWord;
    busy: boolean;
    onPlay: (context: LearningContext) => Promise<void>;
    onRate: (rating: ReviewRating) => Promise<void>;
}

/** 先用原句和原声帮助回忆，揭示释义后才允许记录复习评分。 */
export default function ReviewCard({ word, busy, onPlay, onRate }: ReviewCardProps) {
    const [revealed, setRevealed] = useState(false);
    const { t } = useTranslation('learning');

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
                    <button key={rating} type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => void onRate(rating)}>{t(rating)}</button>)}
            </div></>}
    </article>;
}
