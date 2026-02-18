import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

import {
  firebaseReady,
  missingConfigKeys,
  fetchStudents,
  createStudent,
  deleteStudentDoc,
  fetchMeals,
  deleteMealDoc,
  deleteStoragePath,
  downloadStorageBlob,
  fetchEvaluations,
  createEvaluation,
  deleteEvaluationDoc,
  updateMealFeedback,
  updateEvaluationFeedback
} from './firebase-service.js';

import {
  formatDateTime,
  formatDateForFile,
  safeName,
  showWarning,
  hideWarning,
  showToast,
  buildMediaSection,
  setBusy,
  initImageLightbox
} from './app-common.js';

const elements = {
  firebaseWarning: document.getElementById('firebaseWarning'),
  refreshBtn: document.getElementById('refreshTeacherBtn'),
  addStudentForm: document.getElementById('addStudentForm'),
  newStudentName: document.getElementById('newStudentName'),
  studentsList: document.getElementById('studentsList'),
  mealFilterStudent: document.getElementById('mealFilterStudent'),
  exportZipBtn: document.getElementById('exportZipBtn'),
  exportStatus: document.getElementById('exportStatus'),
  teacherMealsList: document.getElementById('teacherMealsList'),
  assignEvalForm: document.getElementById('assignEvalForm'),
  evaluatorSelect: document.getElementById('evaluatorSelect'),
  targetMealSelect: document.getElementById('targetMealSelect'),
  criteriaList: document.getElementById('criteriaList'),
  addCriterionBtn: document.getElementById('addCriterionBtn'),
  teacherEvaluationsList: document.getElementById('teacherEvaluationsList')
};

const state = {
  students: [],
  meals: [],
  evaluations: [],
  mealFilter: 'all',
  lastExportUrl: ''
};

function mealLabelForDisplay(meal) {
  return meal.mealLabel || 'Repas sans nom';
}

function mealFeedbackOf(meal) {
  return meal.teacherMealFeedback || meal.teacherFeedback || '';
}

function evaluationFeedbackOf(evaluation) {
  return evaluation.teacherEvaluationFeedback || evaluation.teacherFeedback || '';
}

function getStudentById(studentId) {
  return state.students.find((student) => student.id === studentId) || null;
}

function disableAll() {
  [
    elements.refreshBtn,
    elements.newStudentName,
    elements.mealFilterStudent,
    elements.exportZipBtn,
    elements.evaluatorSelect,
    elements.targetMealSelect,
    elements.addCriterionBtn
  ].forEach((el) => {
    if (el) {
      el.disabled = true;
    }
  });

  document.querySelectorAll('button').forEach((button) => {
    button.disabled = true;
  });
}

