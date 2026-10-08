import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type { LearningContextInput, NotebookSourceInput, NotebookSourceRemoval, ReviewRating } from '@/common/contracts/learning';

/** 课程学习页只通过受限的业务 IPC 访问账号与学习数据。 */
export const learningApi = {
    /** 读取学习服务地址和当前账号。 */
    session: () => backendClient.call('learning/session'),
    /** 保存 PocketBase 地址并退出旧账号。 */
    setServer: (url: string) => backendClient.call('learning/server/set', { url }),
    /** 注册普通学习账号。 */
    register: (email: string, password: string) => backendClient.call('learning/register', { email, password }),
    /** 登录学习账号。 */
    login: (email: string, password: string) => backendClient.call('learning/login', { email, password }),
    /** 退出当前学习账号。 */
    logout: () => backendClient.call('learning/logout'),
    /** 将本机词表导入当前账号。 */
    importLocal: () => backendClient.call('learning/import-local'),
    /** 保存生词及当前字幕语境。 */
    saveWord: (input: LearningContextInput) => backendClient.call('learning/word/save', input),
    /** 删除当前账号的生词。 */
    deleteWord: (word: string) => backendClient.call('learning/word/delete', { word }),
    /** 读取单词及复习进度。 */
    words: () => backendClient.call('learning/words'),
    /** 一次读取学习首页需要的词表与统计。 */
    overview: () => backendClient.call('learning/overview'),
    /** 提交一次复习评分。 */
    review: (wordId: string, rating: ReviewRating) => backendClient.call('learning/review', { wordId, rating }),
    /** 读取今日和近期复习统计。 */
    stats: () => backendClient.call('learning/stats'),
    /** 读取笔记本及资料状态。 */
    notebooks: () => backendClient.call('learning/notebooks'),
    /** 创建笔记本。 */
    createNotebook: (title: string) => backendClient.call('learning/notebook/create', { title }),
    /** 将已有视频加入笔记本。 */
    addSource: (input: NotebookSourceInput) => backendClient.call('learning/notebook/add-source', input),
    /** 从笔记本移除资料关联。 */
    removeSource: (input: NotebookSourceRemoval) => backendClient.call('learning/notebook/remove-source', input),
    /** 根据选中字幕回答问题。 */
    answer: (notebookId: string, question: string) => backendClient.call('learning/notebook/answer', { notebookId, question }),
    /** 根据选中字幕生成摘要。 */
    summary: (notebookId: string) => backendClient.call('learning/notebook/summary', { notebookId }),
    /** 根据选中字幕生成测验。 */
    createQuiz: (notebookId: string) => backendClient.call('learning/notebook/quiz/create', { notebookId }),
    /** 保存测验答案。 */
    submitQuiz: (quizId: string, answers: number[]) => backendClient.call('learning/notebook/quiz/submit', { quizId, answers }),
    /** 读取笔记本的测验。 */
    quizzes: (notebookId: string) => backendClient.call('learning/notebook/quizzes', { notebookId }),
    /** 保存手写笔记。 */
    addNote: (notebookId: string, content: string) => backendClient.call('learning/notebook/note/add', { notebookId, content }),
    /** 读取笔记与历史问答。 */
    notes: (notebookId: string) => backendClient.call('learning/notebook/notes', { notebookId }),
    /** 定位字幕出处对应的本机视频。 */
    playback: (mediaKey: string, startSeconds: number) => backendClient.call('learning/playback', { mediaKey, startSeconds }),
};
