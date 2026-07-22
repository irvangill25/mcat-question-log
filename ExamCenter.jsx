import { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_SECTION_TEMPLATES = [
  { name: 'Chemical and Physical Foundations', shortName: 'Chem/Phys', minutes: 95 },
  { name: 'Critical Analysis and Reasoning Skills', shortName: 'CARS', minutes: 90 },
  { name: 'Biological and Biochemical Foundations', shortName: 'Bio/Biochem', minutes: 95 },
  { name: 'Psychological, Social, and Biological Foundations', shortName: 'Psych/Soc', minutes: 95 },
];

export function createEmptyExam() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    recordType: 'exam',
    title: 'Full-Length Exam',
    source: '',
    testDate: new Date().toISOString().slice(0, 10),
    timed: true,
    notes: '',
    sections: DEFAULT_SECTION_TEMPLATES.map((section) => ({
      id: crypto.randomUUID(),
      ...section,
      questionIds: [],
    })),
    attempts: [],
    activeAttempt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeExam(exam) {
  const fallback = createEmptyExam();
  return {
    ...fallback,
    ...exam,
    recordType: 'exam',
    sections: Array.isArray(exam?.sections) && exam.sections.length
      ? exam.sections.map((section, index) => ({
          id: section.id || crypto.randomUUID(),
          name: section.name || DEFAULT_SECTION_TEMPLATES[index]?.name || `Section ${index + 1}`,
          shortName: section.shortName || section.name || `Section ${index + 1}`,
          minutes: Math.max(1, Number(section.minutes) || 95),
          questionIds: Array.isArray(section.questionIds) ? section.questionIds : [],
        }))
      : fallback.sections,
    attempts: Array.isArray(exam?.attempts) ? exam.attempts : [],
    activeAttempt: exam?.activeAttempt || null,
  };
}

export function createAttempt(exam) {
  const remainingBySection = {};
  exam.sections.forEach((section) => {
    remainingBySection[section.id] = Math.max(1, Number(section.minutes) || 95) * 60;
  });
  return {
    id: crypto.randomUUID(),
    status: 'in-progress',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sectionIndex: 0,
    questionIndexBySection: {},
    answers: {},
    flags: {},
    strikes: {},
    annotations: {},
    remainingBySection,
    elapsedSeconds: 0,
  };
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('\n', '<br>');
}

function sanitizeAnnotationHtml(value = '') {
  if (typeof document === 'undefined') return value;
  const template = document.createElement('template');
  template.innerHTML = String(value);
  const allowed = new Set(['MARK', 'S', 'BR', 'SUP', 'SUB', 'B', 'STRONG', 'I', 'EM']);

  function clean(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) {
          child.replaceWith(document.createTextNode(child.textContent || ''));
          return;
        }
        [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
        clean(child);
      }
    });
  }

  clean(template.content);
  return template.innerHTML;
}

export function applySelectionFormat(kind) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { error: 'Select some text first.' };
  }

  const range = selection.getRangeAt(0);
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer
    : range.endContainer.parentElement;
  const container = startElement?.closest?.('[data-annotation-key]');

  if (!container || !container.contains(endElement)) {
    return { error: 'Keep the selection within one passage or question block.' };
  }

  try {
    const wrapper = document.createElement(kind === 'highlight' ? 'mark' : 's');
    const fragment = range.extractContents();
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);
    container.normalize();
    selection.removeAllRanges();
    return {
      key: container.dataset.annotationKey,
      html: sanitizeAnnotationHtml(container.innerHTML),
    };
  } catch (error) {
    console.error(error);
    return { error: 'That selection could not be formatted. Try selecting a smaller section.' };
  }
}

