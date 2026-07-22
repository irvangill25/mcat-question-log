import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './Auth.jsx';
import {
  AnnotatableText,
  ExamBuilder,
  ExamLibrary,
  ExamResults,
  TestRunner,
  applySelectionFormat,
  createAttempt,
  createEmptyExam,
  normalizeExam,
} from './ExamCenter.jsx';
import {
  deleteQuestion as deleteQuestionFromDb,
  getAllQuestions,
  replaceAllQuestions,
  saveQuestion,
} from './db.js';

const PAGE = {
  DASHBOARD: 'dashboard',
  LOG: 'log',
  ADD: 'add',
  REVIEW: 'review',
  EXAMS: 'exams',
  EXAM_BUILDER: 'exam-builder',
  TEST: 'test',
  RESULTS: 'results',
};

const RESULT_OPTIONS = ['correct', 'incorrect', 'guessed', 'slow'];
const REVIEW_OPTIONS = ['needs review', 'reviewed', 'anki created'];

const emptyQuestion = () => ({
  id: crypto.randomUUID(),
  questionNumber: '',
  subject: '',
  topic: '',
  passageGroupId: '',
  passageTitle: '',
  passageRange: '',
  passageBlocks: [],
  passageText: '',
  questionText: '',
  choices: ['', '', '', ''],
  correctAnswer: 0,
  selectedAnswer: '',
  explanation: '',
  screenshotDataUrl: '',
  screenshotName: '',
  explanationImageDataUrl: '',
  explanationImageName: '',
  result: 'incorrect',
  timeSpent: 0,
  flagged: false,
  primaryContent: '',
  likelyMissReason: '',
  anki: '',
  dateCompleted: new Date().toISOString().slice(0, 10),
  reviewStatus: 'needs review',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const starterQuestion = {
  ...emptyQuestion(),
  id: 'starter-question',
  questionNumber: '1',
  subject: 'Biochemistry',
  topic: 'Protein interactions',
  passageGroupId: 'passage-1',
  passageTitle: 'Passage 1',
  passageRange: 'Questions 1–3',
  passageBlocks: [
    {
      id: 'starter-text-1',
      type: 'text',
      text: 'A folded protein is stabilized by interactions among backbone groups and amino-acid side chains. Charged side chains can attract one another, while polar groups can form hydrogen bonds.',
    },
  ],
  passageText:
    'A folded protein is stabilized by interactions among backbone groups and amino-acid side chains. Charged side chains can attract one another, while polar groups can form hydrogen bonds.',
  questionText:
    'Which interaction is most likely between a protonated lysine side chain and a deprotonated glutamate side chain?',
  choices: [
    'A disulfide bond',
    'A salt bridge',
    'A peptide bond',
    'A hydrophobic interaction',
  ],
  correctAnswer: 1,
  selectedAnswer: 1,
  explanation:
    'The positively charged ammonium group of lysine is electrostatically attracted to the negatively charged carboxylate group of glutamate, forming a salt bridge.',
  result: 'correct',
  timeSpent: 48,
  primaryContent: 'Amino-acid side-chain interactions and tertiary protein structure.',
  likelyMissReason: 'Confusing ionic interactions with covalent bonds.',
  anki: 'A salt bridge is an electrostatic attraction between oppositely charged amino-acid side chains.',
  reviewStatus: 'reviewed',
};

function formatSeconds(totalSeconds) {
  const seconds = Number(totalSeconds) || 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function getPassageBlocks(question) {
  if (Array.isArray(question?.passageBlocks) && question.passageBlocks.length > 0) {
    return question.passageBlocks.map((block) => ({ ...block, id: block.id || crypto.randomUUID() }));
  }

  const blocks = [];
  if (question?.screenshotDataUrl) {
    blocks.push({
      id: crypto.randomUUID(),
      type: 'image',
      dataUrl: question.screenshotDataUrl,
      name: question.screenshotName || 'Passage image',
      caption: '',
    });
  }
  if (question?.passageText?.trim()) {
    blocks.push({ id: crypto.randomUUID(), type: 'text', text: question.passageText });
  }
  return blocks;
}

function normalizeImportedQuestion(question) {
  return {
    ...emptyQuestion(),
    ...question,
    choices: Array.isArray(question.choices)
      ? [...question.choices, '', '', '', ''].slice(0, 4)
      : ['', '', '', ''],
    passageBlocks: getPassageBlocks(question),
    updatedAt: question.updatedAt || new Date().toISOString(),
  };
}

function normalizeQuestionForForm(question) {
  return {
    ...question,
    choices: [...question.choices],
    passageBlocks: getPassageBlocks(question),
  };
}

function Icon({ children }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function SidebarIcon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    bank: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/></>,
    exam: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3.5h6V6H9zM9 11h6M9 15h6"/></>,
    add: <><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/></>,
    review: <><path d="M6 3h12v18l-6-4-6 4z"/></>,
    export: <><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/></>,
    import: <><path d="M12 15V3M7 10l5 5 5-5"/><path d="M5 14v6h14v-6"/></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
  };
  return <svg {...common}>{paths[name] || paths.dashboard}</svg>;
}

function App() {
  const { user, signOut } = useAuth();
  const [page, setPage] = useState(PAGE.DASHBOARD);
  const [questions, setQuestions] = useState([]);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [activeQuestionId, setActiveQuestionId] = useState(null);
  const [editingExam, setEditingExam] = useState(null);
  const [activeExamId, setActiveExamId] = useState(null);
  const [resultContext, setResultContext] = useState(null);
  const [notice, setNotice] = useState('');
  const importInputRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        const stored = await getAllQuestions();
        const storedExams = stored.filter((record) => record.recordType === 'exam').map(normalizeExam);
        const storedQuestions = stored.filter((record) => record.recordType !== 'exam');
        setExams(storedExams);
        if (storedQuestions.length === 0) {
          await saveQuestion(starterQuestion);
          setQuestions([starterQuestion]);
        } else {
          setQuestions(storedQuestions);
        }
      } catch (error) {
        console.error(error);
        setNotice('Could not open your cloud question log. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const sortedQuestions = useMemo(
    () =>
      [...questions].sort((a, b) => {
        const dateDifference = new Date(b.dateCompleted) - new Date(a.dateCompleted);
        if (dateDifference !== 0) return dateDifference;
        return String(a.questionNumber).localeCompare(String(b.questionNumber), undefined, {
          numeric: true,
        });
      }),
    [questions],
  );

  const activeQuestion =
    questions.find((question) => question.id === activeQuestionId) || sortedQuestions[0] || null;
  const activeExam = exams.find((exam) => exam.id === activeExamId) || null;

  function flash(message) {
    setNotice(message);
    window.clearTimeout(flash.timeout);
    flash.timeout = window.setTimeout(() => setNotice(''), 3200);
  }

  function navigate(nextPage) {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSave(question) {
    const preparedQuestion = {
      ...question,
      questionNumber: String(question.questionNumber).trim(),
      passageGroupId: String(question.passageGroupId || '').trim(),
      passageBlocks: getPassageBlocks(question),
      updatedAt: new Date().toISOString(),
    };

    const sharedPassage = {
      passageGroupId: preparedQuestion.passageGroupId,
      passageTitle: preparedQuestion.passageTitle,
      passageRange: preparedQuestion.passageRange,
      passageBlocks: preparedQuestion.passageBlocks,
      passageText: '',
      screenshotDataUrl: '',
      screenshotName: '',
    };

    const linkedUpdates = preparedQuestion.passageGroupId
      ? questions
          .filter(
            (item) =>
              item.id !== preparedQuestion.id &&
              item.passageGroupId === preparedQuestion.passageGroupId,
          )
          .map((item) => ({ ...item, ...sharedPassage, updatedAt: new Date().toISOString() }))
      : [];

    await Promise.all([preparedQuestion, ...linkedUpdates].map((item) => saveQuestion(item)));

    setQuestions((current) => {
      const updateMap = new Map(
        [preparedQuestion, ...linkedUpdates].map((item) => [item.id, item]),
      );
      const updated = current.map((item) => updateMap.get(item.id) || item);
      const exists = current.some((item) => item.id === preparedQuestion.id);
      return exists ? updated : [preparedQuestion, ...updated];
    });
    setEditingQuestion(null);
    setActiveQuestionId(preparedQuestion.id);
    flash(
      preparedQuestion.passageGroupId && linkedUpdates.length
        ? `Question saved and passage synced to ${linkedUpdates.length + 1} linked questions.`
        : 'Question saved to your private cloud log.',
    );
    navigate(PAGE.REVIEW);
  }

  async function handleDelete(question) {
    const confirmed = window.confirm(
      `Delete question ${question.questionNumber || ''}? This cannot be undone unless it is in a backup.`,
    );
    if (!confirmed) return;

    await deleteQuestionFromDb(question.id);
    setQuestions((current) => current.filter((item) => item.id !== question.id));
    if (activeQuestionId === question.id) setActiveQuestionId(null);
    flash('Question deleted.');
  }

  async function handleToggleFlag(question) {
    const updated = { ...question, flagged: !question.flagged, updatedAt: new Date().toISOString() };
    await saveQuestion(updated);
    setQuestions((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function handleUpdateQuestion(question, options = {}) {
    const updated = { ...question, updatedAt: new Date().toISOString() };
    await saveQuestion(updated);
    setQuestions((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    if (!options.silent) flash('Question updated.');
    return updated;
  }

  function startCreateExam() {
    setEditingExam(createEmptyExam());
    navigate(PAGE.EXAM_BUILDER);
  }

  function startEditExam(exam) {
    setEditingExam(normalizeExam(exam));
    navigate(PAGE.EXAM_BUILDER);
  }

  async function handleSaveExam(exam, options = {}) {
    const updated = normalizeExam({ ...exam, updatedAt: new Date().toISOString() });
    await saveQuestion(updated);
    setExams((current) => {
      const exists = current.some((item) => item.id === updated.id);
      return exists
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...current];
    });
    setActiveExamId(updated.id);
    setEditingExam(null);
    if (!options.silent) {
      flash('Full-length exam saved.');
      navigate(PAGE.EXAMS);
    }
    return updated;
  }

  async function handleDeleteExam(exam) {
    if (!window.confirm(`Delete ${exam.title}? This also removes its saved attempts.`)) return;
    await deleteQuestionFromDb(exam.id);
    setExams((current) => current.filter((item) => item.id !== exam.id));
    if (activeExamId === exam.id) setActiveExamId(null);
    flash('Full-length exam deleted.');
  }

  async function startExam(exam) {
    const normalized = normalizeExam(exam);
    const activeAttempt = normalized.activeAttempt?.status === 'in-progress'
      ? normalized.activeAttempt
      : createAttempt(normalized);
    const updated = { ...normalized, activeAttempt, updatedAt: new Date().toISOString() };
    await handleSaveExam(updated, { silent: true });
    setActiveExamId(updated.id);
    setResultContext(null);
    navigate(PAGE.TEST);
  }

  async function finishExam(exam, completedAttempt) {
    const normalized = normalizeExam(exam);
    const updatedExam = {
      ...normalized,
      activeAttempt: null,
      attempts: [...normalized.attempts, completedAttempt],
      updatedAt: new Date().toISOString(),
    };
    await handleSaveExam(updatedExam, { silent: true });

    const testedQuestionIds = new Set(normalized.sections.flatMap((section) => section.questionIds));
    const completedDate = new Date().toISOString().slice(0, 10);
    const questionUpdates = questions
      .filter((question) => testedQuestionIds.has(question.id))
      .map((question) => {
        const answer = completedAttempt.answers?.[question.id];
        const answered = answer !== undefined;
        const correct = answered && Number(answer) === Number(question.correctAnswer);
        return {
          ...question,
          selectedAnswer: answered ? Number(answer) : '',
          result: correct ? 'correct' : 'incorrect',
          dateCompleted: completedDate,
          reviewStatus: correct ? question.reviewStatus : 'needs review',
          updatedAt: new Date().toISOString(),
        };
      });

    await Promise.all(questionUpdates.map((question) => saveQuestion(question)));
    setQuestions((current) => {
      const updates = new Map(questionUpdates.map((question) => [question.id, question]));
      return current.map((question) => updates.get(question.id) || question);
    });
    setResultContext({ exam: updatedExam, attempt: completedAttempt });
    setActiveExamId(updatedExam.id);
    navigate(PAGE.RESULTS);
  }

  function openExamResult(exam, attempt) {
    setResultContext({ exam: normalizeExam(exam), attempt });
    setActiveExamId(exam.id);
    navigate(PAGE.RESULTS);
  }

  function startAdd() {
    setEditingQuestion(emptyQuestion());
    navigate(PAGE.ADD);
  }

  function startEdit(question) {
    setEditingQuestion({ ...question, choices: [...question.choices] });
    navigate(PAGE.ADD);
  }

  function openReview(question) {
    setActiveQuestionId(question.id);
    navigate(PAGE.REVIEW);
  }

  function exportBackup() {
    const payload = {
      app: 'MCAT Question Log',
      version: 2,
      exportedAt: new Date().toISOString(),
      questions,
      exams,
      records: [...questions, ...exams],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mcat-question-log-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    flash('Backup exported.');
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawRecords = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.records)
          ? parsed.records
          : [...(Array.isArray(parsed.questions) ? parsed.questions : []), ...(Array.isArray(parsed.exams) ? parsed.exams : [])];
      if (!Array.isArray(rawRecords)) throw new Error('Invalid backup format');

      const importedExams = rawRecords.filter((record) => record.recordType === 'exam').map(normalizeExam);
      const importedQuestions = rawRecords.filter((record) => record.recordType !== 'exam').map(normalizeImportedQuestion);
      const confirmed = window.confirm(
        `Import ${importedQuestions.length} question(s) and ${importedExams.length} full-length exam(s)? This replaces the records currently stored in the app.`,
      );
      if (!confirmed) return;

      await replaceAllQuestions([...importedQuestions, ...importedExams]);
      setQuestions(importedQuestions);
      setExams(importedExams);
      setActiveQuestionId(importedQuestions[0]?.id || null);
      setActiveExamId(importedExams[0]?.id || null);
      flash('Backup imported successfully.');
      navigate(PAGE.DASHBOARD);
    } catch (error) {
      console.error(error);
      window.alert('That file is not a valid MCAT Question Log backup.');
    }
  }

  if (loading) {
    return <div className="loading-screen">Opening your secure question log…</div>;
  }

  return (
    <div className="app-shell">
      {page !== PAGE.REVIEW && page !== PAGE.TEST && <>
        <aside className="workspace-sidebar">
          <button className="workspace-brand" onClick={() => navigate(PAGE.DASHBOARD)}>
            <span className="workspace-brand-mark"><i></i><i></i></span>
            <span><strong>MCAT</strong><small>Question Log</small></span>
          </button>

          <nav className="workspace-nav" aria-label="Main navigation">
            <NavButton icon="dashboard" active={page === PAGE.DASHBOARD} onClick={() => navigate(PAGE.DASHBOARD)}>Dashboard</NavButton>
            <NavButton icon="bank" active={page === PAGE.LOG} onClick={() => navigate(PAGE.LOG)}>Question Bank</NavButton>
            <NavButton icon="exam" active={page === PAGE.EXAMS || page === PAGE.EXAM_BUILDER || page === PAGE.RESULTS} onClick={() => navigate(PAGE.EXAMS)}>Full-Length Exams</NavButton>
            <NavButton icon="add" active={page === PAGE.ADD} onClick={startAdd}>Add Question</NavButton>
            <NavButton icon="review" disabled={!activeQuestion} onClick={() => activeQuestion && openReview(activeQuestion)}>
              Review Question
              {questions.filter((question) => question.flagged || question.reviewStatus === 'needs review' || question.result === 'incorrect').length > 0 && (
                <span className="workspace-nav-badge">{questions.filter((question) => question.flagged || question.reviewStatus === 'needs review' || question.result === 'incorrect').length}</span>
              )}
            </NavButton>
          </nav>

          <div className="workspace-sidebar-spacer"></div>
          <div className="workspace-sync-card">
            <span className="workspace-sync-dot"></span>
            <div><strong>Cloud synced</strong><small>{questions.length} question{questions.length === 1 ? '' : 's'} protected</small></div>
          </div>
          <div className="workspace-sidebar-actions">
            <button onClick={exportBackup}><SidebarIcon name="export"/><span>Export backup</span></button>
            <button onClick={() => importInputRef.current?.click()}><SidebarIcon name="import"/><span>Import backup</span></button>
            <input ref={importInputRef} type="file" accept="application/json,.json" onChange={importBackup} hidden />
            <button onClick={signOut}><SidebarIcon name="logout"/><span>Sign out</span></button>
          </div>
        </aside>

        <header className="workspace-topbar">
          <button className="workspace-search" onClick={() => navigate(PAGE.LOG)}>
            <SidebarIcon name="search"/>
            <span>Search questions, subjects, topics…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="workspace-topbar-right">
            <div className="workspace-date"><SidebarIcon name="calendar"/><span>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}</span></div>
            <div className="workspace-user"><span className="workspace-avatar">{(user?.email || 'U').slice(0, 1).toUpperCase()}</span><span><strong>{user?.email?.split('@')[0] || 'Student'}</strong><small>Private workspace</small></span></div>
          </div>
        </header>
      </>}

      {notice && <div className="notice" role="status">{notice}</div>}

      <main className={page === PAGE.REVIEW || page === PAGE.TEST ? 'review-main' : 'page-main workspace-page-main'}>
        {page === PAGE.DASHBOARD && (
          <Dashboard
            questions={questions}
            exams={exams}
            user={user}
            onAdd={startAdd}
            onOpenLog={() => navigate(PAGE.LOG)}
            onOpenExams={() => navigate(PAGE.EXAMS)}
            onCreateExam={startCreateExam}
            onReview={openReview}
          />
        )}

        {page === PAGE.LOG && (
          <QuestionLog
            questions={questions}
            onAdd={startAdd}
            onReview={openReview}
            onEdit={startEdit}
            onDelete={handleDelete}
            onToggleFlag={handleToggleFlag}
          />
        )}

        {page === PAGE.ADD && (
          <QuestionForm
            initialQuestion={editingQuestion || emptyQuestion()}
            questions={questions}
            onSave={handleSave}
            onCancel={() => navigate(PAGE.LOG)}
          />
        )}

        {page === PAGE.REVIEW && (
          <ReviewPage
            questions={sortedQuestions}
            activeQuestion={activeQuestion}
            onSelectQuestion={setActiveQuestionId}
            onEdit={startEdit}
            onDelete={handleDelete}
            onToggleFlag={handleToggleFlag}
            onUpdateQuestion={handleUpdateQuestion}
            onOpenLog={() => navigate(PAGE.LOG)}
          />
        )}

        {page === PAGE.EXAMS && (
          <ExamLibrary
            exams={exams}
            questions={questions}
            onCreate={startCreateExam}
            onEdit={startEditExam}
            onDelete={handleDeleteExam}
            onStart={startExam}
            onOpenResult={openExamResult}
          />
        )}

        {page === PAGE.EXAM_BUILDER && (
          <ExamBuilder
            initialExam={editingExam || createEmptyExam()}
            questions={questions}
            onSave={handleSaveExam}
            onCancel={() => navigate(PAGE.EXAMS)}
          />
        )}

        {page === PAGE.TEST && activeExam && (
          <TestRunner
            exam={activeExam}
            questions={questions}
            onSaveExam={handleSaveExam}
            onFinish={finishExam}
            onExit={() => navigate(PAGE.EXAMS)}
          />
        )}

        {page === PAGE.RESULTS && resultContext && (
          <ExamResults
            exam={resultContext.exam}
            attempt={resultContext.attempt}
            questions={questions}
            onBack={() => navigate(PAGE.EXAMS)}
            onRetake={() => startExam(resultContext.exam)}
            onReviewQuestion={openReview}
          />
        )}
      </main>
    </div>
  );
}

function NavButton({ active, disabled, children, onClick, icon = 'dashboard' }) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick}>
      <SidebarIcon name={icon}/>
      <span className="nav-button-label">{children}</span>
    </button>
  );
}

function Dashboard({ questions, exams, user, onAdd, onOpenLog, onOpenExams, onCreateExam, onReview }) {
  const reviewQueue = questions.filter(
    (question) => question.flagged || question.reviewStatus === 'needs review' || question.result === 'incorrect',
  );
  const scoredQuestions = questions.filter((question) => question.result === 'correct' || question.result === 'incorrect');
  const correctQuestions = scoredQuestions.filter((question) => question.result === 'correct').length;
  const accuracy = scoredQuestions.length ? Math.round((correctQuestions / scoredQuestions.length) * 100) : 0;
  const reviewedCount = questions.filter((question) => question.reviewStatus !== 'needs review').length;
  const activeExams = exams.filter((exam) => exam.activeAttempt?.status === 'in-progress');
  const completedAttempts = exams.flatMap((exam) => exam.attempts || []).filter((attempt) => attempt.status === 'completed');
  const priorityReview = [...reviewQueue]
    .sort((a, b) => Number(Boolean(b.flagged)) - Number(Boolean(a.flagged)) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 5);
  const recent = [...questions]
    .sort((a, b) => new Date(b.updatedAt || b.dateCompleted || 0) - new Date(a.updatedAt || a.dateCompleted || 0))
    .slice(0, 4);
  const nextQuestion = priorityReview[0] || questions[0] || null;
  const nextExam = activeExams[0] || exams[0] || null;
  const clearPercent = questions.length ? Math.round(((questions.length - reviewQueue.length) / questions.length) * 100) : 100;

  const rawName = user?.email?.split('@')[0] || 'Student';
  const displayName = rawName
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const timeAgo = (value) => {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  };

  const subjectCode = (subject = '') => {
    const normalized = subject.toLowerCase();
    if (normalized.includes('bio')) return 'B/B';
    if (normalized.includes('chem') || normalized.includes('physics')) return 'C/P';
    if (normalized.includes('psych') || normalized.includes('soc')) return 'P/S';
    if (normalized.includes('cars')) return 'CARS';
    return (subject || 'Q').slice(0, 4).toUpperCase();
  };

  const latestAttemptFor = (exam) => [...(exam.attempts || [])]
    .sort((a, b) => new Date(b.completedAt || b.startedAt || 0) - new Date(a.completedAt || a.startedAt || 0))[0];

  return (
    <section className="lux-dashboard">
      <header className="lux-welcome">
        <div>
          <div className="lux-live-label"><span></span> PRIVATE STUDY OS</div>
          <h1>{greeting}, {displayName}.</h1>
          <p>Your work, distilled to the next meaningful move.</p>
        </div>
        <div className="lux-welcome-actions">
          <button className="lux-button quiet" onClick={onAdd}><span>＋</span> New question</button>
          <button className="lux-button primary" onClick={() => nextQuestion ? onReview(nextQuestion) : onAdd()}>
            <span className="lux-play">▶</span>{nextQuestion ? 'Start focus' : 'Create first question'}
          </button>
        </div>
      </header>

      <section className="lux-stage">
        <article className="lux-focus-hero">
          <div className="lux-orb lux-orb-one" aria-hidden="true"></div>
          <div className="lux-orb lux-orb-two" aria-hidden="true"></div>
          <div className="lux-focus-copy">
            <span className="lux-overline">NEXT UP</span>
            <h2>{nextQuestion ? (nextQuestion.topic || `Question ${nextQuestion.questionNumber || ''}`) : 'Build a question bank that thinks with you.'}</h2>
            <p>
              {nextQuestion
                ? `${nextQuestion.subject || 'Uncategorized'}${nextQuestion.flagged ? ' · Flagged for priority review' : ' · Ready for focused review'}`
                : 'Capture passages, figures, answer logic, and the reason behind every miss.'}
            </p>
            <div className="lux-focus-actions">
              <button onClick={() => nextQuestion ? onReview(nextQuestion) : onAdd()}>
                {nextQuestion ? 'Open focused review' : 'Add your first question'} <span>→</span>
              </button>
              <button className="text" onClick={onOpenLog}>Browse question bank</button>
            </div>
          </div>
          <div className="lux-focus-gauge">
            <div className="lux-gauge-ring" style={{ '--lux-progress': `${clearPercent * 3.6}deg` }}>
              <div><strong>{clearPercent}%</strong><span>clear</span></div>
            </div>
            <p>{reviewQueue.length ? `${reviewQueue.length} item${reviewQueue.length === 1 ? '' : 's'} need attention` : 'Review queue complete'}</p>
          </div>
          <div className="lux-focus-footer"><span><i></i> Cloud protected</span><span>{questions.length} saved question{questions.length === 1 ? '' : 's'}</span></div>
        </article>

        <article className="lux-insight-panel">
          <div className="lux-panel-heading"><span className="lux-overline">AT A GLANCE</span><span className="lux-date-pill">Today</span></div>
          <div className="lux-insight-value"><strong>{scoredQuestions.length ? `${accuracy}%` : '—'}</strong><span>recorded accuracy</span></div>
          <div className="lux-insight-divider"></div>
          <div className="lux-insight-grid">
            <LuxStat label="Reviewed" value={reviewedCount} detail={`of ${questions.length}`} />
            <LuxStat label="Queue" value={reviewQueue.length} detail="to revisit" alert={reviewQueue.length > 0} />
            <LuxStat label="Full-lengths" value={exams.length} detail={`${completedAttempts.length} complete`} />
            <LuxStat label="In progress" value={activeExams.length} detail="active sessions" />
          </div>
          <button className="lux-insight-action" onClick={nextExam ? onOpenExams : onCreateExam}>
            <span>{activeExams.length ? 'Resume simulation' : 'Create a full-length'}</span><b>↗</b>
          </button>
        </article>
      </section>

      <section className="lux-workspace-grid">
        <article className="lux-card lux-review-card">
          <header className="lux-card-heading">
            <div><span className="lux-overline">FOCUS QUEUE</span><h2>Needs your attention</h2></div>
            <button onClick={onOpenLog}>View all</button>
          </header>
          {priorityReview.length ? (
            <div className="lux-review-list">
              {priorityReview.map((question, index) => (
                <button key={question.id} onClick={() => onReview(question)}>
                  <span className="lux-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="lux-subject">{subjectCode(question.subject)}</span>
                  <span className="lux-row-copy"><strong>{question.topic || `Question ${question.questionNumber || ''}`}</strong><small>{question.subject || 'Uncategorized'}{question.questionNumber ? ` · Q${question.questionNumber}` : ''}</small></span>
                  <span className={`lux-state ${question.flagged ? 'flagged' : question.result || ''}`}>{question.flagged ? 'Flagged' : question.result === 'incorrect' ? 'Incorrect' : 'Review'}</span>
                  <span className="lux-arrow">→</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="lux-empty"><span>✓</span><div><strong>Beautifully clear.</strong><small>Nothing is waiting in your review queue.</small></div></div>
          )}
          <button className="lux-card-footer" onClick={onOpenLog}>Open question bank <span>→</span></button>
        </article>

        <article className="lux-card lux-exams-card">
          <header className="lux-card-heading">
            <div><span className="lux-overline">SIMULATION</span><h2>Full-length library</h2></div>
            <button onClick={onOpenExams}>Manage</button>
          </header>
          {exams.length ? (
            <div className="lux-exam-shelf">
              {exams.slice(0, 3).map((exam, index) => {
                const latestAttempt = latestAttemptFor(exam);
                const inProgress = exam.activeAttempt?.status === 'in-progress';
                const assigned = (exam.sections || []).reduce((sum, section) => sum + (section.questionIds || []).length, 0);
                return (
                  <button key={exam.id} className={inProgress ? 'active' : ''} onClick={onOpenExams}>
                    <span className="lux-exam-art"><i>FL</i><b>{index + 1}</b></span>
                    <span className="lux-exam-copy"><strong>{exam.title || `Full-Length ${index + 1}`}</strong><small>{inProgress ? 'Session in progress' : `${assigned} assigned questions`}</small></span>
                    <span className="lux-exam-score"><strong>{inProgress ? 'Resume' : latestAttempt?.score?.percent != null ? `${latestAttempt.score.percent}%` : 'Ready'}</strong><small>{latestAttempt?.status === 'completed' ? 'Latest score' : inProgress ? 'Continue' : 'Not started'}</small></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="lux-empty lux-exam-empty"><span>FL</span><div><strong>Your simulation lab is ready.</strong><small>Build timed sections from questions you have saved.</small></div></div>
          )}
          <button className="lux-card-footer" onClick={exams.length ? onOpenExams : onCreateExam}>{exams.length ? 'Open full-lengths' : 'Create first full-length'} <span>→</span></button>
        </article>
      </section>

      <section className="lux-activity-bar">
        <div><span className="lux-activity-pulse"></span><p><strong>Recent work</strong><small>Latest updates across your question bank</small></p></div>
        <div className="lux-activity-items">
          {recent.length ? recent.map((question) => (
            <button key={question.id} onClick={() => onReview(question)}>
              <span className={`lux-activity-dot ${question.result || ''}`}></span>
              <span><strong>{question.topic || `Question ${question.questionNumber || ''}`}</strong><small>{timeAgo(question.updatedAt || question.dateCompleted)}</small></span>
            </button>
          )) : <span className="lux-muted">Your latest activity will appear here.</span>}
        </div>
        <button className="lux-open-log" onClick={onOpenLog}>Open log →</button>
      </section>
    </section>
  );
}

function LuxStat({ label, value, detail, alert = false }) {
  return (
    <div className={`lux-stat ${alert ? 'alert' : ''}`}>
      <span>{label}</span><strong>{value}</strong><small>{detail}</small>
    </div>
  );
}

function QuestionLog({ questions, onAdd, onReview, onEdit, onDelete, onToggleFlag }) {
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('all');
  const [topic, setTopic] = useState('all');
  const [result, setResult] = useState('all');
  const [flagged, setFlagged] = useState('all');
  const [sort, setSort] = useState('newest');

  const subjects = [...new Set(questions.map((question) => question.subject).filter(Boolean))].sort();
  const topics = [...new Set(questions.map((question) => question.topic).filter(Boolean))].sort();

  const filteredQuestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = questions.filter((question) => {
      const haystack = [
        question.questionNumber,
        question.subject,
        question.topic,
        question.questionText,
        question.primaryContent,
        question.likelyMissReason,
      ]
        .join(' ')
        .toLowerCase();

      return (
        (!query || haystack.includes(query)) &&
        (subject === 'all' || question.subject === subject) &&
        (topic === 'all' || question.topic === topic) &&
        (result === 'all' || question.result === result) &&
        (flagged === 'all' || (flagged === 'yes' ? question.flagged : !question.flagged))
      );
    });

    return filtered.sort((a, b) => {
      if (sort === 'oldest') return new Date(a.dateCompleted) - new Date(b.dateCompleted);
      if (sort === 'question') {
        return String(a.questionNumber).localeCompare(String(b.questionNumber), undefined, { numeric: true });
      }
      if (sort === 'subject') return String(a.subject).localeCompare(String(b.subject));
      return new Date(b.dateCompleted) - new Date(a.dateCompleted);
    });
  }, [questions, search, subject, topic, result, flagged, sort]);

  function clearFilters() {
    setSearch('');
    setSubject('all');
    setTopic('all');
    setResult('all');
    setFlagged('all');
    setSort('newest');
  }

  return (
    <section className="log-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">QUESTION DATABASE</p>
          <h1>Question Log</h1>
          <p>{filteredQuestions.length} of {questions.length} questions shown</p>
        </div>
        <button className="primary-button" onClick={onAdd}>+ Add Question</button>
      </div>

      <section className="panel filters-panel">
        <label className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search question, subject, topic, or miss reason…"
          />
        </label>

        <div className="filter-grid">
          <FilterSelect label="Subject" value={subject} onChange={setSubject} options={subjects} />
          <FilterSelect label="Topic" value={topic} onChange={setTopic} options={topics} />
          <FilterSelect label="Result" value={result} onChange={setResult} options={RESULT_OPTIONS} />
          <FilterSelect
            label="Flagged"
            value={flagged}
            onChange={setFlagged}
            options={[{ value: 'yes', label: 'Flagged only' }, { value: 'no', label: 'Not flagged' }]}
          />
          <FilterSelect
            label="Sort"
            value={sort}
            onChange={setSort}
            includeAll={false}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'question', label: 'Question number' },
              { value: 'subject', label: 'Subject A–Z' },
            ]}
          />
          <button className="clear-button" onClick={clearFilters}>Clear filters</button>
        </div>
      </section>

      <section className="panel table-panel">
        {filteredQuestions.length === 0 ? (
          <EmptyState onAdd={onAdd} filtered />
        ) : (
          <div className="table-scroll">
            <table className="question-table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Subject / Topic</th>
                  <th>Result</th>
                  <th>Time</th>
                  <th>Date</th>
                  <th>Review</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredQuestions.map((question) => (
                  <tr key={question.id} onDoubleClick={() => onReview(question)}>
                    <td>
                      <button className="question-link" onClick={() => onReview(question)}>
                        <span className="question-number">Q{question.questionNumber || '—'}</span>
                        <span>{question.questionText || 'Untitled question'}</span>
                      </button>
                    </td>
                    <td>
                      <strong>{question.subject || '—'}</strong>
                      <small>{question.topic || 'No topic'}</small>
                    </td>
                    <td><ResultBadge result={question.result} /></td>
                    <td>{formatSeconds(question.timeSpent)}</td>
                    <td>{question.dateCompleted || '—'}</td>
                    <td><span className="review-chip">{question.reviewStatus}</span></td>
                    <td>
                      <div className="row-actions">
                        <button
                          className={`icon-button ${question.flagged ? 'flagged' : ''}`}
                          onClick={() => onToggleFlag(question)}
                          title={question.flagged ? 'Remove flag' : 'Flag question'}
                        >
                          ⚑
                        </button>
                        <button className="icon-button" onClick={() => onEdit(question)} title="Edit">✎</button>
                        <button className="icon-button danger" onClick={() => onDelete(question)} title="Delete">⌫</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function FilterSelect({ label, value, onChange, options, includeAll = true }) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {includeAll && <option value="all">All</option>}
        {options.map((option) => {
          const valueOption = typeof option === 'string' ? option : option.value;
          const labelOption = typeof option === 'string' ? option : option.label;
          return <option key={valueOption} value={valueOption}>{labelOption}</option>;
        })}
      </select>
    </label>
  );
}

function QuestionForm({ initialQuestion, questions, onSave, onCancel }) {
  const [question, setQuestion] = useState(() => normalizeQuestionForForm(initialQuestion));
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    setQuestion(normalizeQuestionForForm(initialQuestion));
  }, [initialQuestion]);

  function update(field, value) {
    setQuestion((current) => ({ ...current, [field]: value }));
  }

  function updateChoice(index, value) {
    setQuestion((current) => ({
      ...current,
      choices: current.choices.map((choice, choiceIndex) => (choiceIndex === index ? value : choice)),
    }));
  }

  const passageOptions = useMemo(() => {
    const seen = new Map();
    questions.forEach((item) => {
      if (item.passageGroupId && !seen.has(item.passageGroupId)) seen.set(item.passageGroupId, item);
    });
    return [...seen.values()];
  }, [questions]);

  function selectSharedPassage(groupId) {
    if (!groupId) return;
    const source = questions.find((item) => item.passageGroupId === groupId);
    if (!source) return;
    setQuestion((current) => ({
      ...current,
      passageGroupId: source.passageGroupId,
      passageTitle: source.passageTitle,
      passageRange: source.passageRange,
      passageBlocks: getPassageBlocks(source),
    }));
  }

  function startFreshPassage() {
    const hasContent = (question.passageBlocks || []).some((block) => block.type === 'image' || block.text?.trim());
    if (hasContent && !window.confirm('Start a fresh passage? The passage currently shown in this form will be cleared.')) return;
    setQuestion((current) => ({
      ...current,
      passageGroupId: '',
      passageTitle: '',
      passageRange: '',
      passageBlocks: [{ id: crypto.randomUUID(), type: 'text', text: '' }],
    }));
  }

  function handleExplanationImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError('Choose a PNG, JPG, WEBP, or other image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setImageError('Please use an image smaller than 8 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setQuestion((current) => ({
        ...current,
        explanationImageDataUrl: reader.result,
        explanationImageName: file.name,
        explanationImageStoragePath: '',
      }));
      setImageError('');
    };
    reader.readAsDataURL(file);
  }

  async function submit(event) {
    event.preventDefault();
    if (!question.questionText.trim()) {
      window.alert('Add the question text before saving.');
      return;
    }
    if (question.choices.some((choice) => !choice.trim())) {
      window.alert('Please complete all four answer choices.');
      return;
    }

    const passageBlocks = (question.passageBlocks || []).filter(
      (block) => block.type === 'image' || String(block.text || '').trim(),
    );
    const hasPassage = passageBlocks.length > 0;
    const passageGroupId = question.passageGroupId || (hasPassage ? `passage-${crypto.randomUUID()}` : '');

    setSaving(true);
    try {
      await onSave({
        ...question,
        passageGroupId,
        passageBlocks,
        passageText: '',
        questionNumber: String(question.questionNumber),
        correctAnswer: Number(question.correctAnswer),
        selectedAnswer: question.selectedAnswer === '' ? '' : Number(question.selectedAnswer),
        timeSpent: Math.max(0, Number(question.timeSpent) || 0),
      });
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'The question could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const isEditing = Boolean(initialQuestion.questionText);
  const linkedCount = question.passageGroupId
    ? questions.filter((item) => item.passageGroupId === question.passageGroupId).length
    : 0;

  return (
    <form className="authoring-page" onSubmit={submit}>
      <header className="authoring-header">
        <div className="authoring-title">
          <span className="authoring-status-dot"></span>
          <div><span>{isEditing ? 'EDITING QUESTION' : 'QUESTION STUDIO'}</span><h1>{isEditing ? `Question ${question.questionNumber || ''}` : 'Create a question'}</h1><p>Author it in the same layout you will use to review and test.</p></div>
        </div>
        <div className="authoring-header-actions">
          <button type="button" className="authoring-cancel" onClick={onCancel}>Cancel</button>
          <button type="submit" className="authoring-save" disabled={saving}>{saving ? 'Saving…' : 'Save question'} <span>⌘↵</span></button>
        </div>
      </header>

      <section className="authoring-meta-strip">
        <TextField label="Question" value={question.questionNumber} onChange={(value) => update('questionNumber', value)} placeholder="18" />
        <TextField label="Subject" value={question.subject} onChange={(value) => update('subject', value)} placeholder="Biochemistry" />
        <TextField label="Topic" value={question.topic} onChange={(value) => update('topic', value)} placeholder="Protein interactions" />
        <TextField label="Date" type="date" value={question.dateCompleted} onChange={(value) => update('dateCompleted', value)} />
        <TextField label="Seconds" type="number" min="0" value={question.timeSpent} onChange={(value) => update('timeSpent', value)} placeholder="110" />
        <SelectField label="Result" value={question.result} onChange={(value) => update('result', value)} options={RESULT_OPTIONS} />
      </section>

      <section className="authoring-exam-shell">
        <div className="authoring-exam-topbar">
          <div><span className="authoring-brand-dot"></span><strong>Question Builder</strong><small>Live exam layout</small></div>
          <div className="authoring-passage-source">
            <span>{question.passageGroupId ? `${linkedCount || 1} linked question${linkedCount === 1 ? '' : 's'}` : 'New passage'}</span>
            {passageOptions.length > 0 && (
              <select value="" onChange={(event) => selectSharedPassage(event.target.value)} aria-label="Use an existing passage">
                <option value="">Use saved passage…</option>
                {passageOptions.map((item) => (
                  <option key={item.passageGroupId} value={item.passageGroupId}>
                    {item.passageTitle || 'Untitled passage'}{item.passageRange ? ` — ${item.passageRange}` : ''}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={startFreshPassage}>Fresh passage</button>
          </div>
        </div>

        <div className="authoring-exam-body">
          <section className="authoring-passage-pane">
            <div className="authoring-pane-label"><span>PASSAGE</span><small>Text and figures</small></div>
            <div className="authoring-passage-heading">
              <input value={question.passageTitle} onChange={(event) => update('passageTitle', event.target.value)} placeholder="Passage 3" aria-label="Passage heading" />
              <input value={question.passageRange} onChange={(event) => update('passageRange', event.target.value)} placeholder="Questions 18–23" aria-label="Question range" />
            </div>
            <PassageComposer
              blocks={question.passageBlocks}
              onChange={(blocks) => update('passageBlocks', blocks)}
              onError={setImageError}
            />
          </section>

          <section className="authoring-question-pane">
            <div className="authoring-pane-label"><span>QUESTION {question.questionNumber || '—'}</span><small>Choose the correct and selected response</small></div>
            <textarea
              className="authoring-question-text"
              value={question.questionText}
              onChange={(event) => update('questionText', event.target.value)}
              placeholder="Write the complete question stem here…"
              rows={5}
              required
            />

            <div className="authoring-choice-list">
              {question.choices.map((choice, index) => (
                <div className={`authoring-choice ${Number(question.correctAnswer) === index ? 'correct' : ''} ${Number(question.selectedAnswer) === index ? 'selected' : ''}`} key={index}>
                  <span className="authoring-choice-letter">{String.fromCharCode(65 + index)}</span>
                  <input value={choice} onChange={(event) => updateChoice(index, event.target.value)} placeholder={`Answer choice ${String.fromCharCode(65 + index)}`} required />
                  <div className="authoring-choice-tags">
                    <label title="Mark as correct answer"><input type="radio" name="correct-answer" checked={Number(question.correctAnswer) === index} onChange={() => update('correctAnswer', index)} /><span>Correct</span></label>
                    <label title="Mark as your selected answer"><input type="radio" name="selected-answer" checked={Number(question.selectedAnswer) === index} onChange={() => update('selectedAnswer', index)} /><span>Mine</span></label>
                  </div>
                </div>
              ))}
            </div>

            <button className="authoring-clear-answer" type="button" onClick={() => update('selectedAnswer', '')}>Clear my selected answer</button>

            <div className="authoring-question-status">
              <SelectField label="Review status" value={question.reviewStatus} onChange={(value) => update('reviewStatus', value)} options={REVIEW_OPTIONS} />
              <label className="authoring-flag"><input type="checkbox" checked={question.flagged} onChange={(event) => update('flagged', event.target.checked)} /><span>⚑</span><div><strong>Priority review</strong><small>Surface this on the dashboard</small></div></label>
            </div>
          </section>
        </div>
      </section>

      {imageError && <div className="authoring-error">{imageError}</div>}

      <section className="authoring-review-shell">
        <header><div><span>REVIEW BRIEF</span><h2>Turn the question into a durable lesson.</h2></div><p>Keep the reasoning structured so review stays fast.</p></header>
        <div className="authoring-review-grid">
          <div className="authoring-explanation-column">
            <TextAreaField label="Explanation" value={question.explanation} onChange={(value) => update('explanation', value)} placeholder="Why is the correct option correct, and why are the others wrong?" rows={8} />
            <div className="authoring-explanation-image">
              <span className="field-label">Explanation figure</span>
              {question.explanationImageDataUrl ? (
                <div className="authoring-image-preview"><img src={question.explanationImageDataUrl} alt="Explanation preview" /><div><span>{question.explanationImageName || 'Explanation figure'}</span><button type="button" onClick={() => setQuestion((current) => ({ ...current, explanationImageDataUrl: '', explanationImageName: '', explanationImageStoragePath: '' }))}>Remove</button></div></div>
              ) : (
                <label><span>＋</span><strong>Add explanation image</strong><small>PNG, JPG, WEBP · up to 8 MB</small><input type="file" accept="image/*" onChange={handleExplanationImage} hidden /></label>
              )}
            </div>
          </div>
          <div className="authoring-learning-column">
            <TextAreaField label="Primary Content" value={question.primaryContent} onChange={(value) => update('primaryContent', value)} placeholder="The core concept being tested…" rows={5} />
            <TextAreaField label="Likely Miss Reason" value={question.likelyMissReason} onChange={(value) => update('likelyMissReason', value)} placeholder="Content gap, rushed reading, equation setup…" rows={5} />
            <TextAreaField label="Anki" value={question.anki} onChange={(value) => update('anki', value)} placeholder="A concise, copy-paste-ready takeaway…" rows={5} />
          </div>
        </div>
      </section>

      <footer className="authoring-footer">
        <p><span></span> Changes are saved securely to your private cloud workspace.</p>
        <div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save question'} <span>→</span></button></div>
      </footer>
    </form>
  );
}

function TextField({ label, value, onChange, ...props }) {
  return (
    <label className="form-field">
      <span className="field-label">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  );
}

function TextAreaField({ label, value, onChange, ...props }) {
  return (
    <label className="form-field full-width">
      <span className="field-label">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="form-field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function PassageComposer({ blocks, onChange, onError }) {
  const fallbackId = useRef(crypto.randomUUID());
  const activeTextIndex = useRef(0);
  const workingBlocks = blocks.length
    ? blocks
    : [{ id: fallbackId.current, type: 'text', text: '' }];

  function updateText(index, text) {
    activeTextIndex.current = index;
    onChange(workingBlocks.map((block, blockIndex) => (blockIndex === index ? { ...block, text } : block)));
  }

  async function fileToImageBlock(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPG, WEBP, or other image file.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Please use images smaller than 8 MB.');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { id: crypto.randomUUID(), type: 'image', dataUrl, name: file.name, caption: '' };
  }

  async function insertImages(fileList, afterIndex = activeTextIndex.current) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    try {
      const imageBlocks = await Promise.all(files.map(fileToImageBlock));
      const insertionIndex = Math.min(Math.max(0, afterIndex + 1), workingBlocks.length);
      const next = [
        ...workingBlocks.slice(0, insertionIndex),
        ...imageBlocks,
        { id: crypto.randomUUID(), type: 'text', text: '' },
        ...workingBlocks.slice(insertionIndex),
      ];
      onChange(next);
      activeTextIndex.current = insertionIndex + imageBlocks.length;
      onError('');
    } catch (error) {
      onError(error.message || 'That image could not be added.');
    }
  }

  function updateImage(index, patch) {
    onChange(workingBlocks.map((block, blockIndex) => (blockIndex === index ? { ...block, ...patch } : block)));
  }

  function removeImage(index) {
    const remaining = workingBlocks.filter((_, blockIndex) => blockIndex !== index);
    const merged = [];
    remaining.forEach((block) => {
      const previous = merged[merged.length - 1];
      if (block.type === 'text' && previous?.type === 'text') {
        previous.text = [previous.text, block.text].filter(Boolean).join('\n\n');
      } else {
        merged.push({ ...block });
      }
    });
    if (!merged.some((block) => block.type === 'text')) merged.push({ id: crypto.randomUUID(), type: 'text', text: '' });
    onChange(merged);
  }

  function moveImage(index, direction) {
    const destination = index + direction;
    if (destination < 0 || destination >= workingBlocks.length) return;
    const next = [...workingBlocks];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  }

  function handlePaste(event, index) {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    insertImages(files, index);
  }

  function handleDrop(event) {
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    insertImages(files);
  }

  return (
    <div className="passage-composer" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <div className="passage-composer-toolbar">
        <div><strong>Write naturally.</strong><span>Paste text, drop images, or place the cursor and insert a figure.</span></div>
        <label className="passage-insert-image">＋ Insert image<input type="file" accept="image/*" multiple onChange={(event) => { insertImages(event.target.files); event.target.value = ''; }} hidden /></label>
      </div>
      <div className="passage-document">
        {workingBlocks.map((block, index) => block.type === 'image' ? (
          <figure className="passage-inline-figure" key={block.id}>
            <img src={block.dataUrl} alt={block.name || block.caption || 'Passage figure'} />
            <div className="passage-figure-tools">
              <button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} title="Move figure up">↑</button>
              <button type="button" onClick={() => moveImage(index, 1)} disabled={index === workingBlocks.length - 1} title="Move figure down">↓</button>
              <button type="button" onClick={() => removeImage(index)} title="Remove figure">Remove</button>
            </div>
            <input value={block.caption || ''} onChange={(event) => updateImage(index, { caption: event.target.value })} placeholder="Add a figure caption (optional)" />
          </figure>
        ) : (
          <AutoGrowPassageText
            key={block.id}
            value={block.text || ''}
            onFocus={() => { activeTextIndex.current = index; }}
            onChange={(value) => updateText(index, value)}
            onPaste={(event) => handlePaste(event, index)}
            placeholder={index === 0 ? 'Type or paste the passage here. Paste a screenshot directly into the passage whenever you need a figure…' : 'Continue writing below the figure…'}
          />
        ))}
      </div>
      <div className="passage-composer-hint"><span>⌘V</span> You can paste a screenshot directly while writing.</div>
    </div>
  );
}

function AutoGrowPassageText({ value, onChange, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = '0px';
    ref.current.style.height = `${Math.max(116, ref.current.scrollHeight)}px`;
  }, [value]);

  return <textarea ref={ref} className="passage-writing-area" value={value} onChange={(event) => onChange(event.target.value)} {...props} />;
}

function PassageBlocks({ blocks }) {
  if (!blocks.length) {
    return <div className="exam-empty-passage">No passage content was saved.</div>;
  }

  return blocks.map((block) => {
    if (block.type === 'image') {
      return (
        <figure className="exam-passage-figure" key={block.id}>
          <img src={block.dataUrl} alt={block.name || block.caption || 'Passage figure'} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    }
    return <div className="exam-passage-text" key={block.id}>{block.text}</div>;
  });
}

function AnnotatablePassageBlocks({ question, blocks }) {
  const annotations = question.reviewAnnotations || {};
  if (!blocks.length) return <div className="exam-empty-passage">No passage content was saved.</div>;

  return blocks.map((block, index) => {
    const blockId = block.id || `block-${index}`;
    if (block.type === 'image') {
      return (
        <figure className="exam-passage-figure" key={blockId}>
          <img src={block.dataUrl} alt={block.name || block.caption || 'Passage figure'} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    }
    return (
      <AnnotatableText
        key={blockId}
        annotationKey={`${question.id}::passage:${blockId}`}
        text={block.text || ''}
        html={annotations[`passage:${blockId}`]}
        className="exam-passage-text"
      />
    );
  });
}


function ReviewPage({
  questions,
  activeQuestion,
  onSelectQuestion,
  onEdit,
  onDelete,
  onToggleFlag,
  onUpdateQuestion,
  onOpenLog,
}) {
  const [showAnswer, setShowAnswer] = useState(true);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [annotationNotice, setAnnotationNotice] = useState('');

  useEffect(() => {
    setSelectedAnswer(activeQuestion?.selectedAnswer ?? '');
    setShowAnswer(true);
  }, [activeQuestion?.id]);

  if (!activeQuestion) {
    return (
      <div className="empty-review">
        <h1>No questions saved yet</h1>
        <p>Add a question before opening the review screen.</p>
        <button className="primary-button" onClick={onOpenLog}>Open Question Log</button>
      </div>
    );
  }

  const currentIndex = questions.findIndex((question) => question.id === activeQuestion.id);
  const previous = questions[currentIndex - 1];
  const next = questions[currentIndex + 1];
  const passageBlocks = getPassageBlocks(activeQuestion);
  const answerIsCorrect =
    activeQuestion.selectedAnswer !== '' &&
    Number(activeQuestion.selectedAnswer) === Number(activeQuestion.correctAnswer);

  function goTo(question) {
    if (!question) return;
    onSelectQuestion(question.id);
  }

  async function applyReviewFormat(kind) {
    const result = applySelectionFormat(kind);
    if (result.error) {
      setAnnotationNotice(result.error);
      window.setTimeout(() => setAnnotationNotice(''), 2500);
      return;
    }
    const [, annotationKey] = result.key.split('::');
    await onUpdateQuestion({
      ...activeQuestion,
      reviewAnnotations: {
        ...(activeQuestion.reviewAnnotations || {}),
        [annotationKey]: result.html,
      },
    }, { silent: true });
    const message = kind === 'highlight'
      ? 'Highlight saved.'
      : kind === 'strike'
        ? 'Strikethrough saved.'
        : 'Formatting removed.';
    setAnnotationNotice(message);
    window.setTimeout(() => setAnnotationNotice(''), 1800);
  }

  async function clearReviewAnnotations() {
    if (!Object.keys(activeQuestion.reviewAnnotations || {}).length) {
      setAnnotationNotice('There are no annotations to clear.');
      window.setTimeout(() => setAnnotationNotice(''), 1800);
      return;
    }
    await onUpdateQuestion({ ...activeQuestion, reviewAnnotations: {} }, { silent: true });
    window.getSelection?.()?.removeAllRanges();
    setAnnotationNotice('All highlights and strikethroughs cleared for this question.');
    window.setTimeout(() => setAnnotationNotice(''), 2200);
  }

  return (
    <section className="exam-page">
      <header className="exam-topbar">
        <div className="exam-title">
          <strong>{activeQuestion.subject || 'MCAT Practice'}</strong>
          <span>{activeQuestion.topic || 'Question Review'}</span>
        </div>
        <div className="exam-identifiers">
          <span>Personal Cloud Review</span>
          <strong>QId: {activeQuestion.id.slice(0, 8)}</strong>
        </div>
        <div className="exam-review-label">
          <strong>REVIEW</strong>
          <span>▤ &nbsp; {currentIndex + 1} of {questions.length}</span>
        </div>
      </header>

      <div className="exam-actionbar">
        <div className="exam-action-left">
          <button type="button" onClick={() => applyReviewFormat('highlight')} title="Highlight selected text"><span className="highlight-square"></span> Highlight</button>
          <button type="button" onClick={() => applyReviewFormat('strike')} title="Cross out selected text">⌁ Strikethrough</button>
          <button type="button" className="annotation-remove-button" onClick={() => applyReviewFormat('remove')} title="Remove highlight or strikethrough from selected text">↶ Remove</button>
          <button type="button" className="annotation-clear-button" onClick={clearReviewAnnotations} title="Clear all highlights and strikethroughs on this question">Clear all</button>
          {annotationNotice && <span className="toolbar-message">{annotationNotice}</span>}
        </div>
        <div className="exam-action-right">
          <button title="Edit question" onClick={() => onEdit(activeQuestion)}>✎</button>
          <button title="Question log" onClick={onOpenLog}>▤</button>
          <button
            className={activeQuestion.flagged ? 'is-flagged' : ''}
            onClick={() => onToggleFlag(activeQuestion)}
          >
            ⚑ {activeQuestion.flagged ? 'Flagged' : 'Flag for Review'}
          </button>
        </div>
      </div>

      <div className="exam-divider-bar"></div>

      <div className="exam-workspace">
        <article className="exam-passage-pane">
          <div className="exam-pane-scroll">
            <h2 className="exam-passage-heading">
              {activeQuestion.passageTitle || 'Passage'}
              {activeQuestion.passageRange && <span> ({activeQuestion.passageRange})</span>}
            </h2>
            <AnnotatablePassageBlocks question={activeQuestion} blocks={passageBlocks} />
          </div>
        </article>

        <article className="exam-question-pane">
          <div className="exam-pane-scroll exam-question-scroll">
            <h2 className="exam-question-number">Question {activeQuestion.questionNumber || currentIndex + 1}</h2>
            <AnnotatableText annotationKey={`${activeQuestion.id}::question`} text={activeQuestion.questionText} html={activeQuestion.reviewAnnotations?.question} className="exam-question-text" />

            <div className="exam-answer-list">
              {activeQuestion.choices.map((choice, index) => {
                const isSelected = selectedAnswer !== '' && Number(selectedAnswer) === index;
                const isCorrect = Number(activeQuestion.correctAnswer) === index;
                const wasMine =
                  activeQuestion.selectedAnswer !== '' && Number(activeQuestion.selectedAnswer) === index;
                const revealClass = showAnswer
                  ? isCorrect
                    ? 'correct-answer'
                    : wasMine
                      ? 'wrong-answer'
                      : ''
                  : '';

                return (
                  <button
                    key={index}
                    className={`exam-answer-choice ${isSelected ? 'selected' : ''} ${revealClass}`}
                    onClick={() => setSelectedAnswer(index)}
                  >
                    <span className="exam-correct-marker">{showAnswer && isCorrect ? '✓' : ''}</span>
                    <span className="exam-radio">{isSelected ? '◉' : '○'}</span>
                    <strong>{String.fromCharCode(65 + index)}.</strong>
                    <span>{choice}</span>
                  </button>
                );
              })}
            </div>

            <button className="exam-reveal-button" onClick={() => setShowAnswer((visible) => !visible)}>
              {showAnswer ? 'Hide answer' : 'Reveal answer'}
            </button>

            {showAnswer && (
              <>
                <section className={`exam-result-strip ${answerIsCorrect ? 'correct' : 'incorrect'}`}>
                  <div>
                    <strong>{answerIsCorrect ? 'Correct' : 'Incorrect'}</strong>
                  </div>
                  <div>
                    <span className="metric-icon">▤</span>
                    <p><strong>{activeQuestion.result}</strong><small>Recorded result</small></p>
                  </div>
                  <div>
                    <span className="metric-icon">◷</span>
                    <p><strong>{formatSeconds(activeQuestion.timeSpent)}</strong><small>Time Spent</small></p>
                  </div>
                </section>

                <div className="exam-explanation-tab">Explanation</div>
                <div className="exam-explanation-rule"></div>

                <section className="exam-explanation">
                  {activeQuestion.explanationImageDataUrl && (
                    <figure className="exam-explanation-figure">
                      <img src={activeQuestion.explanationImageDataUrl} alt={activeQuestion.explanationImageName || 'Explanation figure'} />
                    </figure>
                  )}
                  <div>{activeQuestion.explanation || 'No explanation saved.'}</div>
                </section>

                <div className="exam-study-sections">
                  <ReviewSection title="Primary Content" text={activeQuestion.primaryContent} accent="blue" />
                  <ReviewSection title="Likely Miss Reason" text={activeQuestion.likelyMissReason} accent="amber" />
                  <ReviewSection title="Anki" text={activeQuestion.anki} accent="purple" monospace />
                </div>
              </>
            )}
          </div>
        </article>
      </div>

      <footer className="exam-footer">
        <div className="exam-footer-left">
          <button onClick={onOpenLog}>➜ End</button>
          <button>▦ Periodic Table</button>
        </div>
        <div className="exam-footer-right">
          <button disabled={!previous} onClick={() => goTo(previous)}>← Previous</button>
          <button onClick={onOpenLog}>◌ Navigator</button>
          <button disabled={!next} onClick={() => goTo(next)}>Next →</button>
        </div>
      </footer>
    </section>
  );
}

function ReviewSection({ title, text, accent = '', monospace = false }) {
  return (
    <section className={`review-section ${accent}`}>
      <h2>{title}</h2>
      <div className={monospace ? 'anki-text' : ''}>{text || 'No notes saved.'}</div>
    </section>
  );
}

function ResultBadge({ result }) {
  return <span className={`result-badge ${result}`}>{result || 'unset'}</span>;
}

function EmptyState({ onAdd, filtered = false }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">＋</span>
      <h3>{filtered ? 'No questions match these filters' : 'Your question log is empty'}</h3>
      <p>{filtered ? 'Clear a filter or try another search.' : 'Add your first question to begin building the log.'}</p>
      {!filtered && <button className="primary-button" onClick={onAdd}>Add Question</button>}
    </div>
  );
}

export default App;
