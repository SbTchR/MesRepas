const ASCII_DECODER = new TextDecoder('latin1');
const UTF8_DECODER = new TextDecoder('utf-8');

const EXIF_TYPE_SIZES = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8
};

const IFD0_TAGS = {
  0x010f: 'Marque appareil',
  0x0110: 'Modele appareil',
  0x0112: 'Orientation image',
  0x0131: 'Logiciel',
  0x0132: 'Date image',
  0x013b: 'Auteur',
  0x8298: 'Copyright',
  0x8769: 'Bloc EXIF',
  0x8825: 'Bloc GPS'
};

const EXIF_TAGS = {
  0x829a: 'Temps exposition',
  0x829d: 'Ouverture',
  0x8827: 'ISO',
  0x9003: 'Date originale',
  0x9004: 'Date numerisation',
  0x920a: 'Focale',
  0x9286: 'Commentaire',
  0xa002: 'Largeur image',
  0xa003: 'Hauteur image',
  0xa405: 'Focale 35mm',
  0xa420: 'Identifiant image',
  0xa430: 'Proprietaire',
  0xa431: 'Numero serie boitier',
  0xa432: 'Objectif',
  0xa433: 'Fabricant objectif',
  0xa434: 'Modele objectif',
  0xa435: 'Numero serie objectif'
};

const GPS_TAGS = {
  0x0001: 'Reference latitude',
  0x0002: 'Latitude GPS',
  0x0003: 'Reference longitude',
  0x0004: 'Longitude GPS',
  0x0005: 'Reference altitude',
  0x0006: 'Altitude GPS',
  0x0007: 'Heure GPS',
  0x001d: 'Date GPS'
};

const POINTER_TAGS = new Set([0x8769, 0x8825, 0xa005]);

const ORIENTATION_LABELS = {
  1: 'normale',
  2: 'miroir horizontal',
  3: 'rotation 180 degres',
  4: 'miroir vertical',
  5: 'miroir horizontal + rotation 90 degres',
  6: 'rotation 90 degres',
  7: 'miroir horizontal + rotation 270 degres',
  8: 'rotation 270 degres'
};

export function supportsImageSanitization() {
  return Boolean(
    typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      typeof File !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof Blob.prototype.arrayBuffer === 'function' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.toBlob === 'function'
  );
}

export async function prepareSanitizedImage(file) {
  if (!supportsImageSanitization()) {
    throw new Error('IMAGE_SANITIZATION_UNSUPPORTED');
  }

  const sourceType = String(file?.type || '').toLowerCase();
  if (!sourceType.startsWith('image/')) {
    throw new Error('IMAGE_SANITIZATION_INVALID_TYPE');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata = extractImageMetadata(bytes, sourceType);
  const loaded = await loadImageSource(file);

  try {
    const outputType = chooseOutputMimeType(sourceType);
    const sanitizedBlob = await renderSanitizedBlob({
      imageSource: loaded.imageSource,
      width: loaded.width,
      height: loaded.height,
      orientation: loaded.orientationAlreadyApplied ? 1 : metadata.orientation,
      outputType,
      quality: outputType === 'image/png' ? undefined : 0.92
    });

    const sanitizedFile = new File([sanitizedBlob], buildSanitizedName(file.name, outputType), {
      type: outputType,
      lastModified: Date.now()
    });

    return {
      sanitizedFile,
      removedMetadata: metadata.items,
      formatLabel: metadata.formatLabel
    };
  } finally {
    loaded.cleanup();
  }
}

function extractImageMetadata(bytes, sourceType) {
  if (isJpeg(bytes, sourceType)) {
    return extractJpegMetadata(bytes);
  }

  if (isPng(bytes, sourceType)) {
    return extractPngMetadata(bytes);
  }

  return {
    items: [],
    orientation: 1,
    formatLabel: sourceType.replace('image/', '').toUpperCase() || 'IMAGE'
  };
}

function isJpeg(bytes, sourceType) {
  return sourceType === 'image/jpeg' || sourceType === 'image/jpg' || (bytes[0] === 0xff && bytes[1] === 0xd8);
}

function isPng(bytes, sourceType) {
  return (
    sourceType === 'image/png' &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) || (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function extractJpegMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const items = [];
  const genericBlocks = new Set();
  let orientation = 1;
  let offset = 2;

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      break;
    }

    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) {
      break;
    }

    const size = view.getUint16(offset + 2, false);
    if (size < 2 || offset + 2 + size > view.byteLength) {
      break;
    }

    const dataOffset = offset + 4;
    const dataLength = size - 2;

    if (marker === 0xe1 && dataLength >= 6 && readAscii(bytes, dataOffset, 6) === 'Exif\0\0') {
      const exif = parseExifProfile(view, dataOffset + 6);
      items.push(...exif.items);
      orientation = exif.orientation || orientation;
    } else if (marker === 0xe1 && readAscii(bytes, dataOffset, Math.min(dataLength, 29)).startsWith('http://ns.adobe.com/xap/1.0/')) {
      genericBlocks.add('Bloc XMP');
    } else if (marker === 0xed) {
      genericBlocks.add('Bloc Photoshop/IPTC');
    } else if (marker === 0xe2 && readAscii(bytes, dataOffset, Math.min(dataLength, 12)).startsWith('ICC_PROFILE')) {
      genericBlocks.add('Profil couleur ICC');
    }

    offset += size + 2;
  }

  genericBlocks.forEach((label) => items.push({ label, value: 'present' }));

  return {
    items: dedupeMetadataItems(items),
    orientation,
    formatLabel: 'JPEG'
  };
}

function extractPngMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const items = [];
  let orientation = 1;
  let offset = 8;

  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, false);
    const type = readAscii(bytes, offset + 4, 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;

    if (nextOffset > view.byteLength) {
      break;
    }

    if (type === 'tEXt') {
      const text = parsePngTextChunk(bytes.subarray(dataOffset, dataOffset + length));
      if (text) {
        items.push(text);
      }
    } else if (type === 'iTXt') {
      const text = parsePngInternationalTextChunk(bytes.subarray(dataOffset, dataOffset + length));
      if (text) {
        items.push(text);
      }
    } else if (type === 'zTXt') {
      const keyword = readKeyword(bytes.subarray(dataOffset, dataOffset + length));
      if (keyword) {
        items.push({ label: `PNG ${keyword}`, value: 'texte compresse present' });
      }
    } else if (type === 'tIME' && length === 7) {
      items.push({ label: 'Date PNG', value: formatPngTime(bytes.subarray(dataOffset, dataOffset + length)) });
    } else if (type === 'pHYs' && length === 9) {
      items.push({ label: 'Resolution PNG', value: formatPngResolution(view, dataOffset) });
    } else if (type === 'iCCP') {
      const keyword = readKeyword(bytes.subarray(dataOffset, dataOffset + length));
      items.push({ label: 'Profil couleur ICC', value: keyword ? keyword : 'present' });
    } else if (type === 'eXIf') {
      const exif = parseExifProfile(view, dataOffset);
      items.push(...exif.items);
      orientation = exif.orientation || orientation;
    }

    if (type === 'IEND') {
      break;
    }

    offset = nextOffset;
  }

  return {
    items: dedupeMetadataItems(items),
    orientation,
    formatLabel: 'PNG'
  };
}

function parseExifProfile(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) {
    return { items: [], orientation: 1 };
  }

  const byteOrder = readAsciiFromView(view, tiffStart, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') {
    return { items: [], orientation: 1 };
  }

  const magic = view.getUint16(tiffStart + 2, littleEndian);
  if (magic !== 42) {
    return { items: [], orientation: 1 };
  }

  const entries = [];
  const visited = new Set();
  const orientationRef = { value: 1 };
  const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);

  parseExifIfd({
    view,
    tiffStart,
    ifdOffset: tiffStart + firstIfdOffset,
    littleEndian,
    ifdName: 'IFD0',
    entries,
    visited,
    orientationRef
  });

  return {
    items: buildExifItems(entries),
    orientation: orientationRef.value
  };
}

