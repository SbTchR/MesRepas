import {
  firebaseReady,
  missingConfigKeys,
  fetchStudents,
  fetchMealsByStudent,
  fetchEvaluationsByEvaluator,
  fetchEvaluationsByTarget,
  uploadMealFile,
  saveMeal,
  updateMeal,
  deleteMealDoc,
  deleteStoragePath,
  submitEvaluationResponse
} from './firebase-service.js';

import {
  formatDateTime,
  showWarning,
  hideWarning,
  showToast,
  createMediaThumb,
  createAudioDraftItem,
  buildMediaSection,
  setBusy,
  initImageLightbox
} from './app-common.js';

import { anonymizeAudioFile, supportsVoiceAnonymization } from './audio-privacy.js';
import { prepareSanitizedImage, supportsImageSanitization } from './image-privacy.js';

const elements = {
  firebaseWarning: document.getElementById('firebaseWarning'),
  refreshBtn: document.getElementById('refreshStudentBtn'),
  studentSelect: document.getElementById('studentSelect'),
  studentHint: document.getElementById('studentHint'),
  mealTitleInput: document.getElementById('mealTitleInput'),
  editMealHint: document.getElementById('editMealHint'),
  existingPhotosTitle: document.getElementById('existingPhotosTitle'),
  existingPhotoList: document.getElementById('existingPhotoList'),
  existingAudiosTitle: document.getElementById('existingAudiosTitle'),
  existingAudioList: document.getElementById('existingAudioList'),
  photoActionBtn: document.getElementById('photoActionBtn'),
  photoActionMenu: document.getElementById('photoActionMenu'),
  photoTakeBtn: document.getElementById('photoTakeBtn'),
  photoLibraryBtn: document.getElementById('photoLibraryBtn'),
  photoFileBtn: document.getElementById('photoFileBtn'),
  photoCameraInput: document.getElementById('photoCameraInput'),
  photoLibraryInput: document.getElementById('photoLibraryInput'),
  photoFileInput: document.getElementById('photoFileInput'),
  photoPrivacyHint: document.getElementById('photoPrivacyHint'),
  photoPrivacyReview: document.getElementById('photoPrivacyReview'),
  photoPrivacyReviewList: document.getElementById('photoPrivacyReviewList'),
  applyPhotoReviewBtn: document.getElementById('applyPhotoReviewBtn'),
  cancelPhotoReviewBtn: document.getElementById('cancelPhotoReviewBtn'),
  photoDraftList: document.getElementById('photoDraftList'),
  audioInput: document.getElementById('audioInput'),
  audioDraftList: document.getElementById('audioDraftList'),
  recordBtn: document.getElementById('recordBtn'),
  voicePrivacyHint: document.getElementById('voicePrivacyHint'),
  cancelEditMealBtn: document.getElementById('cancelEditMealBtn'),
  clearDraftBtn: document.getElementById('clearDraftBtn'),
  saveMealBtn: document.getElementById('saveMealBtn'),
  uploadProgressWrap: document.getElementById('uploadProgressWrap'),
  uploadProgressText: document.getElementById('uploadProgressText'),
  uploadProgressFill: document.getElementById('uploadProgressFill'),
  mealsList: document.getElementById('mealsList'),
  evaluationList: document.getElementById('evaluationList'),
  receivedEvaluationList: document.getElementById('receivedEvaluationList')
};

const state = {
  students: [],
  selectedStudentId: '',
  meals: [],
  evaluations: [],
  receivedEvaluations: [],
  draftPhotos: [],
  draftAudios: [],
  editingMealId: null,
  editingOriginalMeal: null,
  editingExistingPhotos: [],
  editingExistingAudios: [],
  mediaRecorder: null,
  recorderStream: null,
  recordingChunks: [],
  recordingMimeType: '',
  processingAudio: false,
  processingPhotos: false,
  pendingPhotoReview: [],
  photoSourceMenuOpen: false
};

function getSelectedStudent() {
  return state.students.find((s) => s.id === state.selectedStudentId) || null;
}

function currentMealLabel() {
  return String(elements.mealTitleInput?.value || '').trim();
}

function mealLabelForDisplay(meal) {
  return meal.mealLabel || 'Repas sans nom';
}

function mealFeedbackOf(meal) {
  return meal.teacherMealFeedback || meal.teacherFeedback || '';
}

function evaluationFeedbackOf(evaluation) {
  return evaluation.teacherEvaluationFeedback || evaluation.teacherFeedback || '';
}

function isEditingMeal() {
  return Boolean(state.editingMealId);
}

function isLikelyImageFile(file) {
  if (String(file?.type || '').toLowerCase().startsWith('image/')) {
    return true;
  }

  return /\.(jpg|jpeg|png|webp|heic|heif|avif)$/i.test(String(file?.name || ''));
}

function totalMediaInForm() {
  if (!isEditingMeal()) {
    return state.draftPhotos.length + state.draftAudios.length;
  }
  return (
    state.editingExistingPhotos.length +
    state.editingExistingAudios.length +
    state.draftPhotos.length +
    state.draftAudios.length
  );
}

function isReadyForSave() {
  return Boolean(state.selectedStudentId) && totalMediaInForm() > 0;
}

function setSaveButtonLabel(label) {
  elements.saveMealBtn.dataset.normalLabel = label;
  elements.saveMealBtn.textContent = label;
}

function hasPendingPhotoReview() {
  return state.pendingPhotoReview.length > 0;
}

