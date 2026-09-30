import type { ReviewRating } from '@/common/contracts/learning';

/** 复习事件的最小输入。 */
export interface ReviewOccurrence { rating: ReviewRating; reviewedAt: string }

/** 根据唯一的作答历史计算下一次到期时间；没有历史的词立即到期。 */
export function deriveReviewDue(events: ReviewOccurrence[]): string {
    if (events.length === 0) return new Date(0).toISOString();
    const sorted = [...events].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
    let streak = 0;
    let due = new Date(0);
    const rememberedDays = [1, 3, 7, 14, 30, 60];
    for (const event of sorted) {
        const reviewed = new Date(event.reviewedAt);
        if (Number.isNaN(reviewed.getTime())) throw new Error('复习记录时间无效');
        streak = event.rating === 'remembered' ? streak + 1 : 0;
        const days = event.rating === 'forgot' ? 1 : event.rating === 'unsure' ? 2 : rememberedDays[Math.min(streak - 1, rememberedDays.length - 1)];
        due = new Date(reviewed.getTime() + days * 86400000);
    }
    return due.toISOString();
}
