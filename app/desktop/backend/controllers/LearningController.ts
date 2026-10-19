import { inject, injectable } from 'inversify';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import type Controller from '@/backend/controllers/Controller';
import TYPES from '@/backend/ioc/types';
import LearningService from '@/backend/services/LearningService';

/** 将学习业务操作注册为受类型约束的 IPC 路由。 */
@injectable()
export default class LearningController implements Controller {
    /** 注入学习服务。 */
    constructor(@inject(TYPES.LearningService) private readonly learning: LearningService) {}

    /** 注册账号、复习与笔记本操作。 */
    public registerRoutes(): void {
        registerRoute('learning/session', async () => this.learning.session());
        registerRoute('learning/server/set', async ({ url }) => this.learning.setUrl(url));
        registerRoute('learning/register', ({ email, password }) => this.learning.register(email, password));
        registerRoute('learning/login', ({ email, password }) => this.learning.login(email, password));
        registerRoute('learning/logout', async () => this.learning.logout());
        registerRoute('learning/import-local', () => this.learning.importLocalWords());
        registerRoute('learning/word/save', (input) => this.learning.saveWord(input));
        registerRoute('learning/word/delete', ({ word }) => this.learning.deleteWord(word));
        registerRoute('learning/words', () => this.learning.words());
        registerRoute('learning/overview', () => this.learning.overview());
        registerRoute('learning/review', ({ wordId, rating }) => this.learning.review(wordId, rating));
        registerRoute('learning/stats', () => this.learning.stats());
        registerRoute('learning/notebooks', () => this.learning.notebooks());
        registerRoute('learning/notebook/create', ({ title }) => this.learning.createNotebook(title));
        registerRoute('learning/notebook/add-source', (input) => this.learning.addSource(input));
        registerRoute('learning/notebook/remove-source', (input) => this.learning.removeSource(input));
        registerRoute('learning/playback', ({ mediaKey, startSeconds }) => this.learning.playback(mediaKey, startSeconds));
        registerRoute('learning/notebook/answer', ({ notebookId, question }) => this.learning.answer(notebookId, question, 'question'));
        registerRoute('learning/notebook/summary', ({ notebookId }) => this.learning.answer(notebookId, '', 'summary'));
        registerRoute('learning/notebook/quiz/create', ({ notebookId }) => this.learning.createQuiz(notebookId));
        registerRoute('learning/notebook/quiz/submit', ({ quizId, answers }) => this.learning.submitQuiz(quizId, answers));
        registerRoute('learning/notebook/quizzes', ({ notebookId }) => this.learning.quizzes(notebookId));
        registerRoute('learning/notebook/note/add', ({ notebookId, content }) => this.learning.addNote(notebookId, content));
        registerRoute('learning/notebook/notes', ({ notebookId }) => this.learning.notes(notebookId));
    }
}
