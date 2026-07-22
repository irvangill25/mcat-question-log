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
      {page !== PAGE.REVIEW && page !== PAGE.TEST && <header className="top-header">
        <button className="brand" onClick={() => navigate(PAGE.DASHBOARD)}>
          <span className="brand-mark">M</span>
          <span>
            <strong>MCAT Question Log</strong>
            <small>Private • Cloud-synced • {user?.email || 'Signed in'}</small>
          </span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          <NavButton active={page === PAGE.DASHBOARD} onClick={() => navigate(PAGE.DASHBOARD)}>
            Dashboard
          </NavButton>
          <NavButton active={page === PAGE.LOG} onClick={() => navigate(PAGE.LOG)}>
            Question Log
          </NavButton>
          <NavButton active={page === PAGE.EXAMS || page === PAGE.EXAM_BUILDER || page === PAGE.RESULTS} onClick={() => navigate(PAGE.EXAMS)}>
            Full-Length Exams
          </NavButton>
          <NavButton active={page === PAGE.ADD} onClick={startAdd}>
            Add Question
          </NavButton>
          <NavButton
            active={page === PAGE.REVIEW}
            disabled={!activeQuestion}
            onClick={() => navigate(PAGE.REVIEW)}
          >
            Review
          </NavButton>
        </nav>

        <div className="header-actions">
          <button className="header-button" onClick={exportBackup}>
            <Icon>⇩</Icon> Export
          </button>
          <button className="header-button" onClick={() => importInputRef.current?.click()}>
            <Icon>⇧</Icon> Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={importBackup}
            hidden
          />
          <button className="header-button" onClick={signOut} title="Sign out">
            <Icon>↪</Icon> Sign Out
          </button>
        </div>
      </header>}

      {notice && <div className="notice" role="status">{notice}</div>}

      <main className={page === PAGE.REVIEW || page === PAGE.TEST ? 'review-main' : 'page-main'}>
        {page === PAGE.DASHBOARD && (
          <Dashboard
            questions={questions}
            exams={exams}
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

function NavButton({ active, disabled, children, onClick }) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function Dashboard({ questions, exams, onAdd, onOpenLog, onOpenExams, onCreateExam, onReview }) {
  const totals = RESULT_OPTIONS.reduce(
    (accumulator, result) => ({
      ...accumulator,
      [result]: questions.filter((question) => question.result === result).length,
    }),
    {},
  );
  const reviewQueue = questions.filter(
    (question) => question.flagged || question.reviewStatus === 'needs review' || question.result === 'incorrect',
  );
  const reviewed = questions.filter((question) => question.reviewStatus !== 'needs review').length;
  const allAttempts = exams.flatMap((exam) => exam.attempts || []);
  const completedAttempts = allAttempts.filter((attempt) => attempt.status === 'completed');
  const inProgressExams = exams.filter((exam) => exam.activeAttempt?.status === 'in-progress').length;
  const bestScore = completedAttempts.length
    ? Math.max(...completedAttempts.map((attempt) => Number(attempt.score?.percent) || 0))
    : null;
  const correctRate = questions.length ? Math.round((totals.correct / questions.length) * 100) : 0;
  const reviewProgress = questions.length ? Math.round((reviewed / questions.length) * 100) : 0;
  const recent = [...questions]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);
  const priorityReview = [...reviewQueue]
    .sort((a, b) => Number(Boolean(b.flagged)) - Number(Boolean(a.flagged)) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);

  const subjectStats = Object.values(
    questions.reduce((groups, question) => {
      const subject = question.subject?.trim() || 'Uncategorized';
      if (!groups[subject]) groups[subject] = { subject, total: 0, correct: 0, review: 0 };
      groups[subject].total += 1;
      if (question.result === 'correct') groups[subject].correct += 1;
      if (question.flagged || question.reviewStatus === 'needs review' || question.result === 'incorrect') {
        groups[subject].review += 1;
      }
      return groups;
    }, {}),
  )
    .map((item) => ({ ...item, percent: item.total ? Math.round((item.correct / item.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject))
    .slice(0, 6);

  const displayDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date());

  return (
    <section className="dashboard-page professional-dashboard">
      <header className="dashboard-welcome">
        <div>
          <p className="eyebrow">STUDY COMMAND CENTER</p>
          <h1>MCAT Study Dashboard</h1>
          <p>Manage your question bank, review priorities, and full-length practice from one workspace.</p>
        </div>
        <div className="dashboard-date-card">
          <span>Today</span>
          <strong>{displayDate}</strong>
          <small>Cloud data is synced to your private account</small>
        </div>
      </header>

      <div className="dashboard-quick-actions" aria-label="Quick actions">
        <button className="quick-action primary-action" onClick={onAdd}>
          <span className="quick-action-icon">＋</span>
          <span><strong>Add Question</strong><small>Save a passage, question, answer, and explanation</small></span>
          <b>→</b>
        </button>
        <button className="quick-action" onClick={onOpenLog}>
          <span className="quick-action-icon">▤</span>
          <span><strong>Question Bank</strong><small>Search, filter, edit, and review saved questions</small></span>
          <b>→</b>
        </button>
        <button className="quick-action" onClick={exams.length ? onOpenExams : onCreateExam}>
          <span className="quick-action-icon">◫</span>
          <span><strong>{exams.length ? 'Full-Length Exams' : 'Create a Full-Length'}</strong><small>{exams.length ? 'Build, resume, and review exam attempts' : 'Create your first timed practice exam'}</small></span>
          <b>→</b>
        </button>
      </div>

      <div className="dashboard-kpi-grid">
        <DashboardMetric label="Questions saved" value={questions.length} detail={`${reviewed} reviewed`} icon="▦" />
        <DashboardMetric label="Correct records" value={`${correctRate}%`} detail={`${totals.correct || 0} marked correct`} icon="✓" tone="success" />
        <DashboardMetric label="Review queue" value={reviewQueue.length} detail={`${questions.filter((question) => question.flagged).length} flagged`} icon="↻" tone="warning" />
        <DashboardMetric label="Full-lengths" value={exams.length} detail={`${completedAttempts.length} completed attempt${completedAttempts.length === 1 ? '' : 's'}`} icon="◫" tone="info" />
      </div>

      <div className="dashboard-main-grid">
        <section className="panel dashboard-performance-panel">
          <div className="dashboard-panel-heading">
            <div>
              <p className="eyebrow">QUESTION BANK PERFORMANCE</p>
              <h2>Performance by subject</h2>
            </div>
            <button className="text-button" onClick={onOpenLog}>View question bank →</button>
          </div>

          {subjectStats.length === 0 ? (
            <div className="dashboard-inline-empty">Add questions to see subject-level performance.</div>
          ) : (
            <div className="subject-performance-list">
              {subjectStats.map((item) => (
                <div className="subject-performance-row" key={item.subject}>
                  <div className="subject-performance-copy">
                    <strong>{item.subject}</strong>
                    <span>{item.total} question{item.total === 1 ? '' : 's'} • {item.review} to review</span>
                  </div>
                  <div className="subject-performance-track" aria-label={`${item.percent}% correct`}>
                    <span style={{ width: `${item.percent}%` }}></span>
                  </div>
                  <strong className="subject-performance-percent">{item.percent}%</strong>
                </div>
              ))}
            </div>
          )}
          <div className="dashboard-progress-summary">
            <span><strong>{reviewProgress}%</strong> review completion</span>
            <div><i style={{ width: `${reviewProgress}%` }}></i></div>
          </div>
        </section>

        <section className="panel dashboard-exam-command">
          <div className="exam-command-header">
            <div className="exam-command-mark">FL</div>
            <div><p className="eyebrow">TEST CENTER</p><h2>Full-Length Exams</h2></div>
          </div>
          <div className="exam-command-metrics">
            <div><span>Saved exams</span><strong>{exams.length}</strong></div>
            <div><span>In progress</span><strong>{inProgressExams}</strong></div>
            <div><span>Best score</span><strong>{bestScore === null ? '—' : `${bestScore}%`}</strong></div>
          </div>
          <div className="exam-command-list">
            {exams.slice(0, 3).map((exam) => {
              const attemptCount = (exam.attempts || []).length;
              const assigned = (exam.sections || []).reduce((sum, section) => sum + (section.questionIds || []).length, 0);
              return (
                <button key={exam.id} onClick={onOpenExams}>
                  <span><strong>{exam.title || 'Full-Length Exam'}</strong><small>{assigned} questions • {attemptCount} completed attempt{attemptCount === 1 ? '' : 's'}</small></span>
                  <b>{exam.activeAttempt?.status === 'in-progress' ? 'Resume' : 'Open'} →</b>
                </button>
              );
            })}
            {exams.length === 0 && <div className="dashboard-inline-empty compact">No full-length exams created yet.</div>}
          </div>
          <button className="primary-button full-width-button" onClick={exams.length ? onOpenExams : onCreateExam}>
            {exams.length ? 'Open Full-Length Center' : 'Create First Full-Length'}
          </button>
        </section>
      </div>

      <div className="dashboard-lower-grid">
        <section className="panel dashboard-list-panel">
          <div className="dashboard-panel-heading">
            <div><p className="eyebrow">PRIORITY WORK</p><h2>Review queue</h2></div>
            <span className="dashboard-count-pill">{reviewQueue.length}</span>
          </div>
          {priorityReview.length === 0 ? (
            <div className="dashboard-success-empty"><span>✓</span><strong>You are caught up</strong><small>No questions currently need review.</small></div>
          ) : (
            <div className="dashboard-record-list">
              {priorityReview.map((question) => (
                <button key={question.id} onClick={() => onReview(question)}>
                  <span className={`dashboard-record-status ${question.flagged ? 'flagged' : question.result}`}></span>
                  <span className="dashboard-record-number">Q{question.questionNumber || '—'}</span>
                  <span className="dashboard-record-copy"><strong>{question.topic || 'Untitled topic'}</strong><small>{question.subject || 'No subject'} • {question.flagged ? 'Flagged' : question.reviewStatus}</small></span>
                  <span className="dashboard-record-arrow">›</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel dashboard-list-panel">
          <div className="dashboard-panel-heading">
            <div><p className="eyebrow">RECENT ACTIVITY</p><h2>Continue where you left off</h2></div>
            <button className="text-button" onClick={onOpenLog}>View all →</button>
          </div>
          {recent.length === 0 ? (
            <div className="dashboard-inline-empty">Your recently edited questions will appear here.</div>
          ) : (
            <div className="dashboard-record-list">
              {recent.map((question) => (
                <button key={question.id} onClick={() => onReview(question)}>
                  <span className={`dashboard-record-status ${question.result}`}></span>
                  <span className="dashboard-record-number">Q{question.questionNumber || '—'}</span>
                  <span className="dashboard-record-copy"><strong>{question.topic || 'Untitled topic'}</strong><small>{question.subject || 'No subject'} • {question.dateCompleted || 'No date'}</small></span>
                  <ResultBadge result={question.result} />
                  <span className="dashboard-record-arrow">›</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function DashboardMetric({ label, value, detail, icon, tone = '' }) {
  return (
    <article className={`dashboard-metric ${tone}`}>
      <div className="dashboard-metric-icon">{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
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
      if (item.passageGroupId && !seen.has(item.passageGroupId)) {
        seen.set(item.passageGroupId, item);
      }
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

    setSaving(true);
    try {
      await onSave({
        ...question,
        questionNumber: String(question.questionNumber),
        correctAnswer: Number(question.correctAnswer),
        selectedAnswer:
          question.selectedAnswer === '' ? '' : Number(question.selectedAnswer),
        timeSpent: Math.max(0, Number(question.timeSpent) || 0),
      });
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'The question could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="form-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">{initialQuestion.questionText ? 'EDIT RECORD' : 'NEW RECORD'}</p>
          <h1>{initialQuestion.questionText ? 'Edit Question' : 'Add Question'}</h1>
          <p>Capture enough context that future-you can understand the mistake quickly.</p>
        </div>
      </div>

      <form className="question-form" onSubmit={submit}>
        <section className="panel form-section">
          <div className="section-heading">
            <span className="section-number">1</span>
            <div>
              <h2>Question details</h2>
              <p>Basic organization and timing information.</p>
            </div>
          </div>

          <div className="field-grid three-columns">
            <TextField
              label="Question number"
              value={question.questionNumber}
              onChange={(value) => update('questionNumber', value)}
              placeholder="18"
            />
            <TextField
              label="Subject"
              value={question.subject}
              onChange={(value) => update('subject', value)}
              placeholder="Biochemistry"
            />
            <TextField
              label="Topic"
              value={question.topic}
              onChange={(value) => update('topic', value)}
              placeholder="Protein interactions"
            />
            <TextField
              label="Date completed"
              type="date"
              value={question.dateCompleted}
              onChange={(value) => update('dateCompleted', value)}
            />
            <TextField
              label="Time spent (seconds)"
              type="number"
              min="0"
              value={question.timeSpent}
              onChange={(value) => update('timeSpent', value)}
              placeholder="110"
            />
            <SelectField
              label="Result"
              value={question.result}
              onChange={(value) => update('result', value)}
              options={RESULT_OPTIONS}
            />
          </div>
        </section>

        <section className="panel form-section">
          <div className="section-heading">
            <span className="section-number">2</span>
            <div>
              <h2>Shared passage</h2>
              <p>Build the passage from text and image blocks, then reuse it across several questions.</p>
            </div>
          </div>

          {passageOptions.length > 0 && (
            <label className="form-field full-width shared-passage-picker">
              <span className="field-label">Use an existing passage</span>
              <select
                value=""
                onChange={(event) => selectSharedPassage(event.target.value)}
              >
                <option value="">Choose a saved passage…</option>
                {passageOptions.map((item) => (
                  <option key={item.passageGroupId} value={item.passageGroupId}>
                    {item.passageTitle || item.passageGroupId}
                    {item.passageRange ? ` — ${item.passageRange}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="field-grid three-columns">
            <TextField
              label="Passage set ID"
              value={question.passageGroupId}
              onChange={(value) => update('passageGroupId', value)}
              placeholder="protein-passage-01"
            />
            <TextField
              label="Passage heading"
              value={question.passageTitle}
              onChange={(value) => update('passageTitle', value)}
              placeholder="Passage 3"
            />
            <TextField
              label="Question range"
              value={question.passageRange}
              onChange={(value) => update('passageRange', value)}
              placeholder="Questions 18–23"
            />
          </div>

          <div className="shared-passage-note">
            Questions with the same <strong>Passage set ID</strong> automatically display and update the same passage.
          </div>

          <PassageBlockEditor
            blocks={question.passageBlocks}
            onChange={(blocks) => update('passageBlocks', blocks)}
            onError={setImageError}
          />
          {imageError && <small className="error-text">{imageError}</small>}
        </section>

        <section className="panel form-section">
          <div className="section-heading">
            <span className="section-number">3</span>
            <div>
              <h2>Question and answer choices</h2>
              <p>Mark the correct answer and the option you selected.</p>
            </div>
          </div>

          <TextAreaField
            label="Question text"
            value={question.questionText}
            onChange={(value) => update('questionText', value)}
            placeholder="Enter the complete question…"
            rows={4}
            required
          />

          <div className="choice-editor-list">
            {question.choices.map((choice, index) => (
              <div className="choice-editor" key={index}>
                <span className="choice-letter">{String.fromCharCode(65 + index)}</span>
                <input
                  value={choice}
                  onChange={(event) => updateChoice(index, event.target.value)}
                  placeholder={`Answer choice ${String.fromCharCode(65 + index)}`}
                  required
                />
                <label className="choice-radio-label">
                  <input
                    type="radio"
                    name="correct-answer"
                    checked={Number(question.correctAnswer) === index}
                    onChange={() => update('correctAnswer', index)}
                  />
                  Correct
                </label>
                <label className="choice-radio-label">
                  <input
                    type="radio"
                    name="selected-answer"
                    checked={Number(question.selectedAnswer) === index}
                    onChange={() => update('selectedAnswer', index)}
                  />
                  Mine
                </label>
              </div>
            ))}
          </div>

          <button
            className="text-button clear-selection"
            type="button"
            onClick={() => update('selectedAnswer', '')}
          >
            Clear my selected answer
          </button>
        </section>

        <section className="panel form-section">
          <div className="section-heading">
            <span className="section-number">4</span>
            <div>
              <h2>Review notes</h2>
              <p>Use the same structure for every missed or slow question.</p>
            </div>
          </div>

          <TextAreaField
            label="Explanation"
            value={question.explanation}
            onChange={(value) => update('explanation', value)}
            placeholder="Why is the correct option correct, and why are the others wrong?"
            rows={6}
          />

          <div className="explanation-image-field">
            <span className="field-label">Explanation figure (optional)</span>
            {question.explanationImageDataUrl ? (
              <div className="image-preview-card compact-preview">
                <img src={question.explanationImageDataUrl} alt="Explanation preview" />
                <div>
                  <span>{question.explanationImageName || 'Stored explanation figure'}</span>
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() => {
                      setQuestion((current) => ({ ...current, explanationImageDataUrl: '', explanationImageName: '', explanationImageStoragePath: '' }));
                      update('explanationImageName', '');
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="drop-zone compact-drop-zone">
                <strong>Choose an explanation image</strong>
                <span>Useful for diagrams shown above the explanation</span>
                <input type="file" accept="image/*" onChange={handleExplanationImage} hidden />
              </label>
            )}
          </div>

          <div className="field-grid two-columns">
            <TextAreaField
              label="Primary Content"
              value={question.primaryContent}
              onChange={(value) => update('primaryContent', value)}
              placeholder="The core concept being tested…"
              rows={5}
            />
            <TextAreaField
              label="Likely Miss Reason"
              value={question.likelyMissReason}
              onChange={(value) => update('likelyMissReason', value)}
              placeholder="Content gap, equation setup, rushed reading, etc."
              rows={5}
            />
          </div>

          <TextAreaField
            label="Anki"
            value={question.anki}
            onChange={(value) => update('anki', value)}
            placeholder="A concise, copy-paste-ready Anki takeaway…"
            rows={5}
          />

          <div className="field-grid two-columns compact-grid">
            <SelectField
              label="Review status"
              value={question.reviewStatus}
              onChange={(value) => update('reviewStatus', value)}
              options={REVIEW_OPTIONS}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={question.flagged}
                onChange={(event) => update('flagged', event.target.checked)}
              />
              <span>
                <strong>Flag for priority review</strong>
                <small>Show this question in your flagged filter.</small>
              </span>
            </label>
          </div>
        </section>

        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Saving…' : 'Save Question'}
          </button>
        </div>
      </form>
    </section>
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

function PassageBlockEditor({ blocks, onChange, onError }) {
  function addTextBlock() {
    onChange([...blocks, { id: crypto.randomUUID(), type: 'text', text: '' }]);
  }

  function addImageBlock(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError('Choose a PNG, JPG, WEBP, or other image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      onError('Please use an image smaller than 8 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      onChange([
        ...blocks,
        {
          id: crypto.randomUUID(),
          type: 'image',
          dataUrl: reader.result,
          name: file.name,
          caption: '',
        },
      ]);
      onError('');
    };
    reader.readAsDataURL(file);
  }

  function updateBlock(id, patch) {
    onChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function removeBlock(id) {
    onChange(blocks.filter((block) => block.id !== id));
  }

  function moveBlock(index, direction) {
    const destination = index + direction;
    if (destination < 0 || destination >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  }

  return (
    <div className="passage-block-editor">
      <div className="passage-block-toolbar">
        <div>
          <strong>Passage content</strong>
          <span>Add text and figures in the exact order they should appear.</span>
        </div>
        <div>
          <button type="button" className="secondary-button" onClick={addTextBlock}>+ Text</button>
          <label className="secondary-button upload-block-button">
            + Image
            <input type="file" accept="image/*" onChange={addImageBlock} hidden />
          </label>
        </div>
      </div>

      {blocks.length === 0 ? (
        <div className="passage-block-empty">Add a text block or image to begin the passage.</div>
      ) : (
        <div className="passage-block-list">
          {blocks.map((block, index) => (
            <article className="passage-block-card" key={block.id}>
              <div className="block-card-header">
                <span>{block.type === 'image' ? 'IMAGE' : 'TEXT'} BLOCK {index + 1}</span>
                <div>
                  <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0}>↑</button>
                  <button type="button" onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1}>↓</button>
                  <button type="button" className="danger-text" onClick={() => removeBlock(block.id)}>Remove</button>
                </div>
              </div>

              {block.type === 'image' ? (
                <div className="image-block-editor">
                  <img src={block.dataUrl} alt={block.name || 'Passage figure'} />
                  <TextField
                    label="Figure caption (optional)"
                    value={block.caption || ''}
                    onChange={(value) => updateBlock(block.id, { caption: value })}
                    placeholder="Figure 1  Peptide bonds within a protein segment"
                  />
                </div>
              ) : (
                <TextAreaField
                  label="Text"
                  value={block.text || ''}
                  onChange={(value) => updateBlock(block.id, { text: value })}
                  placeholder="Type or paste this part of the passage…"
                  rows={7}
                />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
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