function renderStudents() {
  elements.studentsList.innerHTML = '';

  if (!state.students.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Aucun élève.';
    elements.studentsList.appendChild(p);
    return;
  }

  state.students.forEach((student) => {
    const mealCount = state.meals.filter((meal) => meal.studentId === student.id).length;
    const evalInCount = state.evaluations.filter((evaluation) => evaluation.targetStudentId === student.id).length;
    const evalOutCount = state.evaluations.filter((evaluation) => evaluation.evaluatorId === student.id).length;

    const card = document.createElement('article');
    card.className = 'student-manage-card';

    const head = document.createElement('div');
    head.className = 'card-head';

    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = student.name;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger-btn delete-student-btn';
    deleteBtn.dataset.studentId = student.id;
    deleteBtn.textContent = 'Supprimer';

    head.append(title, deleteBtn);

    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${mealCount} repas | ${evalOutCount} évals données | ${evalInCount} évals reçues`;

    card.append(head, meta);
    elements.studentsList.appendChild(card);
  });
}

function renderSelectOptions() {
  const prevFilter = state.mealFilter;
  const prevEvaluator = elements.evaluatorSelect.value;
  const prevMeal = elements.targetMealSelect.value;

  elements.mealFilterStudent.innerHTML = '<option value="all">Tous les élèves</option>';
  elements.evaluatorSelect.innerHTML = '<option value="">Choisir...</option>';
  elements.targetMealSelect.innerHTML = '<option value="">Choisir...</option>';

  state.students.forEach((student) => {
    const filterOpt = document.createElement('option');
    filterOpt.value = student.id;
    filterOpt.textContent = student.name;

    const evaluatorOpt = filterOpt.cloneNode(true);

    elements.mealFilterStudent.appendChild(filterOpt);
    elements.evaluatorSelect.appendChild(evaluatorOpt);
  });

  state.meals.forEach((meal) => {
    const option = document.createElement('option');
    option.value = meal.id;
    option.textContent = `${meal.studentName} - ${mealLabelForDisplay(meal)} - ${formatDateTime(meal.createdAtMs)}`;
    elements.targetMealSelect.appendChild(option);
  });

  if (prevFilter && (prevFilter === 'all' || state.students.some((s) => s.id === prevFilter))) {
    state.mealFilter = prevFilter;
  } else {
    state.mealFilter = 'all';
  }

  elements.mealFilterStudent.value = state.mealFilter;

  if (state.students.some((s) => s.id === prevEvaluator)) {
    elements.evaluatorSelect.value = prevEvaluator;
  }

  if (state.meals.some((m) => m.id === prevMeal)) {
    elements.targetMealSelect.value = prevMeal;
  }
}

function createMealCard(meal) {
  const card = document.createElement('article');
  card.className = 'meal-card';
  card.dataset.mealId = meal.id;

  const head = document.createElement('div');
  head.className = 'card-head';

  const left = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = `${meal.studentName} - ${mealLabelForDisplay(meal)}`;

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${formatDateTime(meal.createdAtMs)} - ${meal.photos?.length || 0} photo(s), ${meal.audios?.length || 0} audio(s)`;

  left.append(title, meta);

  const idTag = document.createElement('span');
  idTag.className = 'chip';
  idTag.textContent = meal.id.slice(0, 6);

  head.append(left, idTag);
  card.append(head, buildMediaSection({ photos: meal.photos || [], audios: meal.audios || [] }));

  const feedbackWrap = document.createElement('div');
  feedbackWrap.className = 'feedback-wrap';

  const feedbackTitle = document.createElement('p');
  feedbackTitle.className = 'feedback-title';
  feedbackTitle.textContent = 'Retour prof sur ce repas';

  const textarea = document.createElement('textarea');
  textarea.className = 'meal-feedback-input';
  textarea.dataset.mealId = meal.id;
  textarea.placeholder = 'Écrire un retour simple...';
  textarea.value = mealFeedbackOf(meal);

  const actions = document.createElement('div');
  actions.className = 'teacher-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary-btn save-meal-feedback-btn';
  saveBtn.textContent = 'Enregistrer retour';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger-btn delete-meal-btn';
  deleteBtn.dataset.mealId = meal.id;
  deleteBtn.textContent = 'Supprimer repas';

  actions.append(saveBtn, deleteBtn);
  feedbackWrap.append(feedbackTitle, textarea, actions);
  card.appendChild(feedbackWrap);

  return card;
}

function renderTeacherMeals() {
  elements.teacherMealsList.innerHTML = '';

  const items =
    state.mealFilter === 'all'
      ? state.meals
      : state.meals.filter((meal) => meal.studentId === state.mealFilter);

  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Aucun repas.';
    elements.teacherMealsList.appendChild(p);
    return;
  }

  items.forEach((meal) => {
    elements.teacherMealsList.appendChild(createMealCard(meal));
  });
}

function createEvaluationCard(evaluation) {
  const card = document.createElement('article');
  card.className = 'eval-card';
  card.dataset.evalId = evaluation.id;

  const head = document.createElement('div');
  head.className = 'card-head';

  const left = document.createElement('div');

  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = `${evaluation.evaluatorName} évalue ${evaluation.targetStudentName}`;

  const mealLabel = evaluation.targetMealLabel ? `${evaluation.targetMealLabel} - ` : '';
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${mealLabel}${formatDateTime(evaluation.targetMealDateMs)}`;

  left.append(title, meta);

  const status = document.createElement('span');
  status.className = `chip ${evaluation.status === 'done' ? 'eval-status-done' : 'eval-status-pending'}`;
  status.textContent = evaluation.status === 'done' ? 'Fait' : 'À faire';

  head.append(left, status);
  card.appendChild(head);

  if (evaluation.targetMealMedia) {
    card.appendChild(
      buildMediaSection({
        photos: evaluation.targetMealMedia.photos || [],
        audios: evaluation.targetMealMedia.audios || []
      })
    );
  }

  const criteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];

  if (!criteria.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Pas de critère.';
    card.appendChild(p);
  } else {
    criteria.forEach((criterion) => {
      const box = document.createElement('div');
      box.className = 'answer-box';

      const label = document.createElement('p');
      label.className = 'card-title';
      label.textContent = criterion.text;

      const answer = document.createElement('p');
      const item = evaluation.response?.answers?.find((a) => a.criterionId === criterion.id);
      answer.textContent = item?.text || (evaluation.status === 'done' ? '(vide)' : 'Pas encore répondu.');

      box.append(label, answer);
      card.appendChild(box);
    });
  }

  const feedbackWrap = document.createElement('div');
  feedbackWrap.className = 'feedback-wrap';

  const feedbackTitle = document.createElement('p');
  feedbackTitle.className = 'feedback-title';
  feedbackTitle.textContent = 'Retour prof sur cette évaluation';

  const textarea = document.createElement('textarea');
  textarea.className = 'evaluation-feedback-input';
  textarea.dataset.evalId = evaluation.id;
  textarea.placeholder = 'Écrire un retour simple...';
  textarea.value = evaluationFeedbackOf(evaluation);

  const actions = document.createElement('div');
  actions.className = 'teacher-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary-btn save-eval-feedback-btn';
  saveBtn.textContent = 'Enregistrer retour';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger-btn delete-eval-btn';
  deleteBtn.dataset.evalId = evaluation.id;
  deleteBtn.textContent = 'Supprimer évaluation';

  actions.append(saveBtn, deleteBtn);
  feedbackWrap.append(feedbackTitle, textarea, actions);

  card.appendChild(feedbackWrap);
  return card;
}

function renderTeacherEvaluations() {
  elements.teacherEvaluationsList.innerHTML = '';

  if (!state.evaluations.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Aucune évaluation.';
    elements.teacherEvaluationsList.appendChild(p);
    return;
  }

  state.evaluations.forEach((evaluation) => {
    elements.teacherEvaluationsList.appendChild(createEvaluationCard(evaluation));
  });
}

function addCriterionField(value = '') {
  const row = document.createElement('div');
  row.className = 'criteria-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = 'Ex: Je comprends le repas ?';
  input.value = value;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger-btn';
  remove.textContent = 'X';
  remove.addEventListener('click', () => row.remove());

  row.append(input, remove);
  elements.criteriaList.appendChild(row);
}

function getCriteriaFromForm() {
  const inputs = [...elements.criteriaList.querySelectorAll('input')];
  const texts = inputs.map((input) => input.value.trim()).filter(Boolean);
  return texts.map((text, index) => ({ id: `c-${Date.now()}-${index + 1}`, text }));
}

async function loadAll() {
  const [students, meals, evaluations] = await Promise.all([fetchStudents(), fetchMeals(), fetchEvaluations()]);

  state.students = students;
  state.meals = meals;
  state.evaluations = evaluations;

  renderStudents();
  renderSelectOptions();
  renderTeacherMeals();
  renderTeacherEvaluations();
}

async function handleAddStudent(event) {
  event.preventDefault();

  const name = elements.newStudentName.value.trim();
  if (!name) {
    showToast('Nom requis', 'error');
    return;
  }

  const duplicate = state.students.some(
    (student) => student.name.trim().toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr')
  );

  if (duplicate) {
    showToast('Nom déjà présent', 'error');
    return;
  }

  const submitBtn = elements.addStudentForm.querySelector('button[type="submit"]');
  setBusy(submitBtn, true, 'Ajout...');

  try {
    await createStudent(name);
    elements.newStudentName.value = '';
    await loadAll();
    showToast('Élève ajouté');
  } catch (error) {
    console.error(error);
    showToast('Erreur ajout élève', 'error');
  } finally {
    setBusy(submitBtn, false);
  }
}

async function handleDeleteStudent(studentId, button) {
  const student = getStudentById(studentId);
  if (!student) {
    return;
  }

  const ok = window.confirm(`Supprimer ${student.name} ? (repas + évaluations liés supprimés)`);
  if (!ok) {
    return;
  }

  setBusy(button, true, 'Suppression...');

  try {
    const studentMeals = state.meals.filter((meal) => meal.studentId === studentId);
    const relatedEvaluations = state.evaluations.filter(
      (evaluation) => evaluation.evaluatorId === studentId || evaluation.targetStudentId === studentId
    );

    const mediaPaths = studentMeals
      .flatMap((meal) => [...(meal.photos || []), ...(meal.audios || [])])
      .map((item) => item.path)
      .filter(Boolean);

    await Promise.all(mediaPaths.map((path) => deleteStoragePath(path)));
    await Promise.all(studentMeals.map((meal) => deleteMealDoc(meal.id)));

    const evaluationIds = [...new Set(relatedEvaluations.map((evaluation) => evaluation.id))];
    await Promise.all(evaluationIds.map((evalId) => deleteEvaluationDoc(evalId)));

    await deleteStudentDoc(studentId);
    await loadAll();
    showToast('Élève supprimé');
  } catch (error) {
    console.error(error);
    showToast('Erreur suppression élève', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleDeleteMeal(mealId, button) {
  const meal = state.meals.find((item) => item.id === mealId);
  if (!meal) {
    return;
  }

  const ok = window.confirm('Supprimer ce repas ? (évaluations liées supprimées)');
  if (!ok) {
    return;
  }

  setBusy(button, true, 'Suppression...');

  try {
    const mediaPaths = [...(meal.photos || []), ...(meal.audios || [])]
      .map((item) => item.path)
      .filter(Boolean);

    await Promise.all(mediaPaths.map((path) => deleteStoragePath(path)));
    await deleteMealDoc(mealId);

    const linkedEvals = state.evaluations.filter((evaluation) => evaluation.targetMealId === mealId);
    await Promise.all(linkedEvals.map((evaluation) => deleteEvaluationDoc(evaluation.id)));

    await loadAll();
    showToast('Repas supprimé');
  } catch (error) {
    console.error(error);
    showToast('Erreur suppression repas', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleDeleteEvaluation(evalId, button) {
  const ok = window.confirm('Supprimer cette évaluation ?');
  if (!ok) {
    return;
  }

  setBusy(button, true, 'Suppression...');

  try {
    await deleteEvaluationDoc(evalId);
    await loadAll();
    showToast('Évaluation supprimée');
  } catch (error) {
    console.error(error);
    showToast('Erreur suppression évaluation', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleSaveMealFeedback(mealId, textarea, button) {
  if (!mealId || !textarea) {
    showToast('Retour repas: données manquantes', 'error');
    return;
  }

  setBusy(button, true, 'Enregistrement...');

  try {
    const nextFeedback = String(textarea.value || '').trim();
    await updateMealFeedback(mealId, textarea.value || '');
    const meal = state.meals.find((item) => item.id === mealId);
    if (meal) {
      meal.teacherFeedback = nextFeedback;
      meal.teacherMealFeedback = nextFeedback;
    }
    showToast('Retour repas enregistré');

    try {
      await loadAll();
    } catch (refreshError) {
      console.warn('Meal feedback saved but reload failed:', refreshError);
    }
  } catch (error) {
    console.error('Save meal feedback failed:', {
      mealId,
      message: error?.message,
      code: error?.code,
      raw: error
    });
    showToast(`Erreur retour repas (${error?.code || 'inconnue'})`, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleSaveEvaluationFeedback(evalId, textarea, button) {
  if (!evalId || !textarea) {
    showToast('Retour évaluation: données manquantes', 'error');
    return;
  }

  setBusy(button, true, 'Enregistrement...');

  try {
    const nextFeedback = String(textarea.value || '').trim();
    await updateEvaluationFeedback(evalId, textarea.value || '');
    const evaluation = state.evaluations.find((item) => item.id === evalId);
    if (evaluation) {
      evaluation.teacherFeedback = nextFeedback;
      evaluation.teacherEvaluationFeedback = nextFeedback;
    }
    showToast('Retour évaluation enregistré');

    try {
      await loadAll();
    } catch (refreshError) {
      console.warn('Evaluation feedback saved but reload failed:', refreshError);
    }
  } catch (error) {
    console.error('Save evaluation feedback failed:', {
      evalId,
      message: error?.message,
      code: error?.code,
      raw: error
    });
    showToast(`Erreur retour évaluation (${error?.code || 'inconnue'})`, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleAssignEvaluation(event) {
  event.preventDefault();

  const evaluatorId = elements.evaluatorSelect.value;
  const targetMealId = elements.targetMealSelect.value;

  if (!evaluatorId || !targetMealId) {
    showToast('Choisis élève + repas', 'error');
    return;
  }

  const evaluator = getStudentById(evaluatorId);
  const meal = state.meals.find((item) => item.id === targetMealId);
  const criteria = getCriteriaFromForm();

  if (!evaluator || !meal) {
    showToast('Données invalides', 'error');
    return;
  }

  if (!criteria.length) {
    showToast('Ajoute au moins 1 critère', 'error');
    return;
  }

  const duplicatePending = state.evaluations.some(
    (evaluation) =>
      evaluation.status === 'pending' &&
      evaluation.evaluatorId === evaluatorId &&
      evaluation.targetMealId === targetMealId
  );

  if (duplicatePending) {
    showToast('Cette évaluation existe déjà (en attente).', 'error');
    return;
  }

  if (evaluatorId === meal.studentId) {
    const ok = window.confirm('Même élève pour créer et évaluer. Continuer ?');
    if (!ok) {
      return;
    }
  }

  const submit = elements.assignEvalForm.querySelector('button[type="submit"]');
  setBusy(submit, true, 'Envoi...');

  try {
    await createEvaluation({
      evaluatorId: evaluator.id,
      evaluatorName: evaluator.name,
      targetStudentId: meal.studentId,
      targetStudentName: meal.studentName,
      targetMealId: meal.id,
      targetMealLabel: meal.mealLabel || '',
      targetMealDateMs: meal.createdAtMs || Date.now(),
      targetMealMedia: {
        photos: meal.photos || [],
        audios: meal.audios || []
      },
      criteria
    });

    await loadAll();
    showToast('Évaluation envoyée');
  } catch (error) {
    console.error(error);
    showToast('Erreur envoi évaluation', 'error');
  } finally {
    setBusy(submit, false);
  }
}

function mediaExt(item, fallback = 'bin') {
  const fromName = String(item?.name || '')
    .split('.')
    .pop()
    .toLowerCase();

  if (fromName && fromName.length < 8 && fromName !== String(item?.name || '').toLowerCase()) {
    return fromName;
  }

  const mime = String(item?.mimeType || '');
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('mp3') || mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('webm')) return 'webm';

  return fallback;
}

async function addMediaToZip(folder, media, prefix, updateStatus) {
  for (let i = 0; i < media.length; i += 1) {
    const item = media[i];
    const ext = mediaExt(item, prefix === 'photo' ? 'jpg' : 'webm');
    const base = safeName((item.name || `${prefix}_${i + 1}`).replace(/\.[^.]+$/, '')) || `${prefix}_${i + 1}`;
    const filename = `${String(i + 1).padStart(2, '0')}_${base}.${ext}`;

    try {
      updateStatus(`Téléchargement ${filename}`);

      if (item.url) {
        const response = await fetch(item.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        folder.file(filename, blob);
        continue;
      }

      if (item.path) {
        const blob = await downloadStorageBlob(item.path);
        folder.file(filename, blob);
        continue;
      }

      throw new Error('URL et path absents.');
    } catch (error) {
      try {
        if (item.path) {
          const blob = await downloadStorageBlob(item.path);
          folder.file(filename, blob);
          continue;
        }
      } catch (_fallbackError) {
        // Keep the original error below.
      }

      folder.file(
        `${filename}.error.txt`,
        `Échec téléchargement: ${String(error.message || error)} | path=${String(item.path || '')}`
      );
    }
  }
}

function toCsv(rows) {
  return rows
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

function evaluationAnswersSummary(evaluation) {
  const answers = Array.isArray(evaluation.response?.answers) ? evaluation.response.answers : [];
  if (!answers.length) {
    return '';
  }
  return answers
    .map((answer) => `${answer.criterionText || answer.criterionId || ''}: ${answer.text || ''}`.trim())
    .join(' | ');
}

async function handleExportZip() {
  if (!state.students.length && !state.meals.length) {
    showToast('Aucune donnée', 'error');
    return;
  }

  setBusy(elements.exportZipBtn, true, 'Préparation...');

  const updateStatus = (text) => {
    elements.exportStatus.textContent = text;
  };

  try {
    const zip = new JSZip();

    const summaryMeals = [['meal_id', 'eleve', 'meal_label', 'date', 'photos', 'audios', 'feedback_prof']];
    const summaryEvals = [
      [
        'evaluation_id',
        'statut',
        'evaluateur',
        'eleve_cible',
        'meal_id',
        'meal_label',
        'date_creation',
        'date_reponse',
        'feedback_prof'
      ]
    ];

    const studentsRoot = zip.folder('eleves');

    for (const student of state.students) {
      const studentFolderName = `${safeName(student.name) || 'eleve'}_${student.id.slice(0, 6)}`;
      const studentFolder = studentsRoot.folder(studentFolderName);

      const studentMeals = state.meals.filter((meal) => meal.studentId === student.id);
      if (!studentMeals.length) {
        studentFolder.file('AUCUN_REPAS.txt', 'Aucun repas enregistré.');
      } else {
        for (const meal of studentMeals) {
          const mealNameSafe = safeName(meal.mealLabel || 'sans_nom') || 'sans_nom';
          const mealFolderName = `repas_${formatDateForFile(meal.createdAtMs)}_${mealNameSafe}_${meal.id.slice(0, 6)}`;
          const mealFolder = studentFolder.folder(mealFolderName);

          summaryMeals.push([
            meal.id,
            meal.studentName,
            meal.mealLabel || '',
            formatDateTime(meal.createdAtMs),
            meal.photos?.length || 0,
            meal.audios?.length || 0,
            mealFeedbackOf(meal)
          ]);

          const metadata = {
            id: meal.id,
            studentId: meal.studentId,
            studentName: meal.studentName,
            mealLabel: meal.mealLabel || '',
            teacherFeedback: mealFeedbackOf(meal),
            createdAtMs: meal.createdAtMs,
            createdAtLabel: formatDateTime(meal.createdAtMs),
            photosCount: meal.photos?.length || 0,
            audiosCount: meal.audios?.length || 0
          };

          mealFolder.file('meta.json', JSON.stringify(metadata, null, 2));

          const photosFolder = mealFolder.folder('photos');
          await addMediaToZip(photosFolder, meal.photos || [], 'photo', updateStatus);

          const audiosFolder = mealFolder.folder('audios');
          await addMediaToZip(audiosFolder, meal.audios || [], 'audio', updateStatus);
        }
      }

      const studentEvalRows = [
        [
          'evaluation_id',
          'role',
          'statut',
          'evaluateur',
          'eleve_cible',
          'meal_id',
          'meal_label',
          'date_creation',
          'date_reponse',
          'feedback_prof',
          'reponses'
        ]
      ];

      state.evaluations
        .filter((evaluation) => evaluation.evaluatorId === student.id || evaluation.targetStudentId === student.id)
        .forEach((evaluation) => {
          const role =
            evaluation.evaluatorId === student.id && evaluation.targetStudentId === student.id
              ? 'donnee+recue'
              : evaluation.evaluatorId === student.id
                ? 'donnee'
                : 'recue';

          studentEvalRows.push([
            evaluation.id,
            role,
            evaluation.status || 'pending',
            evaluation.evaluatorName || '',
            evaluation.targetStudentName || '',
            evaluation.targetMealId || '',
            evaluation.targetMealLabel || '',
            formatDateTime(evaluation.createdAtMs),
            formatDateTime(evaluation.completedAtMs),
            evaluationFeedbackOf(evaluation),
            evaluationAnswersSummary(evaluation)
          ]);
        });

      studentFolder.file('evaluations.csv', toCsv(studentEvalRows));
    }

    for (const evaluation of state.evaluations) {
      summaryEvals.push([
        evaluation.id,
        evaluation.status || 'pending',
        evaluation.evaluatorName || '',
        evaluation.targetStudentName || '',
        evaluation.targetMealId || '',
        evaluation.targetMealLabel || '',
        formatDateTime(evaluation.createdAtMs),
        formatDateTime(evaluation.completedAtMs),
        evaluationFeedbackOf(evaluation)
      ]);
    }

    zip.file('resume_repas.csv', toCsv(summaryMeals));
    zip.file('resume_evaluations.csv', toCsv(summaryEvals));

    updateStatus('Compression ZIP...');
    const blob = await zip.generateAsync({ type: 'blob' });

    const filename = `RepasParle_export_${formatDateForFile(Date.now())}.zip`;
    const url = URL.createObjectURL(blob);

    if (state.lastExportUrl) {
      URL.revokeObjectURL(state.lastExportUrl);
    }
    state.lastExportUrl = url;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.textContent = `Télécharger ${filename}`;

    elements.exportStatus.textContent = 'ZIP prêt. ';
    elements.exportStatus.appendChild(link);

    // Attempt auto-download; if browser blocks it, manual link remains visible.
    link.click();
    showToast('ZIP prêt');
  } catch (error) {
    console.error(error);
    updateStatus('Échec export');
    showToast(`Erreur export ZIP (${error?.code || 'inconnue'})`, 'error');
  } finally {
    setBusy(elements.exportZipBtn, false);
  }
}

function bindEvents() {
  elements.refreshBtn.addEventListener('click', async () => {
    try {
      await loadAll();
      showToast('Actualisé');
    } catch (error) {
      console.error(error);
      showToast('Erreur chargement', 'error');
    }
  });

  elements.addStudentForm.addEventListener('submit', handleAddStudent);

  elements.studentsList.addEventListener('click', async (event) => {
    const button = event.target.closest('.delete-student-btn');
    if (!button) {
      return;
    }
    await handleDeleteStudent(button.dataset.studentId, button);
  });

  elements.mealFilterStudent.addEventListener('change', (event) => {
    state.mealFilter = event.target.value;
    renderTeacherMeals();
  });

  elements.addCriterionBtn.addEventListener('click', () => addCriterionField(''));

  elements.assignEvalForm.addEventListener('submit', handleAssignEvaluation);

  elements.teacherMealsList.addEventListener('click', async (event) => {
    const saveBtn = event.target.closest('.save-meal-feedback-btn');
    if (saveBtn) {
      const card = saveBtn.closest('.meal-card[data-meal-id]');
      const textarea = card?.querySelector('.meal-feedback-input');
      if (textarea) {
        const mealId = card?.dataset.mealId || '';
        await handleSaveMealFeedback(mealId, textarea, saveBtn);
      } else {
        showToast('Impossible de lire le champ retour repas', 'error');
      }
      return;
    }

    const deleteBtn = event.target.closest('.delete-meal-btn');
    if (deleteBtn) {
      await handleDeleteMeal(deleteBtn.dataset.mealId, deleteBtn);
    }
  });

  elements.teacherEvaluationsList.addEventListener('click', async (event) => {
    const saveBtn = event.target.closest('.save-eval-feedback-btn');
    if (saveBtn) {
      const card = saveBtn.closest('.eval-card[data-eval-id]');
      const textarea = card?.querySelector('.evaluation-feedback-input');
      if (textarea) {
        const evalId = card?.dataset.evalId || '';
        await handleSaveEvaluationFeedback(evalId, textarea, saveBtn);
      } else {
        showToast('Impossible de lire le champ retour évaluation', 'error');
      }
      return;
    }

    const deleteBtn = event.target.closest('.delete-eval-btn');
    if (deleteBtn) {
      await handleDeleteEvaluation(deleteBtn.dataset.evalId, deleteBtn);
    }
  });

  elements.exportZipBtn.addEventListener('click', handleExportZip);
}

function initCriteriaDefaults() {
  elements.criteriaList.innerHTML = '';
  addCriterionField('Je comprends le repas ?');
  addCriterionField('Un conseil simple pour mieux parler ?');
}

function initFirebaseGuard() {
  if (firebaseReady) {
    hideWarning(elements.firebaseWarning);
    return true;
  }

  showWarning(
    elements.firebaseWarning,
    `Firebase non configuré. Clés à compléter: ${missingConfigKeys.join(', ')} dans js/firebase-config.js`
  );
  disableAll();
  return false;
}

async function init() {
  bindEvents();
  initCriteriaDefaults();
  initImageLightbox();

  window.addEventListener('beforeunload', () => {
    if (state.lastExportUrl) {
      URL.revokeObjectURL(state.lastExportUrl);
    }
  });

  if (!initFirebaseGuard()) {
    return;
  }

  try {
    await loadAll();
  } catch (error) {
    console.error(error);
    showToast('Erreur chargement', 'error');
  }
}

init();
