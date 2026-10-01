import { useState } from 'react';
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

    return <article className="rounded-xl border p-4 space-y-3">
        <h2 className="text-xl font-semibold">{word.word}</h2>
        {word.contexts.length === 0
            ? <p className="text-sm text-muted-foreground">这是从旧词表导入的词，暂无视频语境。先回忆词义，再查看答案。</p>
            : word.contexts.map((context) => <div key={context.id} className="rounded bg-muted p-2 space-y-1">
                <p>{context.sentence}</p>
                <button type="button" className="text-sm underline" disabled={!context.available || busy} onClick={() => void onPlay(context)}>
                    {context.available ? `播放原句：${context.mediaTitle} · ${context.startSeconds.toFixed(1)} 秒` : '本机视频缺失'}
                </button>
            </div>)}
        {!revealed
            ? <button type="button" className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={() => setRevealed(true)}>显示释义</button>
            : <><p aria-live="polite">{word.meaning || '暂无释义'}</p><div className="flex gap-2">
                {([['forgot', '忘记'], ['unsure', '模糊'], ['remembered', '记得']] as [ReviewRating, string][]).map(([rating, label]) =>
                    <button key={rating} type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => void onRate(rating)}>{label}</button>)}
            </div></>}
    </article>;
}
