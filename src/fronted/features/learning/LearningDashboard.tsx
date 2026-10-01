import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { LearningAccount, LearningNotebook, LearningNote, LearningQuiz, LearningStats, LearningWord, NotebookCitation } from '@/common/contracts/learning';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import { learningApi } from './learningApi';
import ReviewCard from './ReviewCard';
import CitedNote from './CitedNote';

/** 将未知异常变成能在页面显示的文字。 */
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** 课程学习主界面：账号、复习和有出处的笔记本。 */
export default function LearningDashboard() {
    const navigate = useNavigate();
    const [url, setUrl] = useState('');
    const [account, setAccount] = useState<LearningAccount | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<'review' | 'notebook'>('review');
    const [words, setWords] = useState<LearningWord[]>([]);
    const [stats, setStats] = useState<LearningStats | null>(null);
    const [books, setBooks] = useState<LearningNotebook[]>([]);
    const [selectedBook, setSelectedBook] = useState('');
    const [title, setTitle] = useState('');
    const [history, setHistory] = useState<WatchHistoryVO[]>([]);
    const [selectedVideo, setSelectedVideo] = useState('');
    const [question, setQuestion] = useState('');
    const [note, setNote] = useState('');
    const [notes, setNotes] = useState<LearningNote[]>([]);
    const [quizzes, setQuizzes] = useState<LearningQuiz[]>([]);
    const [answers, setAnswers] = useState<Record<string, number[]>>({});
    const [now, setNow] = useState(() => Date.now());

    /** FSRS 的短期复习可能在数分钟后到期，定时刷新页面上的到期队列。 */
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, []);

    /** 刷新当前账号的学习数据，退出时清空前一个账号的内容。 */
    const refresh = useCallback(async (active: LearningAccount | null) => {
        if (!active) { setWords([]); setStats(null); setBooks([]); setSelectedBook(''); setNotes([]); setQuizzes([]); return; }
        const [nextWords, nextStats, nextBooks, roots] = await Promise.all([
            learningApi.words(), learningApi.stats(), learningApi.notebooks(), fileBrowserApi.listWatchHistory(),
        ]);
        const folders = roots.filter((item) => item.isFolder);
        const nested = await Promise.all(folders.map((folder) => fileBrowserApi.listWatchHistoryByPath(folder.id)));
        const videos = [...roots, ...nested.flat()];
        setWords(nextWords); setStats(nextStats); setBooks(nextBooks);
        setNow(Date.now());
        setHistory(videos.filter((video) => !video.isFolder && !!video.srtFile));
        setSelectedBook((current) => nextBooks.some((book) => book.id === current) ? current : nextBooks[0]?.id ?? '');
    }, []);

    /** 加载登录态及本机服务地址。 */
    useEffect(() => {
        let active = true;
        learningApi.session().then(async (session) => {
            if (!active) return;
            setUrl(session.url); setAccount(session.account);
            await refresh(session.account);
        }).catch((cause) => { if (active) setError(message(cause)); });
        return () => { active = false; };
    }, [refresh]);

    /** 选中笔记本时读取其保存的内容。 */
    useEffect(() => {
        if (!selectedBook || !account) return;
        let active = true;
        Promise.all([learningApi.notes(selectedBook), learningApi.quizzes(selectedBook)]).then(([nextNotes, nextQuizzes]) => {
            if (active) { setNotes(nextNotes); setQuizzes(nextQuizzes); }
        }).catch((cause) => { if (active) setError(message(cause)); });
        return () => { active = false; };
    }, [selectedBook, account]);

    /** 执行一次用户操作并把错误保留在页面上。 */
    const run = async (action: () => Promise<void>) => {
        setBusy(true); setError('');
        try { await action(); } catch (cause) {
            setError(message(cause));
            const session = await learningApi.session();
            if (account && !session.account) { setAccount(null); await refresh(null); }
        }
        finally { setBusy(false); }
    };

    /** 跳回已登记的视频和字幕时间点。 */
    const openCitation = async (citation: NotebookCitation | { mediaKey: string; startSeconds: number }) => {
        await run(async () => {
            const target = await learningApi.playback(citation.mediaKey, citation.startSeconds);
            navigate(`/player/${target.videoId}?learningAt=${target.startSeconds}`);
        });
    };

    /** 每个服务地址和账号首次在本机登录时询问导入，本机词表始终保留。 */
    const signIn = (register: boolean) => run(async () => {
        if (register) await learningApi.register(email, password);
        const next = await learningApi.login(email, password);
        setAccount(next); setPassword('');
        await refresh(next);
        const server = (await learningApi.session()).url;
        const promptKey = `cuelearn:import-prompt:${server}:${next.id}`;
        if (window.localStorage.getItem(promptKey) !== null) return;
        if (window.confirm('是否把本机已有生词导入这个学习账号？本机词表会保留。')) {
            const result = await learningApi.importLocal();
            toast.success(`已导入 ${result.imported} 个生词，跳过 ${result.existed} 个已有词`);
            await refresh(next);
        }
        window.localStorage.setItem(promptKey, 'done');
    });

    const due = words.filter((word) => new Date(word.dueAt).getTime() <= now)
        .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    const book = books.find((item) => item.id === selectedBook);

    return <div className="h-full overflow-y-auto p-6 text-foreground space-y-5">
        <header><h1 className="text-2xl font-semibold">视频语境学习</h1><p className="text-sm text-muted-foreground">从字幕收藏生词，复习原句，再核对笔记本的出处。</p></header>
        {error && <div role="alert" className="rounded-lg bg-red-100 p-3 text-sm text-red-800">{error}</div>}
        <section className="rounded-xl border p-4 space-y-3">
            <label className="block text-sm">PocketBase 地址<input className="mt-1 w-full rounded border bg-background p-2" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} /></label>
            <button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={busy} onClick={() => void run(async () => { await learningApi.setServer(url); setAccount(null); await refresh(null); })}>保存地址</button>
            {account ? <div className="flex items-center gap-3"><span>已登录：{account.email}</span><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.logout(); setAccount(null); await refresh(null); })}>退出登录</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => { if (window.confirm('是否导入本机生词？已有远端词条会跳过。')) void run(async () => { const result = await learningApi.importLocal(); toast.success(`已导入 ${result.imported} 个`); await refresh(account); }); }}>导入本机生词</button></div>
                : <div className="space-y-2"><div className="flex gap-2"><input aria-label="邮箱" type="email" className="min-w-0 flex-1 rounded border bg-background p-2" placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} /><input aria-label="密码" type="password" className="min-w-0 flex-1 rounded border bg-background p-2" placeholder="密码" value={password} onChange={(event) => setPassword(event.target.value)} /></div><div className="flex gap-2"><button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={busy} onClick={() => void signIn(false)}>登录</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void signIn(true)}>注册并登录</button></div></div>}
        </section>
        {account && <><nav className="flex gap-2"><button className="rounded border px-4 py-2" aria-current={tab === 'review' ? 'page' : undefined} onClick={() => setTab('review')}>生词复习</button><button className="rounded border px-4 py-2" aria-current={tab === 'notebook' ? 'page' : undefined} onClick={() => setTab('notebook')}>学习笔记本</button></nav>
            {tab === 'review' ? <section className="space-y-4"><p>待复习 {due.length} · 今日完成 {stats?.completedToday ?? 0} · 近七日记得比例 {Math.round((stats?.recentRememberedRate ?? 0) * 100)}%</p>
                {due.length === 0 && <p className="text-muted-foreground">目前没有到期生词。在播放器字幕中查词并收藏后即可复习。</p>}
                {due.slice(0, 1).map((word) => <ReviewCard key={word.id} word={word} busy={busy}
                    onPlay={openCitation}
                    onRate={(rating) => run(async () => { await learningApi.review(word.id, rating); await refresh(account); })} />)}
            </section> : <section className="space-y-4"><div className="flex gap-2"><input className="flex-1 rounded border bg-background p-2" aria-label="新笔记本名称" placeholder="新笔记本名称" value={title} onChange={(event) => setTitle(event.target.value)} /><button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={busy} onClick={() => void run(async () => { const id = await learningApi.createNotebook(title); setTitle(''); await refresh(account); setSelectedBook(id); })}>创建</button></div>
                <select aria-label="选择笔记本" className="w-full rounded border bg-background p-2" value={selectedBook} onChange={(event) => setSelectedBook(event.target.value)}><option value="">选择笔记本</option>{books.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>
                {book && <><div className="rounded-xl border p-4 space-y-2"><h2 className="font-semibold">资料视频（最多五个）</h2>{book.sources.map((source) => <div key={source.id} className="flex items-center justify-between gap-3"><p>{source.mediaTitle} · {source.available ? '可用' : '本机视频或字幕缺失'}</p><button type="button" className="rounded border px-2 py-1" aria-label={`移除资料：${source.mediaTitle}`} disabled={busy} onClick={() => void run(async () => { await learningApi.removeSource({ notebookId: book.id, sourceId: source.id }); await refresh(account); })}>移除</button></div>)}<div className="flex gap-2"><select aria-label="选择带字幕的视频" className="flex-1 rounded border bg-background p-2" value={selectedVideo} onChange={(event) => setSelectedVideo(event.target.value)}><option value="">选择已有视频</option>{history.map((video) => <option value={video.id} key={video.id}>{video.displayFileName || video.fileName}</option>)}</select><button className="rounded border px-3 py-2" disabled={busy || !selectedVideo || book.sources.length >= 5} onClick={() => void run(async () => { await learningApi.addSource({ notebookId: book.id, videoId: selectedVideo }); await refresh(account); })}>加入资料</button></div></div>
                    <div className="rounded-xl border p-4 space-y-2"><h2 className="font-semibold">根据资料学习</h2><div className="flex gap-2"><input className="flex-1 rounded border bg-background p-2" aria-label="向资料提问" placeholder="向所选字幕提问" value={question} onChange={(event) => setQuestion(event.target.value)} /><button className="rounded border px-3 py-2" disabled={busy || !question.trim()} onClick={() => void run(async () => { await learningApi.answer(book.id, question); setQuestion(''); setNotes(await learningApi.notes(book.id)); })}>提问</button></div><div className="flex gap-2"><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.summary(book.id); setNotes(await learningApi.notes(book.id)); })}>生成摘要</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.createQuiz(book.id); setQuizzes(await learningApi.quizzes(book.id)); })}>生成小测验</button></div></div>
                    <div className="rounded-xl border p-4 space-y-2"><h2 className="font-semibold">我的笔记</h2><textarea className="w-full rounded border bg-background p-2" aria-label="笔记内容" value={note} onChange={(event) => setNote(event.target.value)} /><button className="rounded border px-3 py-2" disabled={busy || !note.trim()} onClick={() => void run(async () => { await learningApi.addNote(book.id, note); setNote(''); setNotes(await learningApi.notes(book.id)); })}>保存笔记</button>{notes.map((item) => <CitedNote key={item.id} note={item} onCitation={openCitation} />)}</div>
                    {quizzes.map((quiz) => <article key={quiz.id} className="rounded-xl border p-4 space-y-3"><h2 className="font-semibold">小测验 {quiz.answers ? `· 答对 ${quiz.answers.filter((answer, index) => answer === quiz.questions[index].correctIndex).length}/${quiz.questions.length}` : '· 待作答'}</h2>{quiz.questions.map((item, index) => <div key={index}><p>{index + 1}. {item.prompt}</p>{item.options.map((option, optionIndex) => <label className="block" key={optionIndex}><input type="radio" name={`${quiz.id}-${index}`} disabled={!!quiz.answers} checked={(quiz.answers ?? answers[quiz.id])?.[index] === optionIndex} onChange={() => setAnswers((previous) => { const next = [...(previous[quiz.id] ?? [])]; next[index] = optionIndex; return { ...previous, [quiz.id]: next }; })} /> {option}</label>)}{quiz.answers && <><p className="text-sm">正确答案：{item.options[item.correctIndex]}。{item.explanation}</p><button className="text-sm underline" onClick={() => void openCitation(item.citation)}>查看出处：{item.citation.mediaTitle} {item.citation.startSeconds.toFixed(1)} 秒</button></>}</div>)}{!quiz.answers && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.submitQuiz(quiz.id, answers[quiz.id] ?? []); setQuizzes(await learningApi.quizzes(book.id)); })}>提交测验</button>}</article>)}
                </>}
            </section>}</>}
    </div>;
}