function parseExifIfd({ view, tiffStart, ifdOffset, littleEndian, ifdName, entries, visited, orientationRef }) {
  if (ifdOffset <= 0 || ifdOffset + 2 > view.byteLength || visited.has(`${ifdName}:${ifdOffset}`)) {
    return;
  }

  visited.add(`${ifdName}:${ifdOffset}`);
  const entryCount = view.getUint16(ifdOffset, littleEndian);

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > view.byteLength) {
      break;
    }

    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const rawValue = readExifValue(view, tiffStart, entryOffset, type, count, littleEndian);

    if (rawValue == null) {
      continue;
    }

    entries.push({ ifdName, tag, rawValue });

    if (ifdName === 'IFD0' && tag === 0x0112) {
      orientationRef.value = Number(Array.isArray(rawValue) ? rawValue[0] : rawValue) || orientationRef.value;
    }

    if (ifdName === 'IFD0' && tag === 0x8769) {
      parseExifIfd({
        view,
        tiffStart,
        ifdOffset: tiffStart + Number(rawValue),
        littleEndian,
        ifdName: 'EXIF',
        entries,
        visited,
        orientationRef
      });
    } else if (ifdName === 'IFD0' && tag === 0x8825) {
      parseExifIfd({
        view,
        tiffStart,
        ifdOffset: tiffStart + Number(rawValue),
        littleEndian,
        ifdName: 'GPS',
        entries,
        visited,
        orientationRef
      });
    }
  }
}

function readExifValue(view, tiffStart, entryOffset, type, count, littleEndian) {
  const unitSize = EXIF_TYPE_SIZES[type];
  if (!unitSize || !count) {
    return null;
  }

  const byteLength = unitSize * count;
  const valueOffset = byteLength <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, littleEndian);

  if (valueOffset < 0 || valueOffset + byteLength > view.byteLength) {
    return null;
  }

  if (type === 2) {
    return readAsciiFromView(view, valueOffset, byteLength).replace(/\0+$/g, '').trim();
  }

  if (type === 7) {
    return new Uint8Array(view.buffer, view.byteOffset + valueOffset, byteLength);
  }

  const values = [];

  for (let index = 0; index < count; index += 1) {
    const currentOffset = valueOffset + index * unitSize;

    if (type === 1) {
      values.push(view.getUint8(currentOffset));
    } else if (type === 3) {
      values.push(view.getUint16(currentOffset, littleEndian));
    } else if (type === 4) {
      values.push(view.getUint32(currentOffset, littleEndian));
    } else if (type === 5) {
      values.push({
        numerator: view.getUint32(currentOffset, littleEndian),
        denominator: view.getUint32(currentOffset + 4, littleEndian)
      });
    } else if (type === 9) {
      values.push(view.getInt32(currentOffset, littleEndian));
    } else if (type === 10) {
      values.push({
        numerator: view.getInt32(currentOffset, littleEndian),
        denominator: view.getInt32(currentOffset + 4, littleEndian)
      });
    }
  }

  return count === 1 ? values[0] : values;
}

function buildExifItems(entries) {
  const entryMap = new Map(entries.map((entry) => [`${entry.ifdName}:${entry.tag}`, entry.rawValue]));
  const items = [];

  entries.forEach((entry) => {
    if (POINTER_TAGS.has(entry.tag)) {
      return;
    }

    if (entry.ifdName === 'GPS' && (entry.tag === 0x0001 || entry.tag === 0x0003 || entry.tag === 0x001d)) {
      return;
    }

    const label = resolveTagLabel(entry.ifdName, entry.tag);
    const value = formatExifEntry(entry, entryMap);

    if (value) {
      items.push({ label, value });
    }
  });

  return dedupeMetadataItems(items);
}

function resolveTagLabel(ifdName, tag) {
  const dictionaries = {
    IFD0: IFD0_TAGS,
    EXIF: EXIF_TAGS,
    GPS: GPS_TAGS
  };

  const label = dictionaries[ifdName]?.[tag];
  if (label) {
    return label;
  }

  return `${ifdName} 0x${tag.toString(16).padStart(4, '0')}`;
}

