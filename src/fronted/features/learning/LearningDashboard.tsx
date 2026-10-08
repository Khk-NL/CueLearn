import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { MAX_NOTEBOOK_SOURCES, type LearningAccount, LearningNotebook, LearningNote, LearningQuiz, LearningStats, LearningWord, NotebookCitation } from '@/common/contracts/learning';
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
    const { t } = useTranslation('learning');
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
        const nested = await Promise.all(folders.map((folder) => fileBrowserApi.listWatchHistoryByPath(folder.basePath)));
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
            try {
                const session = await learningApi.session();
                if (account && !session.account) { setAccount(null); await refresh(null); }
            } catch { /* 保留原始操作错误；登录态会在下次刷新时重新读取。 */ }
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
        if (window.confirm(t('importPrompt'))) {
            const result = await learningApi.importLocal();
            toast.success(t('importResult', { imported: result.imported, existed: result.existed }));
            await refresh(next);
        }
        window.localStorage.setItem(promptKey, 'done');
    });

    const due = words.filter((word) => new Date(word.dueAt).getTime() <= now)
        .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    const book = books.find((item) => item.id === selectedBook);

    return <div className="h-full overflow-y-auto p-6 text-foreground space-y-5">
        <header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-sm text-muted-foreground">{t('subtitle')}</p></header>
        {error && <div role="alert" className="rounded-lg bg-red-100 p-3 text-sm text-red-800">{error}</div>}
        <section className="rounded-xl border p-4 space-y-3">
            <label className="block text-sm">{t('serverAddress')}<input className="mt-1 w-full rounded border bg-background p-2" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} /></label>
            <button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={busy} onClick={() => void run(async () => { await learningApi.setServer(url); setAccount(null); await refresh(null); })}>{t('saveAddress')}</button>
            {account ? <div className="flex items-center gap-3"><span>{t('signedIn', { email: account.email })}</span><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.logout(); setAccount(null); await refresh(null); })}>{t('signOut')}</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => { if (window.confirm(t('importAgainPrompt'))) void run(async () => { const result = await learningApi.importLocal(); toast.success(t('importShortResult', { count: result.imported })); await refresh(account); }); }}>{t('importWords')}</button></div>
                : <div className="space-y-2"><div className="flex gap-2"><input aria-label={t('email')} type="email" className="min-w-0 flex-1 rounded border bg-background p-2" placeholder={t('email')} value={email} onChange={(event) => setEmail(event.target.value)} /><input aria-label={t('password')} type="password" className="min-w-0 flex-1 rounded border bg-background p-2" placeholder={t('password')} value={password} onChange={(event) => setPassword(event.target.value)} /></div><div className="flex gap-2"><button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={busy} onClick={() => void signIn(false)}>{t('signIn')}</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void signIn(true)}>{t('registerAndSignIn')}</button></div></div>}
        </section>
        {account && <><nav className="flex gap-2"><button className="rounded border px-4 py-2" aria-current={tab === 'review' ? 'page' : undefined} onClick={() => setTab('review')}>{t('review')}</button><button className="rounded border px-4 py-2" aria-current={tab === 'notebook' ? 'page' : undefined} onClick={() => setTab('notebook')}>{t('notebook')}</button></nav>
            {tab === 'review' ? <section className="space-y-4"><p>{t('reviewStats', { due: due.length, completed: stats?.completedToday ?? 0, rate: Math.round((stats?.recentRememberedRate ?? 0) * 100) })}</p>
                {due.length === 0 && <p className="text-muted-foreground">{t('noDue')}</p>}
                {due.slice(0, 1).map((word) => <ReviewCard key={word.id} word={word} busy={busy}
                    onPlay={openCitation}
                    onRate={(rating) => run(async () => { await learningApi.review(word.id, rating); await refresh(account); })} />)}
            </section> : <section className="space-y-4"><div className="flex gap-2"><input className="flex-1 rounded border bg-background p-2" aria-label={t('newNotebook')} placeholder={t('newNotebook')} value={title} onChange={(event) => setTitle(event.target.value)} /><button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={busy} onClick={() => void run(async () => { const id = await learningApi.createNotebook(title); setTitle(''); await refresh(account); setSelectedBook(id); })}>{t('create')}</button></div>
                <select aria-label={t('selectNotebook')} className="w-full rounded border bg-background p-2" value={selectedBook} onChange={(event) => setSelectedBook(event.target.value)}><option value="">{t('selectNotebook')}</option>{books.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>
                {book && <><div className="rounded-xl border p-4 space-y-2"><h2 className="font-semibold">{t('sources', { count: MAX_NOTEBOOK_SOURCES })}</h2>{book.sources.map((source) => <div key={source.id} className="flex items-center justify-between gap-3"><p>{source.mediaTitle} · {source.available ? t('available') : t('missingMedia')}</p><button type="button" className="rounded border px-2 py-1" aria-label={t('removeSource', { title: source.mediaTitle })} disabled={busy} onClick={() => void run(async () => { await learningApi.removeSource({ notebookId: book.id, sourceId: source.id }); await refresh(account); })}>{t('remove')}</button></div>)}<div className="flex gap-2"><select aria-label={t('selectVideo')} className="flex-1 rounded border bg-background p-2" value={selectedVideo} onChange={(event) => setSelectedVideo(event.target.value)}><option value="">{t('selectExistingVideo')}</option>{history.map((video) => <option value={video.id} key={video.id}>{video.displayFileName || video.fileName}</option>)}</select><button className="rounded border px-3 py-2" disabled={busy || !selectedVideo || book.sources.length >= MAX_NOTEBOOK_SOURCES} onClick={() => void run(async () => { await learningApi.addSource({ notebookId: book.id, videoId: selectedVideo }); await refresh(account); })}>{t('addSource')}</button></div></div>
                    <div className="rounded-xl border p-4 space-y-2"><h2 className="font-semibold">{t('studySources')}</h2><div className="flex gap-2"><input className="flex-1 rounded border bg-background p-2" aria-label={t('askSources')} placeholder={t('askSubtitle')} value={question} onChange={(event) => setQuestion(event.target.value)} /><button className="rounded border px-3 py-2" disabled={busy || !question.trim()} onClick={() => void run(async () => { await learningApi.answer(book.id, question); setQuestion(''); setNotes(await learningApi.notes(book.id)); })}>{t('ask')}</button></div><div className="flex gap-2"><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.summary(book.id); setNotes(await learningApi.notes(book.id)); })}>{t('summary')}</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.createQuiz(book.id); setQuizzes(await learningApi.quizzes(book.id)); })}>{t('createQuiz')}</button></div></div>
                    <div className="rounded-xl border p-4 space-y-2"><h2 className="font-semibold">{t('myNotes')}</h2><textarea className="w-full rounded border bg-background p-2" aria-label={t('noteContent')} value={note} onChange={(event) => setNote(event.target.value)} /><button className="rounded border px-3 py-2" disabled={busy || !note.trim()} onClick={() => void run(async () => { await learningApi.addNote(book.id, note); setNote(''); setNotes(await learningApi.notes(book.id)); })}>{t('saveNote')}</button>{notes.map((item) => <CitedNote key={item.id} note={item} onCitation={openCitation} />)}</div>
                    {quizzes.map((quiz) => <article key={quiz.id} className="rounded-xl border p-4 space-y-3"><h2 className="font-semibold">{t('quiz')} {quiz.answers ? t('quizScore', { correct: quiz.answers.filter((answer, index) => answer === quiz.questions[index].correctIndex).length, total: quiz.questions.length }) : t('quizPending')}</h2>{quiz.questions.map((item, index) => <div key={index}><p>{index + 1}. {item.prompt}</p>{item.options.map((option, optionIndex) => <label className="block" key={optionIndex}><input type="radio" name={`${quiz.id}-${index}`} disabled={!!quiz.answers} checked={(quiz.answers ?? answers[quiz.id])?.[index] === optionIndex} onChange={() => setAnswers((previous) => { const next = [...(previous[quiz.id] ?? [])]; next[index] = optionIndex; return { ...previous, [quiz.id]: next }; })} /> {option}</label>)}{quiz.answers && <><p className="text-sm">{t('correctAnswer', { answer: item.options[item.correctIndex], explanation: item.explanation })}</p><button className="text-sm underline" onClick={() => void openCitation(item.citation)}>{t('viewSource', { title: item.citation.mediaTitle, seconds: item.citation.startSeconds.toFixed(1) })}</button></>}</div>)}{!quiz.answers && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { await learningApi.submitQuiz(quiz.id, answers[quiz.id] ?? []); setQuizzes(await learningApi.quizzes(book.id)); })}>{t('submitQuiz')}</button>}</article>)}
                </>}
            </section>}</>}
    </div>;
}
