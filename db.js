import { supabase } from './supabase.js';

const TABLE = 'questions';
const BUCKET = 'question-images';

async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('You must be signed in.');
  return data.user;
}

function clone(value) {
  return structuredClone(value);
}

function extensionFromMime(mime = '') {
  const clean = mime.split(';')[0].toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[clean] || 'img';
}

async function sourceToBlob(source) {
  const response = await fetch(source);
  if (!response.ok) throw new Error('Could not read an uploaded image.');
  return response.blob();
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function safePart(value) {
  return String(value || 'image').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
}

async function uploadImage({ userId, questionId, label, dataUrl, oldPath }) {
  if (!dataUrl) return oldPath || '';
  if (oldPath) return oldPath;

  const blob = await sourceToBlob(dataUrl);
  const extension = extensionFromMime(blob.type);
  const path = `${userId}/${safePart(questionId)}/${safePart(label)}-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

function collectStoragePaths(question) {
  const paths = new Set();
  if (question?.screenshotStoragePath) paths.add(question.screenshotStoragePath);
  if (question?.explanationImageStoragePath) paths.add(question.explanationImageStoragePath);
  (question?.passageBlocks || []).forEach((block) => {
    if (block?.storagePath) paths.add(block.storagePath);
  });
  return [...paths];
}

async function prepareForStorage(question, userId) {
  const stored = clone(question);

  if (stored.screenshotDataUrl) {
    stored.screenshotStoragePath = await uploadImage({
      userId,
      questionId: stored.id,
      label: 'legacy-passage',
      dataUrl: stored.screenshotDataUrl,
      oldPath: stored.screenshotStoragePath,
    });
  }
  stored.screenshotDataUrl = '';

  if (stored.explanationImageDataUrl) {
    stored.explanationImageStoragePath = await uploadImage({
      userId,
      questionId: stored.id,
      label: 'explanation',
      dataUrl: stored.explanationImageDataUrl,
      oldPath: stored.explanationImageStoragePath,
    });
  }
  stored.explanationImageDataUrl = '';

  stored.passageBlocks = await Promise.all(
    (stored.passageBlocks || []).map(async (block, index) => {
      const nextBlock = { ...block };
      if (nextBlock.type === 'image' && nextBlock.dataUrl) {
        nextBlock.storagePath = await uploadImage({
          userId,
          questionId: stored.id,
          label: `passage-${index + 1}-${nextBlock.id || 'block'}`,
          dataUrl: nextBlock.dataUrl,
          oldPath: nextBlock.storagePath,
        });
      }
      delete nextBlock.dataUrl;
      return nextBlock;
    }),
  );

  return stored;
}

async function downloadImage(path) {
  if (!path) return '';
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) {
    console.warn(`Could not download ${path}:`, error.message);
    return '';
  }
  return blobToDataUrl(data);
}

async function hydrateQuestion(storedQuestion) {
  const question = clone(storedQuestion);

  if (question.screenshotStoragePath) {
    question.screenshotDataUrl = await downloadImage(question.screenshotStoragePath);
  }
  if (question.explanationImageStoragePath) {
    question.explanationImageDataUrl = await downloadImage(question.explanationImageStoragePath);
  }

  question.passageBlocks = await Promise.all(
    (question.passageBlocks || []).map(async (block) => ({
      ...block,
      dataUrl: block.type === 'image' && block.storagePath
        ? await downloadImage(block.storagePath)
        : block.dataUrl || '',
    })),
  );

  return question;
}

async function getStoredQuestion(id, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data?.data || null;
}

async function removePaths(paths) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove([...new Set(paths)]);
  if (error) console.warn('Some old images could not be removed:', error.message);
}

async function removeUnreferencedPaths(paths, userId) {
  const candidates = [...new Set(paths)].filter(Boolean);
  if (!candidates.length) return;

  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('user_id', userId);
  if (error) throw error;

  const stillReferenced = new Set(
    (data || []).flatMap((row) => collectStoragePaths(row.data)),
  );
  await removePaths(candidates.filter((path) => !stillReferenced.has(path)));
}

function clearStoragePaths(question) {
  const next = clone(question);
  next.screenshotStoragePath = '';
  next.explanationImageStoragePath = '';
  next.passageBlocks = (next.passageBlocks || []).map((block) => ({
    ...block,
    storagePath: '',
  }));
  return next;
}

export async function getAllQuestions() {
  const user = await getUser();
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return Promise.all((data || []).map((row) => hydrateQuestion(row.data)));
}

export async function saveQuestion(question) {
  const user = await getUser();
  const oldQuestion = await getStoredQuestion(question.id, user.id);
  const storedQuestion = await prepareForStorage(question, user.id);

  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: user.id,
      id: String(question.id),
      data: storedQuestion,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,id' },
  );
  if (error) throw error;

  const oldPaths = new Set(collectStoragePaths(oldQuestion));
  const newPaths = new Set(collectStoragePaths(storedQuestion));
  await removeUnreferencedPaths([...oldPaths].filter((path) => !newPaths.has(path)), user.id);
}

export async function deleteQuestion(id) {
  const user = await getUser();
  const oldQuestion = await getStoredQuestion(id, user.id);
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', user.id)
    .eq('id', id);
  if (error) throw error;
  await removeUnreferencedPaths(collectStoragePaths(oldQuestion), user.id);
}

export async function replaceAllQuestions(questions) {
  const user = await getUser();
  const { data: existing, error: readError } = await supabase
    .from(TABLE)
    .select('data')
    .eq('user_id', user.id);
  if (readError) throw readError;

  const { error: deleteError } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', user.id);
  if (deleteError) throw deleteError;

  await removePaths((existing || []).flatMap((row) => collectStoragePaths(row.data)));

  for (const question of questions) {
    await saveQuestion(clearStoragePaths(question));
  }
}
