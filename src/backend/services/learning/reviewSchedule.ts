import type { ReviewRating } from '@/common/contracts/learning';
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';

/** 复习事件的最小输入。 */
export interface ReviewOccurrence { rating: ReviewRating; reviewedAt: string }

/** 固定参数使同一组复习事件在每次读取时得到相同的到期时间。 */
const scheduler = fsrs({ enable_fuzz: false });

/** 将现有三档反馈映射到 FSRS 的三档评分，保留原始事件内容。 */
function toFsrsRating(rating: ReviewRating): Rating.Again | Rating.Hard | Rating.Good {
    switch (rating) {
        case 'forgot': return Rating.Again;
        case 'unsure': return Rating.Hard;
        case 'remembered': return Rating.Good;
    }
}

/** 从唯一的作答历史重建 FSRS 卡片；没有历史的词立即到期。 */
export function deriveReviewDue(events: ReviewOccurrence[]): string {
    if (events.length === 0) return new Date(0).toISOString();
    const sorted = [...events].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
    const reviews = sorted.map((event) => {
        const review = new Date(event.reviewedAt);
        if (Number.isNaN(review.getTime())) throw new Error('复习记录时间无效');
        return { review, rating: toFsrsRating(event.rating) };
    });
    const result = scheduler.reschedule(createEmptyCard(reviews[0].review), reviews, { skipManual: true });
    if (!result.reschedule_item) throw new Error('复习记录无法生成排程');
    return result.reschedule_item.card.due.toISOString();
}