function formatExifEntry(entry, entryMap) {
  const { tag, rawValue } = entry;

  if (rawValue == null || rawValue === '') {
    return '';
  }

  if (tag === 0x0112) {
    return ORIENTATION_LABELS[Number(rawValue)] || String(rawValue);
  }

  if (tag === 0x829a) {
    return formatExposure(rawValue);
  }

  if (tag === 0x829d) {
    return formatAperture(rawValue);
  }

  if (tag === 0x920a || tag === 0xa405) {
    return `${formatRationalValue(rawValue)} mm`;
  }

  if (tag === 0x0002) {
    return formatGpsCoordinate(rawValue, entryMap.get('GPS:1'));
  }

  if (tag === 0x0004) {
    return formatGpsCoordinate(rawValue, entryMap.get('GPS:3'));
  }

  if (tag === 0x0006) {
    const altitude = formatRationalValue(rawValue);
    const ref = Number(entryMap.get('GPS:5') || 0) === 1 ? 'sous le niveau de la mer' : 'au-dessus du niveau de la mer';
    return `${altitude} m (${ref})`;
  }

  if (tag === 0x0007) {
    const timeValue = formatGpsTime(rawValue);
    const dateValue = entryMap.get('GPS:29');
    return dateValue ? `${dateValue} ${timeValue} UTC` : timeValue;
  }

  if (tag === 0x9286) {
    return formatUserComment(rawValue);
  }

  if (rawValue instanceof Uint8Array) {
    return `donnee binaire (${rawValue.byteLength} octets)`;
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map(formatPrimitiveValue).join(', ');
  }

  return formatPrimitiveValue(rawValue);
}

function formatPrimitiveValue(value) {
  if (value instanceof Uint8Array) {
    return `donnee binaire (${value.byteLength} octets)`;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }

  if (typeof value === 'object' && value && 'numerator' in value && 'denominator' in value) {
    return formatRationalValue(value);
  }

  return String(value);
}

function formatExposure(value) {
  if (!value || typeof value !== 'object') {
    return formatPrimitiveValue(value);
  }

  const ratio = rationalToNumber(value);
  if (!ratio) {
    return formatPrimitiveValue(value);
  }

  if (ratio < 1) {
    return `1/${Math.round(1 / ratio)} s`;
  }

  return `${ratio.toFixed(2)} s`;
}

function formatAperture(value) {
  const ratio = rationalToNumber(value);
  if (!ratio) {
    return formatPrimitiveValue(value);
  }

  return `f/${ratio.toFixed(1)}`;
}

function formatGpsCoordinate(value, ref) {
  if (!Array.isArray(value) || value.length < 3) {
    return formatPrimitiveValue(value);
  }

  const degrees = rationalToNumber(value[0]);
  const minutes = rationalToNumber(value[1]);
  const seconds = rationalToNumber(value[2]);
  const refLabel = typeof ref === 'string' ? ref : '';
  const decimal = degrees + minutes / 60 + seconds / 3600;

  return `${decimal.toFixed(6)} ${refLabel}`.trim();
}

function formatGpsTime(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return formatPrimitiveValue(value);
  }

  const [hours, minutes, seconds] = value.map((part) => rationalToNumber(part));
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function formatUserComment(value) {
  if (!(value instanceof Uint8Array)) {
    return formatPrimitiveValue(value);
  }

  if (value.byteLength >= 8) {
    const prefix = ASCII_DECODER.decode(value.subarray(0, 8));
    const body = value.subarray(8);

    if (prefix.startsWith('ASCII')) {
      return ASCII_DECODER.decode(body).replace(/\0+$/g, '').trim();
    }

    if (prefix.startsWith('UNICODE')) {
      return UTF8_DECODER.decode(body).replace(/\0+$/g, '').trim();
    }
  }

  return ASCII_DECODER.decode(value).replace(/\0+$/g, '').trim();
}

function formatRationalValue(value) {
  const ratio = rationalToNumber(value);
  if (ratio == null) {
    return '';
  }

  if (Math.abs(ratio - Math.round(ratio)) < 0.0001) {
    return String(Math.round(ratio));
  }

  return ratio.toFixed(4).replace(/0+$/g, '').replace(/\.$/g, '');
}

function rationalToNumber(value) {
  if (!value || typeof value !== 'object' || !('numerator' in value) || !('denominator' in value)) {
    return typeof value === 'number' ? value : null;
  }

  if (!value.denominator) {
    return null;
  }

  return value.numerator / value.denominator;
}

function dedupeMetadataItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.label}::${item.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const imageBitmap = await createImageBitmap(file, { imageOrientation: 'none' });
      return {
        imageSource: imageBitmap,
        width: imageBitmap.width,
        height: imageBitmap.height,
        orientationAlreadyApplied: false,
        cleanup: () => imageBitmap.close?.()
      };
    } catch {
      try {
        const imageBitmap = await createImageBitmap(file);
        return {
          imageSource: imageBitmap,
          width: imageBitmap.width,
          height: imageBitmap.height,
          orientationAlreadyApplied: true,
          cleanup: () => imageBitmap.close?.()
        };
      } catch {
        // Fall through to HTMLImageElement.
      }
    }
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await loadHtmlImage(objectUrl);
    return {
      imageSource: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      orientationAlreadyApplied: true,
      cleanup: () => URL.revokeObjectURL(objectUrl)
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
    img.src = src;
  });
}

async function renderSanitizedBlob({ imageSource, width, height, orientation, outputType, quality }) {
  const canvas = document.createElement('canvas');
  const swapAxes = orientation >= 5 && orientation <= 8;
  canvas.width = swapAxes ? height : width;
  canvas.height = swapAxes ? width : height;

  const context = canvas.getContext('2d', { alpha: outputType === 'image/png' });
  if (!context) {
    throw new Error('CANVAS_CONTEXT_UNAVAILABLE');
  }

  applyOrientationTransform(context, orientation, width, height);
  context.drawImage(imageSource, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, outputType, quality);
  canvas.width = 1;
  canvas.height = 1;
  return blob;
}

function applyOrientationTransform(context, orientation, width, height) {
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('CANVAS_EXPORT_FAILED'));
        }
      },
      type,
      quality
    );
  });
}

function chooseOutputMimeType(sourceType) {
  if (sourceType === 'image/png') {
    return 'image/png';
  }

  return 'image/jpeg';
}

function buildSanitizedName(originalName, mimeType) {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  const base = String(originalName || 'photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return `${base || 'photo'}.${extension}`;
}

function parsePngTextChunk(bytes) {
  const separator = bytes.indexOf(0);
  if (separator <= 0) {
    return null;
  }

  const keyword = ASCII_DECODER.decode(bytes.subarray(0, separator));
  const value = ASCII_DECODER.decode(bytes.subarray(separator + 1)).trim();
  if (!value) {
    return null;
  }

  return { label: `PNG ${keyword}`, value };
}

function parsePngInternationalTextChunk(bytes) {
  let index = bytes.indexOf(0);
  if (index <= 0) {
    return null;
  }

  const keyword = UTF8_DECODER.decode(bytes.subarray(0, index));
  const compressionFlag = bytes[index + 1];
  let cursor = index + 3;

  index = bytes.indexOf(0, cursor);
  if (index < 0) {
    return null;
  }
  cursor = index + 1;

  index = bytes.indexOf(0, cursor);
  if (index < 0) {
    return null;
  }

  const textBytes = bytes.subarray(index + 1);
  if (!textBytes.length) {
    return null;
  }

  if (compressionFlag === 1) {
    return { label: `PNG ${keyword}`, value: 'texte compresse present' };
  }

  return { label: `PNG ${keyword}`, value: UTF8_DECODER.decode(textBytes).trim() };
}

function readKeyword(bytes) {
  const separator = bytes.indexOf(0);
  if (separator <= 0) {
    return '';
  }

  return ASCII_DECODER.decode(bytes.subarray(0, separator)).trim();
}

function formatPngTime(bytes) {
  const year = (bytes[0] << 8) + bytes[1];
  return `${year}-${pad2(bytes[2])}-${pad2(bytes[3])} ${pad2(bytes[4])}:${pad2(bytes[5])}:${pad2(bytes[6])} UTC`;
}

function formatPngResolution(view, offset) {
  const pixelsX = view.getUint32(offset, false);
  const pixelsY = view.getUint32(offset + 4, false);
  const unit = view.getUint8(offset + 8) === 1 ? 'pixels/metre' : 'unite inconnue';
  return `${pixelsX} x ${pixelsY} ${unit}`;
}

function readAscii(bytes, offset, length) {
  return ASCII_DECODER.decode(bytes.subarray(offset, offset + length));
}

function readAsciiFromView(view, offset, length) {
  return ASCII_DECODER.decode(new Uint8Array(view.buffer, view.byteOffset + offset, length));
}

function pad2(value) {
  return String(Math.round(Number(value) || 0)).padStart(2, '0');
}
