import { inject, injectable } from 'inversify';
import path from 'node:path';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import TYPES from '@/backend/ioc/types';
import type { LearningAccount, LearningContext, LearningContextInput, LearningNotebook, LearningStats, LearningWord, NotebookSourceInput, ReviewRating, NotebookCitation, NotebookAnswer, NotebookQuestion, LearningNote, LearningQuiz } from '@/common/contracts/learning';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';
import type WatchHistoryRepository from '@/backend/services/repositories/WatchHistoryRepository';
import type WatchHistoryService from '@/backend/services/WatchHistoryService';
import type SubtitleService from '@/backend/services/SubtitleService';
import type AiProviderService from '@/backend/services/AiProviderService';
import { CLOUD_AI_NOT_CONFIGURED_MESSAGE } from '@/backend/services/AiProviderService';
import PocketBaseClient, { type PbRecord } from '@/backend/infrastructure/learning/PocketBaseClient';
import LocalLearningMedia from '@/backend/infrastructure/learning/LocalLearningMedia';
import { deriveReviewDue } from '@/backend/services/learning/reviewSchedule';
import { concurrency } from '@/backend/utils/concurrency';

/** PocketBase 生词记录。 */
interface WordRecord extends PbRecord { word: string; meaning: string }
/** PocketBase 字幕语境记录。 */
interface ContextRecord extends PbRecord { word_item: string; media_key: string; media_title: string; sentence: string; start_seconds: number; end_seconds: number; sentence_index: number }
/** PocketBase 复习事件。 */
interface ReviewRecord extends PbRecord { word_item: string; rating: ReviewRating; reviewed_at: string }
/** PocketBase 笔记本记录。 */
interface NotebookRecord extends PbRecord { title: string }
/** PocketBase 笔记本资料记录。 */
interface SourceRecord extends PbRecord { notebook: string; media_key: string; media_title: string; subtitle_hash: string }
/** PocketBase 笔记记录。 */
interface NoteRecord extends PbRecord { notebook: string; kind: 'manual' | 'summary' | 'question'; content: string; citations: NotebookCitation[] }
/** PocketBase 测验记录。 */
interface QuizRecord extends PbRecord { notebook: string; questions: NotebookQuestion[]; answers: number[] | null }

/** AI 按逐条论述返回现有字幕行号，正文引用由主进程重新编号。 */
const answerSchema = z.object({ insufficient: z.boolean(), claims: z.array(z.object({
    text: z.string().min(1), citationIds: z.array(z.number().int()).min(1).max(3),
})).max(8) });
/** 每道题都必须含有可核对的字幕来源。 */
const quizSchema = z.object({ insufficient: z.boolean(), questions: z.array(z.object({ prompt: z.string().min(1), options: z.array(z.string()).length(4), correctIndex: z.number().int().min(0).max(3), explanation: z.string(), citationId: z.number().int() })).max(5) });

/** 编排学习账号、生词复习与笔记本的持久化流程。 */
@injectable()
export default class LearningService {
    /** 创建学习服务，复用现有本地词汇仓储。 */
    constructor(
        @inject(TYPES.PocketBaseClient) private readonly pb: PocketBaseClient,
        @inject(TYPES.LocalLearningMedia) private readonly media: LocalLearningMedia,
        @inject(TYPES.WordsRepository) private readonly localWords: WordsRepository,
        @inject(TYPES.WatchHistoryRepository) private readonly history: WatchHistoryRepository,
        @inject(TYPES.WatchHistoryService) private readonly watchHistory: WatchHistoryService,
        @inject(TYPES.SubtitleService) private readonly subtitle: SubtitleService,
        @inject(TYPES.AiProviderService) private readonly ai: AiProviderService,
    ) {}

    /** 返回连接地址与当前登录账号。 */
    public session(): { url: string; account: LearningAccount | null } { return { url: this.pb.getUrl(), account: this.pb.getAccount() }; }
    /** 修改 PocketBase 地址。 */
    public setUrl(url: string): void { this.pb.setUrl(url); }
    /** 注册普通账号。 */
    public register(email: string, password: string): Promise<void> { return this.pb.register(email, password); }
    /** 登录学习账号。 */
    public login(email: string, password: string): Promise<LearningAccount> { return this.pb.login(email, password); }
    /** 退出学习账号。 */
    public logout(): void { this.pb.logout(); }