function isProcessingMedia() {
  return state.processingAudio || state.processingPhotos;
}

function isRecordingAudio() {
  return Boolean(state.mediaRecorder && state.mediaRecorder.state === 'recording');
}

function setPhotoSourceMenuOpen(open) {
  state.photoSourceMenuOpen = Boolean(open);

  if (!elements.photoActionMenu || !elements.photoActionBtn) {
    return;
  }

  elements.photoActionMenu.classList.toggle('hidden', !state.photoSourceMenuOpen);
  elements.photoActionBtn.setAttribute('aria-expanded', state.photoSourceMenuOpen ? 'true' : 'false');
}

function togglePhotoSourceMenu() {
  setPhotoSourceMenuOpen(!state.photoSourceMenuOpen);
}

function closePhotoSourceMenu() {
  setPhotoSourceMenuOpen(false);
}

function syncRecordButtonLabel() {
  if (!elements.recordBtn) {
    return;
  }

  if (state.processingAudio) {
    elements.recordBtn.textContent = 'Traitement audio...';
    return;
  }

  elements.recordBtn.textContent = isRecordingAudio() ? 'Stop audio' : 'Démarrer audio';
}

function updatePhotoPrivacyHint() {
  if (!elements.photoPrivacyHint) {
    return;
  }

  let message = 'La photo est nettoyee sur cet appareil. Les infos cachees seront affichees avant ajout.';
  let warning = false;

  if (!supportsImageSanitization()) {
    message = "Cet appareil ne peut pas nettoyer les photos localement. L'ajout de nouvelles photos est desactive pour eviter l'envoi des metadonnees.";
    warning = true;
  } else if (hasPendingPhotoReview()) {
    message = 'Lis les infos retirees ci-dessous puis ajoute la photo propre.';
  }

  elements.photoPrivacyHint.textContent = message;
  elements.photoPrivacyHint.classList.toggle('is-warning', warning);
}

function updateVoicePrivacyHint() {
  if (!elements.voicePrivacyHint) {
    return;
  }

  let message = "L'audio enregistré ici est transformé sur cet appareil avant l'envoi.";
  let warning = false;

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    message = "Cet appareil ne permet pas l'enregistrement audio direct.";
    warning = true;
  } else if (!supportsVoiceAnonymization()) {
    message =
      "Cet appareil ne peut pas anonymiser la voix localement. L'enregistrement audio direct est désactivé pour éviter l'envoi de la voix brute.";
    warning = true;
  }

  elements.voicePrivacyHint.textContent = message;
  elements.voicePrivacyHint.classList.toggle('is-warning', warning);
}

function pickRecordingMimeType() {
  if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find((mimeType) => window.MediaRecorder.isTypeSupported(mimeType)) || '';
}

function releaseRecorder() {
  if (state.recorderStream) {
    state.recorderStream.getTracks().forEach((track) => track.stop());
  }

  state.recorderStream = null;
  state.mediaRecorder = null;
  state.recordingChunks = [];
  state.recordingMimeType = '';
  syncRecordButtonLabel();
}

function disableAll() {
  [
    elements.studentSelect,
    elements.mealTitleInput,
    elements.photoActionBtn,
    elements.audioInput,
    elements.recordBtn,
    elements.cancelEditMealBtn,
    elements.clearDraftBtn,
    elements.saveMealBtn,
    elements.refreshBtn
  ].forEach((el) => {
    if (el) {
      el.disabled = true;
    }
  });
}

function updateEditModeUI() {
  if (isEditingMeal()) {
    elements.editMealHint.classList.remove('hidden');
    elements.editMealHint.classList.add('edit-hint');
    elements.editMealHint.textContent = 'Mode modification: tu peux enlever ou ajouter des médias.';
    elements.cancelEditMealBtn.classList.remove('hidden');
    setSaveButtonLabel('Enregistrer modif');
    return;
  }

  elements.editMealHint.classList.add('hidden');
  elements.editMealHint.classList.remove('edit-hint');
  elements.editMealHint.textContent = '';
  elements.cancelEditMealBtn.classList.add('hidden');
  setSaveButtonLabel('Enregistrer repas');
}

function updateControlsState() {
  const canWork = Boolean(state.selectedStudentId);
  const photoSelectionLocked = isProcessingMedia() || hasPendingPhotoReview();
  elements.studentSelect.disabled = isProcessingMedia() || hasPendingPhotoReview();
  if (elements.refreshBtn) {
    elements.refreshBtn.disabled = isProcessingMedia() || hasPendingPhotoReview();
  }
  elements.mealTitleInput.disabled = !canWork || isProcessingMedia() || hasPendingPhotoReview();
  if (elements.photoActionBtn) {
    elements.photoActionBtn.disabled = !canWork || photoSelectionLocked || !supportsImageSanitization();
  }
  if (elements.audioInput) {
    elements.audioInput.disabled = !canWork || isProcessingMedia() || hasPendingPhotoReview();
  }
  elements.cancelEditMealBtn.disabled = !canWork || isProcessingMedia() || hasPendingPhotoReview();
  elements.clearDraftBtn.disabled = !canWork || isProcessingMedia() || hasPendingPhotoReview();
  elements.recordBtn.disabled =
    !canWork ||
    isProcessingMedia() ||
    hasPendingPhotoReview() ||
    !navigator.mediaDevices ||
    !window.MediaRecorder ||
    !supportsVoiceAnonymization();
  elements.saveMealBtn.disabled = isProcessingMedia() || hasPendingPhotoReview() || !isReadyForSave();
  if (elements.applyPhotoReviewBtn) {
    elements.applyPhotoReviewBtn.disabled = isProcessingMedia() || !hasPendingPhotoReview();
  }
  if (elements.cancelPhotoReviewBtn) {
    elements.cancelPhotoReviewBtn.disabled = isProcessingMedia() || !hasPendingPhotoReview();
  }
  syncRecordButtonLabel();
  if (!canWork || photoSelectionLocked || !supportsImageSanitization()) {
    closePhotoSourceMenu();
  } else {
    setPhotoSourceMenuOpen(state.photoSourceMenuOpen);
  }
  updatePhotoPrivacyHint();
  updateVoicePrivacyHint();
}

