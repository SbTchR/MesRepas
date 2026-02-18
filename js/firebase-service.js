import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  getBlob
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

import { firebaseConfig } from './firebase-config.js';

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

function isPlaceholder(value = '') {
  return String(value).includes('YOUR_') || String(value).trim() === '';
}

export const missingConfigKeys = REQUIRED_KEYS.filter(
  (key) => !firebaseConfig || isPlaceholder(firebaseConfig[key])
);

export const firebaseReady = missingConfigKeys.length === 0;

let app = null;
let db = null;
let storage = null;

if (firebaseReady) {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
}

function ensureReady() {
  if (!firebaseReady) {
    throw new Error('Firebase non configuré.');
  }
}

async function withReady(action) {
  ensureReady();
  return action();
}

export async function fetchStudents() {
  return withReady(async () => {
    const snap = await getDocs(collection(db, 'students'));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
  });
}

export async function createStudent(name) {
  return withReady(async () => {
    const refDoc = doc(collection(db, 'students'));
    const payload = {
      name: name.trim(),
      lowerName: name.trim().toLocaleLowerCase('fr'),
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    };
    await setDoc(refDoc, payload);
    return { id: refDoc.id, ...payload };
  });
}

export async function fetchMeals() {
  return withReady(async () => {
    const snap = await getDocs(collection(db, 'meals'));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  });
}

export async function fetchMealsByStudent(studentId) {
  return withReady(async () => {
    const q = query(collection(db, 'meals'), where('studentId', '==', studentId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  });
}

export async function saveMeal({ mealId, student, mealLabel, photos, audios }) {
  return withReady(async () => {
    const mealRef = doc(db, 'meals', mealId);
    const createdAtMs = Date.now();
    await setDoc(mealRef, {
      studentId: student.id,
      studentName: student.name,
      mealLabel: String(mealLabel || '').trim() || null,
      teacherFeedback: '',
      teacherMealFeedback: '',
      createdAt: serverTimestamp(),
      createdAtMs,
      photos,
      audios
    });
    return { mealId, createdAtMs };
  });
}

export async function updateMeal({ mealId, mealLabel, photos, audios }) {
  return withReady(async () => {
    await setDoc(
      doc(db, 'meals', mealId),
      {
        mealLabel: String(mealLabel || '').trim() || null,
        photos,
        audios,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      },
      { merge: true }
    );
  });
}

export async function deleteMealDoc(mealId) {
  return withReady(async () => {
    await deleteDoc(doc(db, 'meals', mealId));
  });
}

export async function deleteStudentDoc(studentId) {
  return withReady(async () => {
    await deleteDoc(doc(db, 'students', studentId));
  });
}

export async function uploadMealFile({ studentId, mealId, folder, file, index, onProgress }) {
  return withReady(async () => {
    const cleanName = `${Date.now()}-${index}-${String(file.name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const path = `students/${studentId}/meals/${mealId}/${folder}/${cleanName}`;
    const fileRef = ref(storage, path);
    const metadata = file.type ? { contentType: file.type } : undefined;

    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(fileRef, file, metadata);

      task.on(
        'state_changed',
        (snapshot) => {
          if (typeof onProgress === 'function') {
            onProgress({
              bytesTransferred: Number(snapshot.bytesTransferred || 0),
              totalBytes: Number(snapshot.totalBytes || file.size || 0)
            });
          }
        },
        (error) => {
          reject(error);
        },
        async () => {
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            resolve({
              path,
              url,
              name: file.name || cleanName,
              size: Number(file.size || 0),
              mimeType: file.type || ''
            });
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  });
}

export async function deleteStoragePath(path) {
  return withReady(async () => {
    try {
      await deleteObject(ref(storage, path));
    } catch (_error) {
      // Ignore missing file in storage to let cleanup continue.
    }
  });
}

export async function fetchEvaluations() {
  return withReady(async () => {
    const snap = await getDocs(collection(db, 'evaluations'));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  });
}

export async function fetchEvaluationsByEvaluator(studentId) {
  return withReady(async () => {
    const q = query(collection(db, 'evaluations'), where('evaluatorId', '==', studentId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        if (a.status === b.status) {
          return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
        }
        return a.status === 'pending' ? -1 : 1;
      });
  });
}

export async function fetchEvaluationsByTarget(studentId) {
  return withReady(async () => {
    const q = query(collection(db, 'evaluations'), where('targetStudentId', '==', studentId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(b.completedAtMs || b.createdAtMs || 0) - Number(a.completedAtMs || a.createdAtMs || 0));
  });
}

export async function createEvaluation(payload) {
  return withReady(async () => {
    const evalRef = doc(collection(db, 'evaluations'));
    await setDoc(evalRef, {
      ...payload,
      status: 'pending',
      teacherFeedback: '',
      teacherEvaluationFeedback: '',
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });
    return evalRef.id;
  });
}

export async function deleteEvaluationDoc(evalId) {
  return withReady(async () => {
    await deleteDoc(doc(db, 'evaluations', evalId));
  });
}

export async function submitEvaluationResponse(evalId, response) {
  return withReady(async () => {
    await updateDoc(doc(db, 'evaluations', evalId), {
      status: 'done',
      completedAt: serverTimestamp(),
      completedAtMs: Date.now(),
      response
    });
  });
}

export async function updateMealFeedback(mealId, feedback) {
  return withReady(async () => {
    const text = String(feedback || '').trim();
    const payload = {
      teacherFeedback: text,
      teacherMealFeedback: text,
      teacherFeedbackUpdatedAt: serverTimestamp(),
      teacherFeedbackUpdatedAtMs: Date.now()
    };
    await setDoc(doc(db, 'meals', mealId), payload, { merge: true });
  });
}

export async function updateEvaluationFeedback(evalId, feedback) {
  return withReady(async () => {
    const text = String(feedback || '').trim();
    const payload = {
      teacherFeedback: text,
      teacherEvaluationFeedback: text,
      teacherFeedbackUpdatedAt: serverTimestamp(),
      teacherFeedbackUpdatedAtMs: Date.now()
    };
    await setDoc(doc(db, 'evaluations', evalId), payload, { merge: true });
  });
}

export async function downloadStorageBlob(path) {
  return withReady(async () => {
    if (!path) {
      throw new Error('Chemin Storage manquant.');
    }
    const fileRef = ref(storage, path);
    return getBlob(fileRef);
  });
}

export async function getMealById(mealId) {
  return withReady(async () => {
    const snap = await getDoc(doc(db, 'meals', mealId));
    if (!snap.exists()) {
      return null;
    }
    return { id: snap.id, ...snap.data() };
  });
}

export { app, db, storage };