export function AnnotatableText({ annotationKey, text, html, className = '' }) {
  const safeHtml = sanitizeAnnotationHtml(html || escapeHtml(text || ''));
  return (
    <div
      className={`annotatable ${className}`}
      data-annotation-key={annotationKey}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

function sortedQuestionList(questions) {
  return [...questions].sort((a, b) =>
    String(a.questionNumber || '').localeCompare(String(b.questionNumber || ''), undefined, {
      numeric: true,
    }),
  );
}

function scoreAttempt(exam, attempt, questionMap) {
  const sectionScores = exam.sections.map((section) => {
    const available = section.questionIds.filter((id) => questionMap.has(id));
    const correct = available.filter((id) => {
      const question = questionMap.get(id);
      return attempt.answers[id] !== undefined
        && Number(attempt.answers[id]) === Number(question.correctAnswer);
    }).length;
    return {
      sectionId: section.id,
      name: section.name,
      shortName: section.shortName,
      correct,
      total: available.length,
      percent: available.length ? Math.round((correct / available.length) * 100) : 0,
    };
  });
  const total = sectionScores.reduce((sum, item) => sum + item.total, 0);
  const correct = sectionScores.reduce((sum, item) => sum + item.correct, 0);
  return {
    total,
    correct,
    percent: total ? Math.round((correct / total) * 100) : 0,
    sectionScores,
  };
}

export function ExamLibrary({
  exams,
  questions,
  onCreate,
  onEdit,
  onDelete,
  onStart,
  onOpenResult,
}) {
  const questionMap = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);

  return (
    <section className="exam-library-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">TEST CENTER</p>
          <h1>Full-Length Exams</h1>
          <p>Create exams from your saved questions, take them under timed conditions, and review every attempt.</p>
        </div>
        <button className="primary-button" onClick={onCreate}>+ Create Full-Length</button>
      </div>

      {exams.length === 0 ? (
        <div className="exam-empty-card">
          <div className="exam-empty-icon">▤</div>
          <h2>No full-length exams yet</h2>
          <p>Create one, choose which saved questions belong in each section, and then take it in the exam interface.</p>
          <button className="primary-button" onClick={onCreate}>Create your first exam</button>
        </div>
      ) : (
        <div className="exam-card-grid">
          {[...exams]
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .map((exam) => {
              const normalized = normalizeExam(exam);
              const questionCount = normalized.sections.reduce(
                (total, section) => total + section.questionIds.filter((id) => questionMap.has(id)).length,
                0,
              );
              const lastAttempt = normalized.attempts.at(-1);
              return (
                <article className="full-length-card" key={normalized.id}>
                  <div className="full-length-card-top">
                    <span className="full-length-badge">FULL LENGTH</span>
                    <div className="exam-card-menu">
                      <button onClick={() => onEdit(normalized)} title="Edit exam">✎</button>
                      <button onClick={() => onDelete(normalized)} title="Delete exam">⌫</button>
                    </div>
                  </div>
                  <h2>{normalized.title}</h2>
                  <p>{normalized.source || 'Personal question set'}</p>
                  <div className="exam-card-metrics">
                    <div><strong>{questionCount}</strong><span>Questions</span></div>
                    <div><strong>{normalized.sections.length}</strong><span>Sections</span></div>
                    <div><strong>{normalized.timed ? 'Timed' : 'Untimed'}</strong><span>Mode</span></div>
                  </div>
                  <div className="exam-section-chips">
                    {normalized.sections.map((section) => (
                      <span key={section.id}>
                        {section.shortName}: {section.questionIds.filter((id) => questionMap.has(id)).length}
                      </span>
                    ))}
                  </div>
                  {lastAttempt && (
                    <button className="last-attempt" onClick={() => onOpenResult(normalized, lastAttempt)}>
                      <span>Latest attempt</span>
                      <strong>{lastAttempt.score?.percent ?? 0}%</strong>
                    </button>
                  )}
                  <button
                    className="primary-button full-width-button"
                    disabled={questionCount === 0}
                    onClick={() => onStart(normalized)}
                  >
                    {normalized.activeAttempt?.status === 'in-progress' ? 'Resume Exam' : 'Start Exam'}
                  </button>
                </article>
              );
            })}
        </div>
      )}
    </section>
  );
}

export function ExamBuilder({ initialExam, questions, onSave, onCancel }) {
  const [exam, setExam] = useState(() => normalizeExam(initialExam));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setExam(normalizeExam(initialExam)), [initialExam]);

  const assignment = useMemo(() => {
    const map = {};
    exam.sections.forEach((section) => section.questionIds.forEach((id) => { map[id] = section.id; }));
    return map;
  }, [exam.sections]);

  const filteredQuestions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sortedQuestionList(questions).filter((question) => {
      if (!needle) return true;
      return [question.questionNumber, question.subject, question.topic, question.questionText]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [questions, search]);

  function update(field, value) {
    setExam((current) => ({ ...current, [field]: value }));
  }

  function updateSection(sectionId, patch) {
    setExam((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section),
    }));
  }

  function assignQuestion(questionId, sectionId) {
    setExam((current) => ({
      ...current,
      sections: current.sections.map((section) => ({
        ...section,
        questionIds: section.questionIds.filter((id) => id !== questionId),
      })).map((section) => section.id === sectionId
        ? { ...section, questionIds: [...section.questionIds, questionId] }
        : section),
    }));
  }

  function addSection() {
    setExam((current) => ({
      ...current,
      sections: [...current.sections, {
        id: crypto.randomUUID(),
        name: `Section ${current.sections.length + 1}`,
        shortName: `Section ${current.sections.length + 1}`,
        minutes: 95,
        questionIds: [],
      }],
    }));
  }

  function removeSection(sectionId) {
    if (exam.sections.length === 1) return;
    setExam((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== sectionId),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const questionMap = new Map(questions.map((question) => [question.id, question]));
      const prepared = {
        ...exam,
        title: exam.title.trim() || 'Full-Length Exam',
        sections: exam.sections.map((section) => ({
          ...section,
          minutes: Math.max(1, Number(section.minutes) || 95),
          questionIds: [...section.questionIds]
            .filter((id) => questionMap.has(id))
            .sort((a, b) => String(questionMap.get(a)?.questionNumber || '').localeCompare(
              String(questionMap.get(b)?.questionNumber || ''),
              undefined,
              { numeric: true },
            )),
        })),
        updatedAt: new Date().toISOString(),
      };
      await onSave(prepared);
    } finally {
      setSaving(false);
    }
  }

  const includedCount = Object.keys(assignment).length;

  return (
    <section className="exam-builder-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">EXAM BUILDER</p>
          <h1>{initialExam?.createdAt ? 'Edit Full-Length Exam' : 'Create Full-Length Exam'}</h1>
          <p>Set up the sections, then assign any question from your cloud question log.</p>
        </div>
      </div>

      <form onSubmit={submit}>
        <section className="panel form-section">
          <div className="field-grid three-columns">
            <label className="form-field">
              <span className="field-label">Exam name</span>
              <input value={exam.title} onChange={(event) => update('title', event.target.value)} required />
            </label>
            <label className="form-field">
              <span className="field-label">Source</span>
              <input value={exam.source} onChange={(event) => update('source', event.target.value)} placeholder="AAMC FL 1, Personal Set, etc." />
            </label>
            <label className="form-field">
              <span className="field-label">Date</span>
              <input type="date" value={exam.testDate} onChange={(event) => update('testDate', event.target.value)} />
            </label>
          </div>
          <label className="checkbox-field exam-timed-toggle">
            <input type="checkbox" checked={exam.timed} onChange={(event) => update('timed', event.target.checked)} />
            <span><strong>Timed exam</strong><small>Each section counts down using the time listed below.</small></span>
          </label>
        </section>

        <section className="panel form-section">
          <div className="section-heading compact-section-heading">
            <div>
              <h2>Sections</h2>
              <p>Change the names or time limits, or add a custom section.</p>
            </div>
            <button type="button" className="secondary-button" onClick={addSection}>+ Add section</button>
          </div>
          <div className="exam-section-editor-list">
            {exam.sections.map((section, index) => (
              <div className="exam-section-editor" key={section.id}>
                <span className="section-order">{index + 1}</span>
                <label><span>Section name</span><input value={section.name} onChange={(event) => updateSection(section.id, { name: event.target.value })} /></label>
                <label><span>Short name</span><input value={section.shortName} onChange={(event) => updateSection(section.id, { shortName: event.target.value })} /></label>
                <label className="minutes-field"><span>Minutes</span><input type="number" min="1" value={section.minutes} onChange={(event) => updateSection(section.id, { minutes: event.target.value })} /></label>
                <strong className="assigned-count">{section.questionIds.length} Q</strong>
                <button type="button" className="icon-button danger" onClick={() => removeSection(section.id)} disabled={exam.sections.length === 1}>⌫</button>
              </div>
            ))}
          </div>
        </section>

        <section className="panel form-section">
          <div className="section-heading compact-section-heading">
            <div>
              <h2>Assign questions</h2>
              <p>{includedCount} of {questions.length} saved questions are included.</p>
            </div>
            <input className="exam-question-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions…" />
          </div>
          {questions.length === 0 ? (
            <div className="inline-empty">Add questions to your question log before building an exam.</div>
          ) : (
            <div className="exam-assignment-table-wrap">
              <table className="exam-assignment-table">
                <thead><tr><th>Question</th><th>Subject / Topic</th><th>Passage</th><th>Exam section</th></tr></thead>
                <tbody>
                  {filteredQuestions.map((question) => (
                    <tr key={question.id}>
                      <td><strong>Q{question.questionNumber || '—'}</strong><span>{question.questionText}</span></td>
                      <td>{question.subject || '—'}<small>{question.topic || ''}</small></td>
                      <td>{question.passageTitle || 'Discrete'}</td>
                      <td>
                        <select value={assignment[question.id] || ''} onChange={(event) => assignQuestion(question.id, event.target.value)}>
                          <option value="">Not included</option>
                          {exam.sections.map((section) => <option key={section.id} value={section.id}>{section.shortName || section.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save Full-Length'}</button>
        </div>
      </form>
    </section>
  );
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function PassageForTest({ question, annotation, prefix }) {
  const blocks = Array.isArray(question.passageBlocks) ? question.passageBlocks : [];
  if (!blocks.length && !question.passageText) return <p className="empty-passage-text">Discrete question</p>;
  const normalizedBlocks = blocks.length ? blocks : [{ id: 'legacy-text', type: 'text', text: question.passageText }];
  return normalizedBlocks.map((block, index) => {
    const blockId = block.id || `block-${index}`;
    if (block.type === 'image') {
      return (
        <figure className="test-passage-figure" key={blockId}>
          {block.dataUrl ? <img src={block.dataUrl} alt={block.name || `Passage figure ${index + 1}`} /> : <div className="missing-image">Image unavailable</div>}
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    }
    return (
      <AnnotatableText
        key={blockId}
        annotationKey={`${prefix}::passage:${blockId}`}
        text={block.text || ''}
        html={annotation?.[`passage:${blockId}`]}
        className="test-passage-text"
      />
    );
  });
}

export function TestRunner({ exam: incomingExam, questions, onSaveExam, onFinish, onExit }) {
  const normalizedExam = useMemo(() => normalizeExam(incomingExam), [incomingExam]);
  const questionMap = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const viableSections = useMemo(() => normalizedExam.sections.map((section) => ({
    ...section,
    questionIds: section.questionIds.filter((id) => questionMap.has(id)),
  })).filter((section) => section.questionIds.length), [normalizedExam.sections, questionMap]);

  const [attempt, setAttempt] = useState(() => normalizedExam.activeAttempt || createAttempt({ ...normalizedExam, sections: viableSections }));
  const [showNavigator, setShowNavigator] = useState(false);
  const [toolbarMessage, setToolbarMessage] = useState('');
  const attemptRef = useRef(attempt);
  const savingRef = useRef(false);
  const expiringRef = useRef(false);

  useEffect(() => {
    attemptRef.current = attempt;
  }, [attempt]);

  const sectionIndex = Math.min(attempt.sectionIndex || 0, Math.max(0, viableSections.length - 1));
  const section = viableSections[sectionIndex];
  const questionIndex = Math.min(
    attempt.questionIndexBySection?.[section?.id] || 0,
    Math.max(0, (section?.questionIds.length || 1) - 1),
  );
  const questionId = section?.questionIds[questionIndex];
  const question = questionMap.get(questionId);
  const annotation = attempt.annotations?.[questionId] || {};
  const selectedAnswer = attempt.answers?.[questionId];
  const remaining = attempt.remainingBySection?.[section?.id] ?? (section?.minutes || 95) * 60;

  async function persist(nextAttempt = attemptRef.current) {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const updatedExam = {
        ...normalizedExam,
        activeAttempt: { ...nextAttempt, updatedAt: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
      };
      await onSaveExam(updatedExam, { silent: true });
    } catch (error) {
      console.error(error);
    } finally {
      savingRef.current = false;
    }
  }

  useEffect(() => {
    const saveInterval = window.setInterval(() => persist(attemptRef.current), 10000);
    const beforeUnload = () => persist(attemptRef.current);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.clearInterval(saveInterval);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  useEffect(() => {
    if (!normalizedExam.timed || !section) return undefined;
    const timer = window.setInterval(() => {
      setAttempt((current) => {
        const currentRemaining = current.remainingBySection?.[section.id] ?? section.minutes * 60;
        return {
          ...current,
          elapsedSeconds: (current.elapsedSeconds || 0) + 1,
          remainingBySection: {
            ...current.remainingBySection,
            [section.id]: Math.max(0, currentRemaining - 1),
          },
          updatedAt: new Date().toISOString(),
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [normalizedExam.timed, section?.id]);

  useEffect(() => {
    if (normalizedExam.timed && remaining === 0 && !expiringRef.current) {
      expiringRef.current = true;
      window.setTimeout(() => {
        endSection(true);
        expiringRef.current = false;
      }, 100);
    }
  }, [remaining, normalizedExam.timed]);

  if (!section || !question) {
    return (
      <div className="empty-review">
        <h1>This exam has no available questions.</h1>
        <p>Edit the full-length and assign at least one saved question.</p>
        <button className="primary-button" onClick={onExit}>Back to Full-Lengths</button>
      </div>
    );
  }

  function updateAttempt(updater, saveNow = false) {
    setAttempt((current) => {
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      attemptRef.current = stamped;
      if (saveNow) window.setTimeout(() => persist(stamped), 0);
      return stamped;
    });
  }

  function chooseAnswer(index) {
    updateAttempt((current) => ({
      ...current,
      answers: { ...current.answers, [questionId]: index },
    }), true);
  }

  function toggleFlag() {
    updateAttempt((current) => ({
      ...current,
      flags: { ...current.flags, [questionId]: !current.flags?.[questionId] },
    }), true);
  }

  function toggleStrike(index) {
    updateAttempt((current) => {
      const currentStrikes = new Set(current.strikes?.[questionId] || []);
      if (currentStrikes.has(index)) currentStrikes.delete(index);
      else currentStrikes.add(index);
      return {
        ...current,
        strikes: { ...current.strikes, [questionId]: [...currentStrikes] },
      };
    }, true);
  }

  function applyFormat(kind) {
    const result = applySelectionFormat(kind);
    if (result.error) {
      setToolbarMessage(result.error);
      window.setTimeout(() => setToolbarMessage(''), 2500);
      return;
    }
    const [, annotationKey] = result.key.split('::');
    updateAttempt((current) => ({
      ...current,
      annotations: {
        ...current.annotations,
        [questionId]: {
          ...(current.annotations?.[questionId] || {}),
          [annotationKey]: result.html,
        },
      },
    }), true);
  }

  function goToQuestion(nextIndex) {
    if (nextIndex < 0 || nextIndex >= section.questionIds.length) return;
    updateAttempt((current) => ({
      ...current,
      questionIndexBySection: { ...current.questionIndexBySection, [section.id]: nextIndex },
    }), true);
    setShowNavigator(false);
  }

  function goPrevious() {
    if (questionIndex > 0) goToQuestion(questionIndex - 1);
  }

  function goNext() {
    if (questionIndex < section.questionIds.length - 1) goToQuestion(questionIndex + 1);
    else endSection(false);
  }

  function endSection(auto = false) {
    const unanswered = section.questionIds.filter((id) => attemptRef.current.answers?.[id] === undefined).length;
    if (!auto) {
      const message = sectionIndex < viableSections.length - 1
        ? `End ${section.shortName || section.name}? ${unanswered} question(s) are unanswered. You cannot return to this section during this attempt.`
        : `Submit the exam? ${unanswered} question(s) in this section are unanswered.`;
      if (!window.confirm(message)) return;
    }

    if (sectionIndex < viableSections.length - 1) {
      updateAttempt((current) => ({ ...current, sectionIndex: sectionIndex + 1 }), true);
    } else {
      submitExam();
    }
  }

  async function submitExam() {
    const latest = attemptRef.current;
    const score = scoreAttempt({ ...normalizedExam, sections: viableSections }, latest, questionMap);
    const completed = {
      ...latest,
      status: 'completed',
      completedAt: new Date().toISOString(),
      score,
      updatedAt: new Date().toISOString(),
    };
    await onFinish(normalizedExam, completed);
  }

  async function exitExam() {
    await persist(attemptRef.current);
    onExit();
  }

  const flagged = Boolean(attempt.flags?.[questionId]);
  const strikeSet = new Set(attempt.strikes?.[questionId] || []);
  const answeredInSection = section.questionIds.filter((id) => attempt.answers?.[id] !== undefined).length;

  return (
    <section className="exam-page live-test-page">
      <header className="exam-topbar">
        <div className="exam-title"><strong>{normalizedExam.title}</strong><span>{section.name}</span></div>
        <div className="exam-identifiers"><span>{normalizedExam.timed ? 'Untutored, Timed' : 'Untutored, Untimed'}</span><strong>Attempt {attempt.id.slice(0, 8)}</strong></div>
        <div className="exam-review-label"><strong>{formatClock(remaining)}</strong><span>{questionIndex + 1} of {section.questionIds.length}</span></div>
      </header>

      <div className="exam-actionbar">
        <div className="exam-action-left">
          <button type="button" onClick={() => applyFormat('highlight')}><span className="highlight-square"></span> Highlight</button>
          <button type="button" onClick={() => applyFormat('strike')}>⌁ Strikethrough</button>
          {toolbarMessage && <span className="toolbar-message">{toolbarMessage}</span>}
        </div>
        <div className="exam-action-right">
          <span className="test-progress-text">Answered {answeredInSection}/{section.questionIds.length}</span>
          <button className={flagged ? 'is-flagged' : ''} onClick={toggleFlag}>⚑ {flagged ? 'Flagged' : 'Flag for Review'}</button>
        </div>
      </div>
      <div className="exam-divider-bar"></div>

      <div className="exam-workspace">
        <article className="exam-passage-pane">
          <div className="exam-pane-scroll">
            <h2 className="exam-passage-heading">{question.passageTitle || 'Passage'}{question.passageRange && <span> ({question.passageRange})</span>}</h2>
            <PassageForTest question={question} annotation={annotation} prefix={questionId} />
          </div>
        </article>

        <article className="exam-question-pane">
          <div className="exam-pane-scroll exam-question-scroll">
            <h2 className="exam-question-number">Question {question.questionNumber || questionIndex + 1}</h2>
            <AnnotatableText annotationKey={`${questionId}::question`} text={question.questionText} html={annotation.question} className="exam-question-text" />

            <div className="exam-answer-list live-answer-list">
              {question.choices.map((choice, index) => {
                const selected = Number(selectedAnswer) === index;
                const struck = strikeSet.has(index);
                return (
                  <div className={`live-answer-row ${selected ? 'selected' : ''} ${struck ? 'struck' : ''}`} key={index}>
                    <button className="choice-strike-button" onClick={() => toggleStrike(index)} title="Cross out this answer">S</button>
                    <button className="exam-answer-choice" onClick={() => chooseAnswer(index)}>
                      <span className="exam-radio">{selected ? '◉' : '○'}</span>
                      <strong>{String.fromCharCode(65 + index)}.</strong>
                      <span>{choice}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </article>
      </div>

      <footer className="exam-footer">
        <div className="exam-footer-left"><button onClick={exitExam}>➜ End</button><button type="button" onClick={() => window.alert('Periodic table reference can be added as the next feature.')}>▦ Periodic Table</button></div>
        <div className="exam-footer-right"><button disabled={questionIndex === 0} onClick={goPrevious}>← Previous</button><button onClick={() => setShowNavigator(true)}>◌ Navigator</button><button onClick={goNext}>{questionIndex === section.questionIds.length - 1 ? (sectionIndex === viableSections.length - 1 ? 'Submit →' : 'End Section →') : 'Next →'}</button></div>
      </footer>

      {showNavigator && (
        <div className="navigator-backdrop" onMouseDown={() => setShowNavigator(false)}>
          <div className="navigator-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="navigator-header"><div><h2>{section.shortName || section.name} Navigator</h2><p>Select a question in the current section.</p></div><button onClick={() => setShowNavigator(false)}>×</button></div>
            <div className="navigator-legend"><span><i className="answered-dot"></i>Answered</span><span><i className="flagged-dot"></i>Flagged</span><span><i className="current-dot"></i>Current</span></div>
            <div className="navigator-grid">
              {section.questionIds.map((id, index) => (
                <button
                  key={id}
                  className={`${attempt.answers?.[id] !== undefined ? 'answered' : ''} ${attempt.flags?.[id] ? 'flagged' : ''} ${index === questionIndex ? 'current' : ''}`}
                  onClick={() => goToQuestion(index)}
                >
                  {questionMap.get(id)?.questionNumber || index + 1}
                </button>
              ))}
            </div>
            <button className="primary-button full-width-button" onClick={() => setShowNavigator(false)}>Return to Question</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ExamResults({ exam, attempt, questions, onBack, onRetake, onReviewQuestion }) {
  const normalized = normalizeExam(exam);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const score = attempt.score || scoreAttempt(normalized, attempt, questionMap);
  const questionIds = normalized.sections.flatMap((section) => section.questionIds).filter((id) => questionMap.has(id));

  return (
    <section className="exam-results-page">
      <div className="results-hero">
        <p className="eyebrow">ATTEMPT COMPLETE</p>
        <h1>{normalized.title}</h1>
        <div className="results-score-ring"><strong>{score.percent}%</strong><span>{score.correct} / {score.total} correct</span></div>
        <div className="results-actions"><button className="secondary-button" onClick={onBack}>Back to Full-Lengths</button><button className="primary-button" onClick={onRetake}>Start New Attempt</button></div>
      </div>

      <div className="results-section-grid">
        {score.sectionScores.map((section) => (
          <article key={section.sectionId}><span>{section.shortName || section.name}</span><strong>{section.percent}%</strong><small>{section.correct} of {section.total}</small></article>
        ))}
      </div>

      <section className="panel results-question-list">
        <div className="section-heading compact-section-heading"><div><h2>Question review</h2><p>Open any question in the full explanation view.</p></div></div>
        <div className="results-table-wrap">
          <table>
            <thead><tr><th>Question</th><th>Your answer</th><th>Correct answer</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {questionIds.map((id) => {
                const question = questionMap.get(id);
                const selected = attempt.answers?.[id];
                const correct = Number(selected) === Number(question.correctAnswer);
                return (
                  <tr key={id}>
                    <td><strong>Q{question.questionNumber || '—'}</strong><span>{question.topic || question.subject}</span></td>
                    <td>{selected === undefined ? 'Unanswered' : String.fromCharCode(65 + Number(selected))}</td>
                    <td>{String.fromCharCode(65 + Number(question.correctAnswer))}</td>
                    <td><span className={`result-badge ${correct ? 'correct' : 'incorrect'}`}>{correct ? 'correct' : 'incorrect'}</span></td>
                    <td><button className="table-open-button" onClick={() => onReviewQuestion(question)}>Review</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