function renderStudentSelect() {
  const previous = state.selectedStudentId;
  elements.studentSelect.innerHTML = '<option value="">Choisir...</option>';

  state.students.forEach((student) => {
    const opt = document.createElement('option');
    opt.value = student.id;
    opt.textContent = student.name;
    elements.studentSelect.appendChild(opt);
  });

  if (state.students.some((student) => student.id === previous)) {
    state.selectedStudentId = previous;
  } else {
    state.selectedStudentId = state.students[0]?.id || '';
  }

  elements.studentSelect.value = state.selectedStudentId;
  elements.studentHint.textContent = state.selectedStudentId ? 'OK.' : 'Ajoute un nom dans la vue gestion.';
}

function renderDraftPhotos() {
  elements.photoDraftList.innerHTML = '';

  state.draftPhotos.forEach((file, index) => {
    elements.photoDraftList.appendChild(
      createMediaThumb(file, index, (idx) => {
        state.draftPhotos.splice(idx, 1);
        renderDraftPhotos();
        updateControlsState();
      })
    );
  });
}

function renderPhotoReview() {
  if (!elements.photoPrivacyReview || !elements.photoPrivacyReviewList) {
    return;
  }

  elements.photoPrivacyReviewList.innerHTML = '';

  if (!hasPendingPhotoReview()) {
    elements.photoPrivacyReview.classList.add('hidden');
    return;
  }

  state.pendingPhotoReview.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'privacy-review-card';

    const media = document.createElement('div');
    media.className = 'privacy-review-media';

    const img = document.createElement('img');
    const previewUrl = URL.createObjectURL(item.sanitizedFile);
    img.src = previewUrl;
    img.alt = item.originalName || `Photo ${index + 1}`;
    img.addEventListener(
      'load',
      () => {
        URL.revokeObjectURL(previewUrl);
      },
      { once: true }
    );
    img.addEventListener(
      'error',
      () => {
        URL.revokeObjectURL(previewUrl);
      },
      { once: true }
    );

    const fileInfo = document.createElement('div');
    fileInfo.className = 'privacy-review-file';

    const title = document.createElement('strong');
    title.textContent = item.originalName || `Photo ${index + 1}`;

    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${item.formatLabel || 'Image'} nettoyee localement`;

    fileInfo.append(title, meta);
    media.append(img, fileInfo);

    const details = document.createElement('div');

    if (item.metadataGroups?.length) {
      item.metadataGroups.forEach((group) => {
        const title = document.createElement('p');
        title.className = 'privacy-review-group-title';
        title.textContent = group.title;

        const list = document.createElement('ul');
        list.className = 'privacy-review-meta-list';

        group.items.forEach((entry) => {
          const li = document.createElement('li');
          li.textContent = `${entry.label}: ${entry.value}`;
          list.appendChild(li);
        });

        details.append(title, list);
      });
    } else if (item.removedMetadata.length) {
      const list = document.createElement('ul');
      list.className = 'privacy-review-meta-list';

      item.removedMetadata.forEach((entry) => {
        const li = document.createElement('li');
        li.textContent = `${entry.label}: ${entry.value}`;
        list.appendChild(li);
      });

      details.appendChild(list);
    } else {
      const note = document.createElement('p');
      note.className = 'privacy-review-note';
      note.textContent =
        item.formatLabel && !['JPEG', 'PNG'].includes(item.formatLabel)
          ? `Aucune metadonnee lisible n'a ete detectee dans ce fichier ${item.formatLabel}. Selon le telephone et le navigateur, il peut deja etre simplifie ou ne contenir aucune information visible, mais l'image sera quand meme reencodee pour retirer les balises cachees.`
          : "Aucune metadonnee lisible n'a ete detectee, mais l'image sera quand meme reencodee pour retirer les balises cachees.";
      details.appendChild(note);
    }

    card.append(media, details);
    elements.photoPrivacyReviewList.appendChild(card);
  });

  elements.photoPrivacyReview.classList.remove('hidden');
}

function renderDraftAudios() {
  elements.audioDraftList.innerHTML = '';

  state.draftAudios.forEach((file, index) => {
    elements.audioDraftList.appendChild(
      createAudioDraftItem(file, index, (idx) => {
        state.draftAudios.splice(idx, 1);
        renderDraftAudios();
        updateControlsState();
      })
    );
  });
}

function renderExistingEditMedia() {
  elements.existingPhotoList.innerHTML = '';
  elements.existingAudioList.innerHTML = '';

  if (!isEditingMeal()) {
    elements.existingPhotosTitle.classList.add('hidden');
    elements.existingAudiosTitle.classList.add('hidden');
    return;
  }

  if (state.editingExistingPhotos.length) {
    elements.existingPhotosTitle.classList.remove('hidden');

    state.editingExistingPhotos.forEach((photo, index) => {
      const box = document.createElement('div');
      box.className = 'thumb-wrap';

      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = photo.name || `Photo ${index + 1}`;
      img.className = 'zoomable-image';
      img.dataset.caption = photo.name || `Photo ${index + 1}`;

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'remove-thumb-btn';
      rm.textContent = 'x';
      rm.addEventListener('click', () => {
        state.editingExistingPhotos.splice(index, 1);
        renderExistingEditMedia();
        updateControlsState();
      });

      box.append(img, rm);
      elements.existingPhotoList.appendChild(box);
    });
  } else {
    elements.existingPhotosTitle.classList.add('hidden');
  }

  if (state.editingExistingAudios.length) {
    elements.existingAudiosTitle.classList.remove('hidden');

    state.editingExistingAudios.forEach((audio, index) => {
      const row = document.createElement('div');
      row.className = 'audio-item';

      const left = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'meta';
      title.textContent = audio.name || `Audio ${index + 1}`;

      const player = document.createElement('audio');
      player.controls = true;
      player.src = audio.url;

      left.append(title, player);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'danger-btn';
      rm.textContent = 'Supprimer';
      rm.addEventListener('click', () => {
        state.editingExistingAudios.splice(index, 1);
        renderExistingEditMedia();
        updateControlsState();
      });

      row.append(left, rm);
      elements.existingAudioList.appendChild(row);
    });
  } else {
    elements.existingAudiosTitle.classList.add('hidden');
  }
}

function clearDraft({ clearLabel = false } = {}) {
  state.draftPhotos = [];
  state.draftAudios = [];
  state.pendingPhotoReview = [];

  if (clearLabel) {
    elements.mealTitleInput.value = '';
  }

  renderPhotoReview();
  renderDraftPhotos();
  renderDraftAudios();
  updateControlsState();
}

function resetEditMeal({ clearLabel = false } = {}) {
  state.editingMealId = null;
  state.editingOriginalMeal = null;
  state.editingExistingPhotos = [];
  state.editingExistingAudios = [];
  state.pendingPhotoReview = [];

  if (clearLabel) {
    elements.mealTitleInput.value = '';
  }

  renderPhotoReview();
  renderExistingEditMedia();
  updateEditModeUI();
  updateControlsState();
}

function enterEditMeal(mealId) {
  const meal = state.meals.find((item) => item.id === mealId);
  if (!meal) {
    showToast('Repas introuvable', 'error');
    return;
  }

  state.editingMealId = meal.id;
  state.editingOriginalMeal = {
    id: meal.id,
    photos: [...(meal.photos || [])],
    audios: [...(meal.audios || [])]
  };
  state.editingExistingPhotos = [...(meal.photos || [])];
  state.editingExistingAudios = [...(meal.audios || [])];

  elements.mealTitleInput.value = meal.mealLabel || '';
  clearDraft();
  renderExistingEditMedia();
  updateEditModeUI();
  updateControlsState();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('Tu modifies ce repas');
}

function setUploadProgress(value) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  elements.uploadProgressWrap.classList.remove('hidden');
  elements.uploadProgressText.textContent = `${percent}%`;
  elements.uploadProgressFill.style.width = `${percent}%`;
  elements.uploadProgressFill.parentElement.setAttribute('aria-valuenow', String(percent));
}

function hideUploadProgress() {
  elements.uploadProgressWrap.classList.add('hidden');
}

function uploadErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'storage/unauthorized') return 'Storage bloqué: vérifie les règles.';
  if (code === 'storage/bucket-not-found') return 'Storage manquant: active Storage.';
  if (code === 'storage/project-not-found') return 'Projet Firebase introuvable.';
  if (code === 'storage/quota-exceeded') return 'Quota Storage dépassé.';
  if (code) return `Erreur envoi (${code})`;
  return 'Erreur envoi repas';
}

function appendFeedbackBlock(parent, text) {
  if (!text) {
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'feedback-wrap';

  const title = document.createElement('p');
  title.className = 'feedback-title';
  title.textContent = 'Retour prof';

  const content = document.createElement('p');
  content.className = 'feedback-text';
  content.textContent = text;

  wrap.append(title, content);
  parent.appendChild(wrap);
}

function mealCard(meal) {
  const card = document.createElement('article');
  card.className = 'meal-card';

  const head = document.createElement('div');
  head.className = 'card-head';

  const left = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = mealLabelForDisplay(meal);

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${formatDateTime(meal.createdAtMs)} - ${meal.photos?.length || 0} photo(s), ${meal.audios?.length || 0} audio(s)`;
  left.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'teacher-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'ghost-btn edit-meal-btn';
  editBtn.dataset.mealId = meal.id;
  editBtn.textContent = 'Modifier';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'danger-btn delete-meal-btn';
  delBtn.dataset.mealId = meal.id;
  delBtn.textContent = 'Supprimer';

  actions.append(editBtn, delBtn);

  head.append(left, actions);
  card.append(head, buildMediaSection({ photos: meal.photos || [], audios: meal.audios || [] }));
  appendFeedbackBlock(card, mealFeedbackOf(meal));

  return card;
}

