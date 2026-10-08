/** 登录后的学习账号，不包含认证令牌。 */
export interface LearningAccount { id: string; email: string }

/** 用户收藏单词时保留的字幕语境。 */
export interface LearningContextInput {
    word: string;
    meaning: string;
    mediaPath?: string;
    videoId?: string;
    mediaTitle?: string;
    subtitleHash?: string;
    sentenceIndex?: number;
    startSeconds?: number;
    endSeconds?: number;
    sentence?: string;
}

/** 一条可回放的单词语境。 */
export interface LearningContext {
    id: string;
    mediaKey: string;
    mediaTitle: string;
    sentence: string;
    startSeconds: number;
    endSeconds: number;
    available: boolean;
}

/** 单词及其复习进度。 */
export interface LearningWord {
    id: string;
    word: string;
    meaning: string;
    dueAt: string;
    reviews: number;
    contexts: LearningContext[];
}

/** 复习反馈的三个等级。 */
export type ReviewRating = 'forgot' | 'unsure' | 'remembered';

/** 单个笔记本允许关联的视频数量。 */
export const MAX_NOTEBOOK_SOURCES = 5;

/** 用户选择的视频资料。 */
export interface NotebookSourceInput {
    notebookId: string;
    videoId: string;
}

/** 移除笔记本中的一条资料关联，历史笔记和测验仍保留。 */
export interface NotebookSourceRemoval {
    notebookId: string;
    sourceId: string;
}

/** 笔记本引用的字幕位置。 */
export interface NotebookCitation {
    mediaKey: string;
    mediaTitle: string;
    sentenceIndex: number;
    sentence: string;
    startSeconds: number;
    endSeconds: number;
    available: boolean;
}

/** 笔记本资料和持久化信息。 */
export interface LearningNotebook {
    id: string;
    title: string;
    sources: Array<{ id: string; mediaKey: string; mediaTitle: string; available: boolean }>;
}

/** 基于资料产生的回答或摘要。 */
export interface NotebookAnswer { text: string; citations: NotebookCitation[] }

/** 学习测验单题。 */
export interface NotebookQuestion {
    prompt: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    citation: NotebookCitation;
}

/** 已保存的笔记与问答。 */
export interface LearningNote { id: string; kind: 'manual' | 'summary' | 'question'; content: string; citations: NotebookCitation[] }

/** 已生成的测验及历史作答。 */
export interface LearningQuiz { id: string; questions: NotebookQuestion[]; answers: number[] | null }

/** 学习统计。 */
export interface LearningStats { due: number; completedToday: number; recentRememberedRate: number }