    /** 用户确认后将本地词汇导入当前账号，保留本地词汇不变。 */
    public async importLocalWords(): Promise<{ imported: number; existed: number }> {
        const local = await this.localWords.getAll();
        const remote = await this.pb.list<WordRecord>('vocabulary_items');
        const present = new Set(remote.map((item) => item.word.toLowerCase()));
        let imported = 0;
        let existed = 0;
        for (const item of local) {
            if (present.has(item.word.toLowerCase())) { existed += 1; continue; }
            await this.pb.create('vocabulary_items', { word: item.word.toLowerCase(), meaning: item.translate ?? '' });
            present.add(item.word.toLowerCase());
            imported += 1;
        }
        return { imported, existed };
    }

    /** 保存生词和可选的视频语境，重复词条只增加新的语境。 */
    public async saveWord(input: LearningContextInput): Promise<void> {
        const word = input.word.trim().toLowerCase();
        if (!word) throw new Error('单词不能为空');
        if (input.mediaPath && input.sentence) {
            if (input.startSeconds === undefined || input.endSeconds === undefined || input.sentenceIndex === undefined) throw new Error('字幕语境缺少时间或序号');
            if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds) ||
                input.startSeconds < 0 || input.endSeconds <= input.startSeconds ||
                !Number.isInteger(input.sentenceIndex) || input.sentenceIndex < 0) throw new Error('字幕语境时间或序号无效');
        }
        const existing = (await this.pb.list<WordRecord>('vocabulary_items')).find((item) => item.word === word);
        const item = existing ?? await this.pb.create<WordRecord>('vocabulary_items', { word, meaning: input.meaning.trim() });
        if (!input.mediaPath || !input.sentence) return;
        const mediaKey = await this.media.fingerprint(input.mediaPath);
        this.media.remember(mediaKey, { mediaPath: input.mediaPath, videoId: input.videoId });
        const contexts = await this.pb.list<ContextRecord>('word_contexts');
        if (contexts.some((context) => context.word_item === item.id && context.media_key === mediaKey && context.sentence_index === input.sentenceIndex)) return;
        await this.pb.create('word_contexts', {
            word_item: item.id, media_key: mediaKey, media_title: input.mediaTitle ?? path.basename(input.mediaPath),
            subtitle_hash: input.subtitleHash ?? '', sentence_index: input.sentenceIndex,
            start_seconds: input.startSeconds, end_seconds: input.endSeconds, sentence: input.sentence,
        });
    }

    /** 取消收藏时删除当前账号中的对应词条及其关联语境、复习记录。 */
    public async deleteWord(word: string): Promise<void> {
        const item = (await this.pb.list<WordRecord>('vocabulary_items')).find((entry) => entry.word === word.trim().toLowerCase());
        if (item) await this.pb.delete('vocabulary_items', item.id);
    }

    /** 查询全部单词、语境和按作答历史计算的到期时间。 */
    public async words(): Promise<LearningWord[]> {
        const [words, contexts, reviews] = await Promise.all([
            this.pb.list<WordRecord>('vocabulary_items'),
            this.pb.list<ContextRecord>('word_contexts'),
            this.pb.list<ReviewRecord>('review_events'),
        ]);
        return Promise.all(words.map(async (item) => {
            const attached = contexts.filter((context) => context.word_item === item.id);
            const displayContexts: LearningContext[] = await Promise.all(attached.map(async (context) => ({
                id: context.id, mediaKey: context.media_key, mediaTitle: context.media_title, sentence: context.sentence,
                startSeconds: context.start_seconds, endSeconds: context.end_seconds,
                available: !!(await this.media.resolve(context.media_key)),
            })));
            const history = reviews.filter((review) => review.word_item === item.id);
            return { id: item.id, word: item.word, meaning: item.meaning, contexts: displayContexts,
                reviews: history.length, dueAt: deriveReviewDue(history.map((event) => ({ rating: event.rating, reviewedAt: event.reviewed_at }))) };
        }));
    }

    /** 对自己拥有的词写入一次复习事件。 */
    public async review(wordId: string, rating: ReviewRating): Promise<void> {
        if (!['forgot', 'unsure', 'remembered'].includes(rating)) throw new Error('复习评分无效');
        if (!(await this.pb.list<WordRecord>('vocabulary_items')).some((item) => item.id === wordId)) throw new Error('生词不存在');
        await this.pb.create('review_events', { word_item: wordId, rating, reviewed_at: new Date().toISOString() });
    }

    /** 计算当前账号的到期数量、今日完成量和近期记得比例。 */
    public async stats(): Promise<LearningStats> {
        const [words, reviews] = await Promise.all([this.words(), this.pb.list<ReviewRecord>('review_events')]);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const recent = reviews.filter((review) => new Date(review.reviewed_at).getTime() >= Date.now() - 7 * 86400000);
        return { due: words.filter((word) => word.dueAt <= new Date().toISOString()).length,
            completedToday: reviews.filter((review) => new Date(review.reviewed_at).getTime() >= today.getTime()).length,
            recentRememberedRate: recent.length ? recent.filter((review) => review.rating === 'remembered').length / recent.length : 0 };
    }

    /** 创建一个空笔记本。 */
    public async createNotebook(title: string): Promise<string> {
        if (!title.trim()) throw new Error('笔记本名称不能为空');
        const item = await this.pb.create<NotebookRecord>('notebooks', { title: title.trim() });
        return item.id;
    }

    /** 为笔记本关联本地视频与字幕，仅同步不含本机路径的指纹。 */
    public async addSource(input: NotebookSourceInput): Promise<void> {
        if (!(await this.pb.list<NotebookRecord>('notebooks')).some((book) => book.id === input.notebookId)) throw new Error('笔记本不存在');
        const video = await this.history.findById(input.videoId);
        if (!video) throw new Error('本机视频记录不存在');
        const resolution = await this.watchHistory.playerSubtitle(input.videoId);
        if (!resolution.subtitlePath) throw new Error('该视频尚未关联字幕');
        const mediaPath = path.join(video.base_path, video.file_name);
        const mediaKey = await this.media.fingerprint(mediaPath);
        const subtitleHash = await this.media.fingerprint(resolution.subtitlePath);
        const sources = await this.pb.list<SourceRecord>('notebook_sources');
        this.media.remember(mediaKey, { mediaPath, subtitlePath: resolution.subtitlePath, videoId: video.id });
        if (sources.some((source) => source.notebook === input.notebookId && source.media_key === mediaKey)) return;
        if (sources.filter((source) => source.notebook === input.notebookId).length >= 5) throw new Error('每个笔记本最多选择五个视频');
        await this.pb.create('notebook_sources', { notebook: input.notebookId, media_key: mediaKey,
            media_title: video.file_name, subtitle_hash: subtitleHash });
    }

    /** 列出账号笔记本及资料可用状态。 */
    public async notebooks(): Promise<LearningNotebook[]> {
        const [books, sources] = await Promise.all([this.pb.list<NotebookRecord>('notebooks'), this.pb.list<SourceRecord>('notebook_sources')]);
        return Promise.all(books.map(async (book) => ({ id: book.id, title: book.title,
            sources: await Promise.all(sources.filter((source) => source.notebook === book.id).map(async (source) => ({
                id: source.id, mediaKey: source.media_key, mediaTitle: source.media_title,
                available: !!(await this.media.resolve(source.media_key, true)),
            }))) })));
    }

    /** 根据当前机器上的映射返回播放路径与起点。 */
    public async playback(mediaKey: string, startSeconds: number): Promise<{ videoId: string; startSeconds: number }> {
        if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new Error('播放时间无效');
        const [contexts, sources] = await Promise.all([this.pb.list<ContextRecord>('word_contexts'), this.pb.list<SourceRecord>('notebook_sources')]);
        if (![...contexts, ...sources].some((item) => item.media_key === mediaKey)) throw new Error('当前账号无权访问该视频出处');
        const binding = await this.media.resolve(mediaKey);
        if (!binding) throw new Error('本机找不到该视频，请重新关联文件');
        if (await this.media.fingerprint(binding.mediaPath) !== mediaKey) throw new Error('本机视频内容已变化，请重新关联');
        if (!binding.videoId || !(await this.history.findById(binding.videoId))) throw new Error('本机视频记录已失效，请重新关联');
        return { videoId: binding.videoId, startSeconds };
    }

    /** 读取选中资料的真实字幕，并对每条引用分配当前请求内的编号。 */
    private async notebookLines(notebookId: string): Promise<Array<{ id: number; citation: NotebookCitation }>> {
        if (!(await this.pb.list<NotebookRecord>('notebooks')).some((book) => book.id === notebookId)) throw new Error('笔记本不存在');
        const sources = (await this.pb.list<SourceRecord>('notebook_sources')).filter((source) => source.notebook === notebookId);
        if (!sources.length) throw new Error('请先为笔记本选择带字幕的视频');
        const lines: Array<{ id: number; citation: NotebookCitation }> = [];
        for (const source of sources) {
            const binding = await this.media.resolve(source.media_key, true);
            if (!binding?.subtitlePath) throw new Error(`本机找不到「${source.media_title}」或其字幕，请重新关联`);
            if (await this.media.fingerprint(binding.subtitlePath) !== source.subtitle_hash) throw new Error(`「${source.media_title}」的字幕已变化，请重新关联`);
            const parsed = await this.subtitle.parseSrt(binding.subtitlePath);
            for (const sentence of parsed.sentences) {
                if (!sentence.text.trim()) continue;
                lines.push({ id: lines.length + 1, citation: { mediaKey: source.media_key, mediaTitle: source.media_title,
                    sentenceIndex: sentence.index, sentence: sentence.text,
                    startSeconds: sentence.adjustedStart ?? sentence.start, endSeconds: sentence.adjustedEnd ?? sentence.end, available: true } });
            }
        }
        if (lines.length < 2) throw new Error('所选字幕内容不足，无法回答或出题');
        if (lines.length > 240) throw new Error('所选资料字幕过长，请减少资料或选择较短的视频');
        return lines;
    }

    /** 向已配置的学习模型发送经过范围限制的字幕，要求只引用编号。 */
    private async generate<T>(schema: z.ZodType<T>, task: string, lines: Array<{ id: number; citation: NotebookCitation }>): Promise<T> {
        const model = this.ai.getModel('sentenceLearning');
        if (!model) throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
        const material = lines.map(({ id, citation }) => `[${id}] ${citation.mediaTitle} ${citation.startSeconds.toFixed(1)}s ${citation.sentence}`).join('\n');
        if (material.length > 24000) throw new Error('字幕内容过长，请减少资料');
        const { output } = await concurrency.withRateLimit('gpt', () => generateText({ model, output: Output.object({ schema }),
            prompt: `你是视频学习助手。只能根据下面的字幕材料完成任务。若材料不足，将 insufficient 设为 true，论述或题目列表留空；不得补造事实、时间点或编号。每条论述必须通过 citationIds 提供支持它的字幕编号，text 中不要自行插入引用标记。\n任务：${task}\n字幕材料：\n${material}` }));
        return output;
    }

    /** 生成基于选中字幕的回答或摘要，并保存可核对的来源。 */
    public async answer(notebookId: string, question: string, kind: 'question' | 'summary'): Promise<NotebookAnswer> {
        if (kind === 'question' && !question.trim()) throw new Error('问题不能为空');
        const lines = await this.notebookLines(notebookId);
        const generated = await this.generate(answerSchema, kind === 'summary' ? '概括学习重点，给出少量关键字幕出处' : `回答问题：${question}`, lines);
        if (generated.insufficient) throw new Error('所选字幕资料不足，无法回答这个问题');
        if (!generated.claims.length) throw new Error('回答缺少字幕出处，请重试');
        const citations: NotebookCitation[] = [];
        const citationNumbers = new Map<number, number>();
        const paragraphs = generated.claims.map((claim) => {
            if (/\[\d+\]/.test(claim.text)) throw new Error('模型在正文中返回了未核对的引用标记，请重试');
            const markers = [...new Set(claim.citationIds)].map((id) => {
                const source = lines.find((line) => line.id === id)?.citation;
                if (!source) throw new Error('模型返回了不存在的字幕出处，请重试');
                if (!citationNumbers.has(id)) {
                    citations.push(source);
                    citationNumbers.set(id, citations.length);
                }
                return `[${citationNumbers.get(id)}]`;
            });
            return `${claim.text.trim()} ${markers.join(' ')}`;
        });
        const result = { text: paragraphs.join('\n\n'), citations };
        await this.pb.create('notes', { notebook: notebookId, kind, content: kind === 'question' ? `${question}\n${result.text}` : result.text, citations: result.citations });
        return result;
    }

    /** 生成带真实字幕出处的四选一题目。 */
    public async createQuiz(notebookId: string): Promise<LearningQuiz> {
        const lines = await this.notebookLines(notebookId);
        const generated = await this.generate(quizSchema, '生成 3 道基于字幕内容的四选一理解题，每题给出可核对的字幕编号', lines);
        if (generated.insufficient || !generated.questions.length) throw new Error('所选字幕资料不足，无法生成测验');
        const questions = generated.questions.map((item) => {
            const citation = lines.find((line) => line.id === item.citationId)?.citation;
            if (!citation) throw new Error('模型返回了不存在的字幕出处，请重试');
            return { prompt: item.prompt, options: item.options, correctIndex: item.correctIndex, explanation: item.explanation, citation };
        });
        const saved = await this.pb.create<QuizRecord>('quiz_attempts', { notebook: notebookId, questions });
        return { id: saved.id, questions, answers: null };
    }

    /** 保存用户手写笔记。 */
    public async addNote(notebookId: string, content: string): Promise<void> {
        if (!content.trim()) throw new Error('笔记不能为空');
        if (!(await this.pb.list<NotebookRecord>('notebooks')).some((book) => book.id === notebookId)) throw new Error('笔记本不存在');
        await this.pb.create('notes', { notebook: notebookId, kind: 'manual', content: content.trim(), citations: [] });
    }

    /** 返回笔记本中的笔记和问答。 */
    public async notes(notebookId: string): Promise<LearningNote[]> {
        if (!(await this.pb.list<NotebookRecord>('notebooks')).some((book) => book.id === notebookId)) throw new Error('笔记本不存在');
        return (await this.pb.list<NoteRecord>('notes')).filter((item) => item.notebook === notebookId)
            .map((item) => ({ id: item.id, kind: item.kind, content: item.content, citations: item.citations ?? [] }));
    }

    /** 保存一组测验答案，题目正确项仍以已持久化题目为准。 */
    public async submitQuiz(quizId: string, answers: number[]): Promise<void> {
        const quiz = (await this.pb.list<QuizRecord>('quiz_attempts')).find((item) => item.id === quizId);
        if (!quiz) throw new Error('测验不存在');
        if (quiz.answers?.length) throw new Error('该测验已经提交');
        if (answers.length !== quiz.questions.length || answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer > 3)) throw new Error('请完成全部题目');
        await this.pb.update('quiz_attempts', quizId, { answers });
    }

    /** 返回已生成的题目和历史作答。 */
    public async quizzes(notebookId: string): Promise<LearningQuiz[]> {
        if (!(await this.pb.list<NotebookRecord>('notebooks')).some((book) => book.id === notebookId)) throw new Error('笔记本不存在');
        return (await this.pb.list<QuizRecord>('quiz_attempts')).filter((item) => item.notebook === notebookId)
            .map((item) => ({ id: item.id, questions: item.questions, answers: item.answers ?? null }));
    }
}