function renderMeals() {
  elements.mealsList.innerHTML = '';

  if (!state.selectedStudentId) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Choisis ton nom.';
    elements.mealsList.appendChild(p);
    return;
  }

  if (!state.meals.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Aucun repas.';
    elements.mealsList.appendChild(p);
    return;
  }

  state.meals.forEach((meal) => elements.mealsList.appendChild(mealCard(meal)));
}

function evaluationCard(evaluation) {
  const card = document.createElement('article');
  card.className = 'eval-card';

  const head = document.createElement('div');
  head.className = 'card-head';

  const left = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = evaluation.status === 'done' ? 'Évaluation envoyée (modifiable)' : 'Évaluation à faire';

  const mealLabel = evaluation.targetMealLabel ? `${evaluation.targetMealLabel} - ` : '';
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `Repas de ${evaluation.targetStudentName}: ${mealLabel}${formatDateTime(evaluation.targetMealDateMs)}`;
  left.append(title, meta);

  const badge = document.createElement('span');
  badge.className = 'chip';
  badge.textContent = evaluation.status === 'done' ? 'Fait' : 'À faire';

  head.append(left, badge);
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
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Pas de critère.';
    card.appendChild(empty);
    appendFeedbackBlock(card, evaluationFeedbackOf(evaluation));
    return card;
  }

  const form = document.createElement('form');
  form.dataset.evalId = evaluation.id;
  form.className = 'stack';

  if (evaluation.status === 'done') {
    const editableHint = document.createElement('p');
    editableHint.className = 'hint';
    editableHint.textContent = 'Tu peux modifier tes réponses.';
    form.appendChild(editableHint);
  }

  criteria.forEach((criterion) => {
    const label = document.createElement('label');
    label.textContent = criterion.text;

    const area = document.createElement('textarea');
    area.required = true;
    area.name = `criterion_${criterion.id}`;
    area.placeholder = 'Écris ici';

    const responseItem = evaluation.response?.answers?.find((a) => a.criterionId === criterion.id);
    area.value = responseItem?.text || '';

    form.append(label, area);
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-btn';
  submit.textContent = evaluation.status === 'done' ? 'Mettre à jour' : 'Envoyer';
  form.appendChild(submit);

  card.appendChild(form);
  appendFeedbackBlock(card, evaluationFeedbackOf(evaluation));
  return card;
}

function renderEvaluations() {
  elements.evaluationList.innerHTML = '';

  if (!state.selectedStudentId) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Choisis ton nom.';
    elements.evaluationList.appendChild(p);
    return;
  }

  if (!state.evaluations.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Aucune évaluation.';
    elements.evaluationList.appendChild(p);
    return;
  }

  state.evaluations.forEach((evaluation) => elements.evaluationList.appendChild(evaluationCard(evaluation)));
}

