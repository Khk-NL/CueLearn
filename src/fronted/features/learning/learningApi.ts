import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type { LearningContextInput, NotebookSourceInput, NotebookSourceRemoval, ReviewRating } from '@/common/contracts/learning';

/** 课程学习页只通过受限的业务 IPC 访问账号与学习数据。 */
export const learningApi = {
    session: () => backendClient.call('learning/session'),
    setServer: (url: string) => backendClient.call('learning/server/set', { url }),
    register: (email: string, password: string) => backendClient.call('learning/register', { email, password }),
    login: (email: string, password: string) => backendClient.call('learning/login', { email, password }),
    logout: () => backendClient.call('learning/logout'),
    importLocal: () => backendClient.call('learning/import-local'),
    saveWord: (input: LearningContextInput) => backendClient.call('learning/word/save', input),
    deleteWord: (word: string) => backendClient.call('learning/word/delete', { word }),
    words: () => backendClient.call('learning/words'),
    review: (wordId: string, rating: ReviewRating) => backendClient.call('learning/review', { wordId, rating }),
    stats: () => backendClient.call('learning/stats'),
    notebooks: () => backendClient.call('learning/notebooks'),
    createNotebook: (title: string) => backendClient.call('learning/notebook/create', { title }),
    addSource: (input: NotebookSourceInput) => backendClient.call('learning/notebook/add-source', input),
    removeSource: (input: NotebookSourceRemoval) => backendClient.call('learning/notebook/remove-source', input),
    answer: (notebookId: string, question: string) => backendClient.call('learning/notebook/answer', { notebookId, question }),
    summary: (notebookId: string) => backendClient.call('learning/notebook/summary', { notebookId }),
    createQuiz: (notebookId: string) => backendClient.call('learning/notebook/quiz/create', { notebookId }),
    submitQuiz: (quizId: string, answers: number[]) => backendClient.call('learning/notebook/quiz/submit', { quizId, answers }),
    quizzes: (notebookId: string) => backendClient.call('learning/notebook/quizzes', { notebookId }),
    addNote: (notebookId: string, content: string) => backendClient.call('learning/notebook/note/add', { notebookId, content }),
    notes: (notebookId: string) => backendClient.call('learning/notebook/notes', { notebookId }),
    playback: (mediaKey: string, startSeconds: number) => backendClient.call('learning/playback', { mediaKey, startSeconds }),
};
