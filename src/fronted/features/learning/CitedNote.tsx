import type { LearningNote, NotebookCitation } from '@/common/contracts/learning';
import { useTranslation } from 'react-i18next';

/** 笔记及其可跳转字幕来源的展示入参。 */
interface CitedNoteProps {
    note: LearningNote;
    onCitation: (citation: NotebookCitation) => Promise<void>;
}

/** 将正文中的引用编号连接到已保存的真实字幕，兼容没有编号的旧笔记。 */
export default function CitedNote({ note, onCitation }: CitedNoteProps) {
    const { t } = useTranslation('learning');
    const parts = note.content.split(/(\[\d+\])/g);
    const label = note.kind === 'manual' ? t('manualNote') : note.kind === 'summary' ? t('aiSummary') : t('aiAnswer');

    return <article className="border-t py-2 space-y-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="whitespace-pre-wrap">{parts.map((part, index) => {
            const match = /^\[(\d+)\]$/.exec(part);
            const citation = match ? note.citations[Number(match[1]) - 1] : undefined;
            return citation
                ? <button key={index} type="button" className="text-primary underline" title={t('citationTime', { title: citation.mediaTitle, seconds: citation.startSeconds.toFixed(1) })}
                    onClick={() => void onCitation(citation)}>{part}</button>
                : part;
        })}</p>
        {note.citations.length > 0 && <div className="space-y-1 text-sm">
            {note.citations.map((citation, index) => <button key={`${citation.mediaKey}-${citation.sentenceIndex}-${index}`}
                type="button" className="block text-left underline" onClick={() => void onCitation(citation)}>
                [{index + 1}] {t('citationLine', { title: citation.mediaTitle, seconds: citation.startSeconds.toFixed(1), sentence: citation.sentence })}
            </button>)}
        </div>}
    </article>;
}