function receivedEvaluationCard(evaluation) {
  const card = document.createElement('article');
  card.className = 'eval-card';

  const head = document.createElement('div');
  head.className = 'card-head';

  const left = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = evaluation.status === 'done' ? 'Évaluation reçue' : 'Évaluation en attente';

  const mealLabel = evaluation.targetMealLabel ? `${evaluation.targetMealLabel} - ` : '';
  const author = evaluation.evaluatorName || 'Prof';
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `Par ${author} | ${mealLabel}${formatDateTime(evaluation.targetMealDateMs)}`;
  left.append(title, meta);

  const badge = document.createElement('span');
  badge.className = 'chip';
  badge.textContent = evaluation.status === 'done' ? 'Visible' : 'Bientôt';

  head.append(left, badge);
  card.appendChild(head);

  if (evaluation.status !== 'done') {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'L’évaluateur n’a pas encore répondu.';
    card.appendChild(p);
    appendFeedbackBlock(card, evaluationFeedbackOf(evaluation));
    return card;
  }

  const criteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];
  if (!criteria.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Pas de critère.';
    card.appendChild(p);
    appendFeedbackBlock(card, evaluationFeedbackOf(evaluation));
    return card;
  }

  criteria.forEach((criterion) => {
    const block = document.createElement('div');
    block.className = 'answer-box';

    const q = document.createElement('p');
    q.className = 'card-title';
    q.textContent = criterion.text;

    const responseItem = evaluation.response?.answers?.find((a) => a.criterionId === criterion.id);
    const a = document.createElement('p');
    a.textContent = responseItem?.text || '(vide)';

    block.append(q, a);
    card.appendChild(block);
  });

  appendFeedbackBlock(card, evaluationFeedbackOf(evaluation));
  return card;
}

function renderReceivedEvaluations() {
  elements.receivedEvaluationList.innerHTML = '';

  if (!state.selectedStudentId) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Choisis ton nom.';
    elements.receivedEvaluationList.appendChild(p);
    return;
  }

  if (!state.receivedEvaluations.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Aucune évaluation reçue.';
    elements.receivedEvaluationList.appendChild(p);
    return;
  }

  state.receivedEvaluations.forEach((evaluation) =>
    elements.receivedEvaluationList.appendChild(receivedEvaluationCard(evaluation))
  );
}

async function loadStudents() {
  state.students = await fetchStudents();
  renderStudentSelect();
}

