export function formatDateTime(ms) {
  if (!ms) {
    return 'date inconnue';
  }
  const d = new Date(Number(ms));
  return d.toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatDateForFile(ms) {
  const d = new Date(Number(ms || Date.now()));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export function safeName(value = '') {
  return String(value)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 60);
}

export function shortBytes(size = 0) {
  const bytes = Number(size || 0);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function showWarning(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
}

export function hideWarning(element) {
  element.textContent = '';
  element.classList.add('hidden');
}

let toastTimer = null;

export function showToast(message, type = 'default') {
  const el = document.getElementById('toast');
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.add('show');

  if (type === 'error') {
    el.style.background = 'rgba(136, 27, 24, 0.95)';
  } else {
    el.style.background = 'rgba(17, 39, 28, 0.92)';
  }

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove('show');
    window.setTimeout(() => el.classList.add('hidden'), 230);
  }, 2300);
}

export function createMediaThumb(file, index, onDelete) {
  const wrapper = document.createElement('div');
  wrapper.className = 'thumb-wrap';

  const img = document.createElement('img');
  img.src = URL.createObjectURL(file);
  img.alt = `Photo ${index + 1}`;
  img.className = 'zoomable-image';
  img.dataset.caption = file.name || `Photo ${index + 1}`;

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'remove-thumb-btn';
  rm.textContent = 'x';
  rm.addEventListener('click', () => {
    URL.revokeObjectURL(img.src);
    onDelete(index);
  });

  wrapper.append(img, rm);
  return wrapper;
}

export function createAudioDraftItem(file, index, onDelete) {
  const row = document.createElement('div');
  row.className = 'audio-item';

  const left = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'meta';
  title.textContent = `${file.name || `audio_${index + 1}`} (${shortBytes(file.size)})`;

  const player = document.createElement('audio');
  player.controls = true;
  player.src = URL.createObjectURL(file);

  left.append(title, player);

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'danger-btn';
  rm.textContent = 'Supprimer';
  rm.addEventListener('click', () => {
    URL.revokeObjectURL(player.src);
    onDelete(index);
  });

  row.append(left, rm);
  return row;
}

export function buildMediaSection({ photos = [], audios = [] }) {
  const fragment = document.createDocumentFragment();

  if (photos.length) {
    const grid = document.createElement('div');
    grid.className = 'media-grid';

    photos.forEach((photo) => {
      const box = document.createElement('div');
      box.className = 'thumb-wrap';
      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = photo.name || 'Photo';
      img.className = 'zoomable-image';
      img.dataset.caption = photo.name || 'Photo';
      box.appendChild(img);
      grid.appendChild(box);
    });

    fragment.appendChild(grid);
  }

  if (audios.length) {
    const list = document.createElement('div');
    list.className = 'audio-list';

    audios.forEach((audio, index) => {
      const item = document.createElement('div');
      item.className = 'audio-item';

      const wrap = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'meta';
      title.textContent = audio.name || `Audio ${index + 1}`;
      const player = document.createElement('audio');
      player.controls = true;
      player.src = audio.url;
      wrap.append(title, player);

      item.appendChild(wrap);
      list.appendChild(item);
    });

    fragment.appendChild(list);
  }

  return fragment;
}

export function setBusy(button, busy, labelBusy = 'Patiente...') {
  if (!button) {
    return;
  }
  if (!button.dataset.normalLabel) {
    button.dataset.normalLabel = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? labelBusy : button.dataset.normalLabel;
}

export function initImageLightbox({
  modalId = 'imageModal',
  imageId = 'imageModalImg',
  captionId = 'imageModalCaption',
  closeId = 'imageModalClose'
} = {}) {
  const modal = document.getElementById(modalId);
  const image = document.getElementById(imageId);
  const caption = document.getElementById(captionId);
  const close = document.getElementById(closeId);

  if (!modal || !image || modal.dataset.lightboxBound === '1') {
    return;
  }

  const openLightbox = (src, text = '') => {
    image.src = src;
    image.alt = text || 'Image';
    if (caption) {
      caption.textContent = text || '';
    }
    modal.classList.remove('hidden');
    document.body.classList.add('no-scroll');
  };

  const closeLightbox = () => {
    modal.classList.add('hidden');
    image.src = '';
    if (caption) {
      caption.textContent = '';
    }
    document.body.classList.remove('no-scroll');
  };

  document.addEventListener('click', (event) => {
    const img = event.target.closest('img.zoomable-image');
    if (!img) {
      return;
    }
    openLightbox(img.currentSrc || img.src, img.dataset.caption || img.alt || '');
  });

  close?.addEventListener('click', closeLightbox);

  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-close-lightbox]')) {
      closeLightbox();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeLightbox();
    }
  });

  modal.dataset.lightboxBound = '1';
}