async function loadCurrentStudentData() {
  if (!state.selectedStudentId) {
    state.meals = [];
    state.evaluations = [];
    state.receivedEvaluations = [];

    renderMeals();
    renderEvaluations();
    renderReceivedEvaluations();
    updateControlsState();
    return;
  }

  const [meals, evaluations, receivedEvaluations] = await Promise.all([
    fetchMealsByStudent(state.selectedStudentId),
    fetchEvaluationsByEvaluator(state.selectedStudentId),
    fetchEvaluationsByTarget(state.selectedStudentId)
  ]);

  state.meals = meals;
  state.evaluations = evaluations;
  state.receivedEvaluations = receivedEvaluations;

  if (state.editingMealId && !state.meals.some((meal) => meal.id === state.editingMealId)) {
    resetEditMeal({ clearLabel: true });
    clearDraft();
  }

  renderMeals();
  renderEvaluations();
  renderReceivedEvaluations();
  updateControlsState();
}

async function loadAll() {
  try {
    await loadStudents();
    await loadCurrentStudentData();
  } catch (error) {
    console.error(error);
    showToast('Erreur de chargement', 'error');
  }
}

function bindFileInputs() {
  const handlePhotoSelection = async (event) => {
    const files = [...(event.target.files || [])].filter(isLikelyImageFile);
    const hadFiles = Boolean(event.target.files?.length);
    event.target.value = '';
    if (hadFiles && !files.length) {
      showToast('Choisis un fichier image.', 'error');
      return;
    }
    await preparePhotosForReview(files);
  };

  [elements.photoCameraInput, elements.photoLibraryInput, elements.photoFileInput].forEach((input) => {
    if (input) {
      input.addEventListener('change', handlePhotoSelection);
    }
  });

  if (elements.audioInput) {
    elements.audioInput.addEventListener('change', async (event) => {
      const files = [...(event.target.files || [])].filter((file) => file.type.startsWith('audio/'));
      elements.audioInput.value = '';
      await addAudioFilesToDraft(files);
    });
  }
}

async function preparePhotosForReview(files) {
  if (!files.length) {
    return;
  }

  state.processingPhotos = true;
  state.pendingPhotoReview = [];
  renderPhotoReview();
  updateControlsState();

  const prepared = [];
  let failedCount = 0;

  try {
    for (const file of files) {
      try {
        const sanitized = await prepareSanitizedImage(file);
        prepared.push({
          originalName: file.name,
          sanitizedFile: sanitized.sanitizedFile,
          removedMetadata: sanitized.removedMetadata,
          metadataGroups: sanitized.metadataGroups,
          formatLabel: sanitized.formatLabel
        });
      } catch (error) {
        failedCount += 1;
        console.error('Image sanitization failed:', file?.name, error);
      }
    }

    state.pendingPhotoReview = prepared;
    renderPhotoReview();

    if (prepared.length) {
      const successMessage = failedCount
        ? `${prepared.length} photo(s) pretes. ${failedCount} impossible(s).`
        : 'Lis les infos retirees, puis ajoute la photo propre.';
      showToast(successMessage);
    } else {
      showToast('Aucune photo n a pu etre nettoyee.', 'error');
    }
  } finally {
    state.processingPhotos = false;
    updateControlsState();
  }
}

function applyPendingPhotoReview() {
  if (!hasPendingPhotoReview()) {
    return;
  }

  state.draftPhotos.push(...state.pendingPhotoReview.map((item) => item.sanitizedFile));
  state.pendingPhotoReview = [];
  renderPhotoReview();
  renderDraftPhotos();
  updateControlsState();
  showToast('Photo propre ajoutee');
}

function cancelPendingPhotoReview() {
  if (!hasPendingPhotoReview()) {
    return;
  }

  state.pendingPhotoReview = [];
  renderPhotoReview();
  updateControlsState();
  showToast('Ajout photo annule');
}

function triggerPhotoInput(input) {
  if (!input || input.disabled) {
    return;
  }

  closePhotoSourceMenu();
  input.click();
}

async function addAudioFilesToDraft(files) {
  if (!files.length) {
    return;
  }

  state.processingAudio = true;
  updateControlsState();

  let addedCount = 0;

  try {
    for (const file of files) {
      const anonymizedFile = await anonymizeAudioFile(file);
      state.draftAudios.push(anonymizedFile);
      addedCount += 1;
    }

    renderDraftAudios();

    if (addedCount) {
      showToast(addedCount > 1 ? `${addedCount} audios anonymisés ajoutés` : 'Audio anonymisé ajouté');
    }
  } catch (error) {
    console.error('Audio anonymization failed:', error);
    showToast('Transformation audio impossible. Audio non conservé.', 'error');
  } finally {
    state.processingAudio = false;
    updateControlsState();
  }
}

async function finalizeRecordedAudio(chunks, mimeType) {
  if (!chunks.length) {
    showToast('Audio vide', 'error');
    return;
  }

  state.processingAudio = true;
  updateControlsState();

  try {
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    const extension = mimeType?.includes('ogg') ? 'ogg' : mimeType?.includes('mp4') ? 'm4a' : 'webm';
    const rawFile = new File([blob], `audio-${Date.now()}.${extension}`, {
      type: mimeType || 'audio/webm',
      lastModified: Date.now()
    });
    const anonymizedFile = await anonymizeAudioFile(rawFile);

    state.draftAudios.push(anonymizedFile);
    renderDraftAudios();
    showToast('Audio anonymisé ajouté');
  } catch (error) {
    console.error('Recorded audio anonymization failed:', error);
    showToast('Transformation audio impossible. Audio non conservé.', 'error');
  } finally {
    state.processingAudio = false;
    updateControlsState();
  }
}

async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder || !supportsVoiceAnonymization()) {
    showToast("Enregistrement audio direct indisponible sur cet appareil.", 'error');
    return;
  }

  try {
    state.recorderStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    state.recordingChunks = [];
    state.recordingMimeType = pickRecordingMimeType();
    state.mediaRecorder = state.recordingMimeType
      ? new MediaRecorder(state.recorderStream, { mimeType: state.recordingMimeType })
      : new MediaRecorder(state.recorderStream);
    const recorder = state.mediaRecorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.recordingChunks.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      console.error('MediaRecorder error:', event?.error || event);
      releaseRecorder();
      state.processingAudio = false;
      updateControlsState();
      showToast('Erreur enregistrement micro', 'error');
    };

    recorder.onstop = async () => {
      const chunks = [...state.recordingChunks];
      const mimeType = state.recordingMimeType || recorder.mimeType || 'audio/webm';
      releaseRecorder();
      await finalizeRecordedAudio(chunks, mimeType);
    };

    recorder.start();
    updateControlsState();
    showToast('Enregistrement...');
  } catch (error) {
    console.error(error);
    releaseRecorder();
    showToast('Micro refusé', 'error');
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.processingAudio = true;
    updateControlsState();
    state.mediaRecorder.stop();
    showToast('Transformation locale...');
  }
}

function createProgressTracker() {
  const draftItems = [
    ...state.draftPhotos.map((file, index) => ({ id: `p-${index}`, file })),
    ...state.draftAudios.map((file, index) => ({ id: `a-${index}`, file }))
  ];

  const progressByFile = new Map();
  draftItems.forEach((item) => progressByFile.set(item.id, 0));

  const totalBytes = draftItems.reduce((sum, item) => sum + Number(item.file.size || 0), 0);

  const updateGlobalProgress = () => {
    if (!totalBytes) {
      setUploadProgress(100);
      return;
    }

    const transferred = [...progressByFile.values()].reduce((sum, value) => sum + Number(value || 0), 0);
    setUploadProgress((transferred / totalBytes) * 100);
  };

  return { totalBytes, updateGlobalProgress, progressByFile };
}

async function uploadDraftMedia(studentId, mealId) {
  const tracker = createProgressTracker();

  if (!tracker.totalBytes) {
    setUploadProgress(100);
    return { photos: [], audios: [] };
  }

  const photoUploads = Promise.all(
    state.draftPhotos.map((file, index) =>
      uploadMealFile({
        studentId,
        mealId,
        folder: 'photos',
        file,
        index,
        onProgress: ({ bytesTransferred }) => {
          tracker.progressByFile.set(`p-${index}`, Number(bytesTransferred || 0));
          tracker.updateGlobalProgress();
        }
      })
    )
  );

  const audioUploads = Promise.all(
    state.draftAudios.map((file, index) =>
      uploadMealFile({
        studentId,
        mealId,
        folder: 'audios',
        file,
        index,
        onProgress: ({ bytesTransferred }) => {
          tracker.progressByFile.set(`a-${index}`, Number(bytesTransferred || 0));
          tracker.updateGlobalProgress();
        }
      })
    )
  );

  const [photos, audios] = await Promise.all([photoUploads, audioUploads]);
  setUploadProgress(100);
  return { photos, audios };
}

async function handleCreateMeal(student) {
  const mealId = window.crypto?.randomUUID?.() || `meal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const uploaded = await uploadDraftMedia(student.id, mealId);

  await saveMeal({
    mealId,
    student,
    mealLabel: currentMealLabel(),
    photos: uploaded.photos,
    audios: uploaded.audios
  });

  clearDraft({ clearLabel: true });
  await loadCurrentStudentData();
  showToast('Repas enregistré');
}

async function handleUpdateExistingMeal(student) {
  const mealId = state.editingMealId;
  const originalMeal = state.editingOriginalMeal;

  if (!mealId || !originalMeal) {
    throw new Error('Aucun repas en cours de modification');
  }

  const uploaded = await uploadDraftMedia(student.id, mealId);

  const nextPhotos = [...state.editingExistingPhotos, ...uploaded.photos];
  const nextAudios = [...state.editingExistingAudios, ...uploaded.audios];

  if (!nextPhotos.length && !nextAudios.length) {
    throw new Error('Le repas doit contenir au moins un média.');
  }

  await updateMeal({
    mealId,
    mealLabel: currentMealLabel(),
    photos: nextPhotos,
    audios: nextAudios
  });

  const keptPaths = new Set([...state.editingExistingPhotos, ...state.editingExistingAudios].map((item) => item.path));
  const originalItems = [...(originalMeal.photos || []), ...(originalMeal.audios || [])];
  const removedPaths = originalItems
    .filter((item) => item.path && !keptPaths.has(item.path))
    .map((item) => item.path);

  await Promise.all(removedPaths.map((path) => deleteStoragePath(path)));

  resetEditMeal({ clearLabel: true });
  clearDraft();
  await loadCurrentStudentData();
  showToast('Repas modifié');
}

async function handleSaveMeal() {
  if (!isReadyForSave()) {
    showToast('Ajoute au moins un média.', 'error');
    return;
  }

  const student = getSelectedStudent();
  if (!student) {
    showToast('Nom manquant', 'error');
    return;
  }

  setBusy(elements.saveMealBtn, true, 'Envoi...');
  setUploadProgress(0);

  try {
    if (isEditingMeal()) {
      await handleUpdateExistingMeal(student);
    } else {
      await handleCreateMeal(student);
    }
  } catch (error) {
    console.error('Save meal failed:', {
      code: error?.code,
      message: error?.message,
      raw: error
    });
    showToast(uploadErrorMessage(error), 'error');
  } finally {
    window.setTimeout(() => hideUploadProgress(), 700);
    setBusy(elements.saveMealBtn, false);
    updateEditModeUI();
    updateControlsState();
  }
}

async function handleDeleteMeal(mealId, button) {
  const meal = state.meals.find((m) => m.id === mealId);
  if (!meal) {
    return;
  }

  const ok = window.confirm('Supprimer ce repas ?');
  if (!ok) {
    return;
  }

  setBusy(button, true, 'Suppression...');

  try {
    const paths = [...(meal.photos || []), ...(meal.audios || [])]
      .map((item) => item.path)
      .filter(Boolean);

    await Promise.all(paths.map((path) => deleteStoragePath(path)));
    await deleteMealDoc(mealId);

    if (state.editingMealId === mealId) {
      resetEditMeal({ clearLabel: true });
      clearDraft();
    }

    await loadCurrentStudentData();
    showToast('Repas supprimé');
  } catch (error) {
    console.error(error);
    showToast('Erreur suppression', 'error');
  }
}

async function handleEvaluationSubmit(form) {
  const evalId = form.dataset.evalId;
  const evaluation = state.evaluations.find((e) => e.id === evalId);
  const student = getSelectedStudent();

  if (!evaluation || !student) {
    showToast('Données manquantes', 'error');
    return;
  }

  const criteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];
  const answers = criteria.map((criterion) => {
    const field = form.elements.namedItem(`criterion_${criterion.id}`);
    return {
      criterionId: criterion.id,
      criterionText: criterion.text,
      text: String(field?.value || '').trim()
    };
  });

  if (answers.some((answer) => !answer.text)) {
    showToast('Complète tous les champs', 'error');
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const wasDone = evaluation.status === 'done';
  setBusy(submitButton, true, 'Envoi...');

  try {
    await submitEvaluationResponse(evalId, {
      evaluatorId: student.id,
      evaluatorName: student.name,
      submittedAtMs: Date.now(),
      answers
    });

    await loadCurrentStudentData();
    showToast(wasDone ? 'Évaluation mise à jour' : 'Évaluation envoyée');
  } catch (error) {
    console.error(error);
    showToast('Erreur envoi évaluation', 'error');
  } finally {
    setBusy(submitButton, false);
  }
}

function bindEvents() {
  if (elements.refreshBtn) {
    elements.refreshBtn.addEventListener('click', loadAll);
  }

  elements.studentSelect.addEventListener('change', async (event) => {
    state.selectedStudentId = event.target.value;
    await loadCurrentStudentData();
  });

  elements.recordBtn.addEventListener('click', async () => {
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      stopRecording();
      return;
    }
    await startRecording();
  });

  elements.cancelEditMealBtn.addEventListener('click', () => {
    resetEditMeal({ clearLabel: true });
    clearDraft();
    showToast('Modification annulée');
  });

  elements.clearDraftBtn.addEventListener('click', () => {
    if (isEditingMeal()) {
      clearDraft();
      showToast('Nouveaux fichiers effacés');
    } else {
      clearDraft({ clearLabel: true });
    }
  });

  if (elements.applyPhotoReviewBtn) {
    elements.applyPhotoReviewBtn.addEventListener('click', applyPendingPhotoReview);
  }

  if (elements.cancelPhotoReviewBtn) {
    elements.cancelPhotoReviewBtn.addEventListener('click', cancelPendingPhotoReview);
  }

  if (elements.photoActionBtn) {
    elements.photoActionBtn.addEventListener('click', togglePhotoSourceMenu);
  }

  if (elements.photoTakeBtn) {
    elements.photoTakeBtn.addEventListener('click', () => triggerPhotoInput(elements.photoCameraInput));
  }

  if (elements.photoLibraryBtn) {
    elements.photoLibraryBtn.addEventListener('click', () => triggerPhotoInput(elements.photoLibraryInput));
  }

  if (elements.photoFileBtn) {
    elements.photoFileBtn.addEventListener('click', () => triggerPhotoInput(elements.photoFileInput));
  }

  document.addEventListener('click', (event) => {
    if (!state.photoSourceMenuOpen) {
      return;
    }

    const insidePicker = event.target.closest('.photo-source-picker');
    if (!insidePicker) {
      closePhotoSourceMenu();
    }
  });

  elements.saveMealBtn.addEventListener('click', handleSaveMeal);

  elements.mealsList.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('.edit-meal-btn');
    if (editBtn) {
      enterEditMeal(editBtn.dataset.mealId);
      return;
    }

    const deleteBtn = event.target.closest('.delete-meal-btn');
    if (deleteBtn) {
      await handleDeleteMeal(deleteBtn.dataset.mealId, deleteBtn);
    }
  });

  elements.evaluationList.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-eval-id]');
    if (!form) {
      return;
    }
    event.preventDefault();
    await handleEvaluationSubmit(form);
  });

  bindFileInputs();
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
  initImageLightbox();
  updateEditModeUI();
  renderPhotoReview();

  if (!initFirebaseGuard()) {
    return;
  }

  await loadAll();
  renderDraftPhotos();
  renderDraftAudios();
  renderExistingEditMedia();
  updateControlsState();
}

init();
