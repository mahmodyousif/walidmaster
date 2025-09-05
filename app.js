// =========================
// Camera + face-api models (الوجه كما هو)
// =========================
let videoStream = null;

async function startCamera() {
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri('/finish_app/models/tiny_face_detector');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/finish_app/models/face_landmark_68');
    await faceapi.nets.faceRecognitionNet.loadFromUri('/finish_app/models/face_recognition');

    const video = document.getElementById('video');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoStream = stream;
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    alert('تعذر الوصول إلى الكاميرا أو تحميل النماذج: ' + err);
  }
}

function stopCamera() {
  const video = document.getElementById('video');
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    videoStream = null;
  }
}

// لقطة للمعاينة وحفظها اختياريًا
function snapshotPreview() {
  const video = document.getElementById('video');
  if (!video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataURL = canvas.toDataURL('image/png');
  document.getElementById('preview').src = dataURL;
  document.getElementById('face_image').value = dataURL; // اختياري
  return dataURL;
}

// =========================
// MediaPipe FaceMesh (للعيون)
// =========================
const RIGHT_EYE_INDICES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173];
const RIGHT_IRIS_INDICES = [474, 475, 476, 477];
const LEFT_EYE_INDICES  = [263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398];
const LEFT_IRIS_INDICES = [469, 470, 471, 472];

let _faceMeshInstance = null;
async function getFaceMeshInstance() {
  if (_faceMeshInstance) return _faceMeshInstance;

  const fm = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  fm.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,   // للحصول على نقاط القزحية
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  _faceMeshInstance = fm;
  return _faceMeshInstance;
}

async function getFaceMeshLandmarksOnce(videoEl) {
  if (!videoEl.videoWidth) {
    await new Promise((resolve) => {
      const handler = () => { videoEl.removeEventListener('loadedmetadata', handler); resolve(); };
      videoEl.addEventListener('loadedmetadata', handler);
    });
  }

  const fm = await getFaceMeshInstance();

  return new Promise((resolve) => {
    fm.onResults((results) => {
      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        resolve(results.multiFaceLandmarks[0]); // ~478 نقطة
      } else {
        resolve(null);
      }
    });
    fm.send({ image: videoEl });
  });
}

function buildEyeFeature(landmarks, isRight = true) {
  const eyeIdx   = isRight ? RIGHT_EYE_INDICES : LEFT_EYE_INDICES;
  const irisIdx  = isRight ? RIGHT_IRIS_INDICES : LEFT_IRIS_INDICES;
  const usedIdx  = eyeIdx.concat(irisIdx);

  const pts = usedIdx.map(i => ({ x: landmarks[i].x, y: landmarks[i].y }));

  // الزوايا التقريبية للعرض
  const cornerA = isRight ? landmarks[33]  : landmarks[362];
  const cornerB = isRight ? landmarks[133] : landmarks[263];
  const eyeWidth = Math.hypot(cornerA.x - cornerB.x, cornerA.y - cornerB.y) || 1e-6;

  const cx = pts.reduce((s,p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s,p) => s + p.y, 0) / pts.length;

  // تطبيع: (الإزاحة للمركز) / عرض العين
  const normalized = pts.flatMap(p => [ (p.x - cx) / eyeWidth, (p.y - cy) / eyeWidth ]);

  // تجزئة إلى 4 أجزاء
  const chunks = [];
  const CHUNK_COUNT = 4;
  const chunkSize = Math.ceil(normalized.length / CHUNK_COUNT);
  for (let i = 0; i < CHUNK_COUNT; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, normalized.length);
    chunks.push(normalized.slice(start, end));
  }

  return {
    eye_side: isRight ? 'right' : 'left',
    indices: usedIdx,
    center: [cx, cy],
    eye_width: eyeWidth,
    chunks
  };
}

async function getOneEyeLandmarksFeature(videoEl) {
  const lm = await getFaceMeshLandmarksOnce(videoEl);
  if (!lm) return null;

  let feature = buildEyeFeature(lm, true); // جرّب اليمنى أولاً
  if (!feature || !isFinite(feature.eye_width) || feature.eye_width < 1e-5) {
    feature = buildEyeFeature(lm, false);  // ثم اليسرى
  }
  return feature;
}

// =========================
// pHash Utils (DCT-based)
// =========================

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function cropFromVideo(video, sx, sy, sw, sh) {
  const vw = video.videoWidth, vh = video.videoHeight;
  sx = Math.floor(clamp(sx, 0, vw-1));
  sy = Math.floor(clamp(sy, 0, vh-1));
  sw = Math.floor(clamp(sw, 1, vw - sx));
  sh = Math.floor(clamp(sh, 1, vh - sy));

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

function toGray32x32(canvas) {
  const s = 32;
  const out = new Float64Array(s * s);
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0, s, s);
  const img = ctx.getImageData(0, 0, s, s).data;
  for (let i = 0, j = 0; i < img.length; i += 4, j++) {
    const r = img[i], g = img[i+1], b = img[i+2];
    out[j] = 0.299*r + 0.587*g + 0.114*b; // luminance
  }
  return out; // length 1024
}

function dct1D(vector, N, cosTable, alpha) {
  const out = new Float64Array(N);
  for (let u = 0; u < N; u++) {
    let sum = 0;
    for (let x = 0; x < N; x++) {
      sum += vector[x] * cosTable[u * N + x];
    }
    out[u] = alpha[u] * sum;
  }
  return out;
}

function dct2D_32x32(gray) {
  const N = 32;
  // Precompute cos and alpha
  const cosTable = new Float64Array(N * N);
  for (let u = 0; u < N; u++) {
    for (let x = 0; x < N; x++) {
      cosTable[u*N + x] = Math.cos(Math.PI * (2*x + 1) * u / (2*N));
    }
  }
  const alpha = new Float64Array(N);
  for (let u = 0; u < N; u++) {
    alpha[u] = (u === 0) ? Math.sqrt(1/N) : Math.sqrt(2/N);
  }

  // Row-wise DCT
  const rows = new Array(N);
  for (let y = 0; y < N; y++) {
    const row = new Float64Array(N);
    for (let x = 0; x < N; x++) row[x] = gray[y*N + x];
    rows[y] = dct1D(row, N, cosTable, alpha);
  }

  // Column-wise DCT
  const out = new Float64Array(N * N);
  for (let x = 0; x < N; x++) {
    const col = new Float64Array(N);
    for (let y = 0; y < N; y++) col[y] = rows[y][x];
    const d = dct1D(col, N, cosTable, alpha);
    for (let y = 0; y < N; y++) out[y*N + x] = d[y];
  }
  return out; // 32x32 flatten
}

function phashHexFromCanvas(canvas) {
  // 1) 32x32 gray
  const g = toGray32x32(canvas);
  // 2) 2D DCT
  const dct = dct2D_32x32(g);
  // 3) أخذ 8x8 أعلى-يسار
  const N = 32, K = 8;
  const block = new Float64Array(K*K);
  for (let v = 0; v < K; v++) {
    for (let u = 0; u < K; u++) {
      block[v*K + u] = dct[v*N + u];
    }
  }
  // 4) الوسيط (نحسبه على كامل 8x8 لثبات الحجم 64 بت)
  const sorted = Array.from(block).sort((a,b)=>a-b);
  const median = (sorted[31] + sorted[32]) / 2;

  // 5) تكوين 64 بت
  let bits = '';
  for (let i = 0; i < block.length; i++) {
    bits += (block[i] > median) ? '1' : '0';
  }
  // 6) إلى HEX (16 خانة)
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    const nibble = parseInt(bits.slice(i, i+4), 2);
    hex += nibble.toString(16);
  }
  return hex.toUpperCase(); // 16 hex chars
}

function chunkHex(hex, parts = 4) {
  const len = hex.length;
  const chunkLen = Math.ceil(len / parts);
  const chunks = [];
  for (let i = 0; i < parts; i++) {
    const start = i * chunkLen;
    const end = Math.min(start + chunkLen, len);
    if (start < len) chunks.push(hex.slice(start, end));
  }
  // لو طلع أقل من 4 أجزاء بسبب التقريب، نسدّ بالنص الفارغ
  while (chunks.length < parts) chunks.push('');
  return chunks;
}

// =========================
/* التقاط البصمات (وجه + عين + pHash مجزّأ) */
// =========================
async function captureAndRegister() {
  const video = document.getElementById('video');
  if (!videoStream || !video.videoWidth) {
    alert('شغّل الكاميرا وانتظر حتى تعمل.');
    return;
  }

  // --- بصمة الوجه (كما هي) ---
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    alert('لم يتم اكتشاف الوجه. رجاءً واجه الكاميرا بإضاءة جيدة.');
    return;
  }

  const faceDescriptor = Array.from(detection.descriptor);
  document.getElementById('face_descriptor').value = JSON.stringify(faceDescriptor);

  // --- قصّ صورة الوجه لحساب pHash ---
  const vw = video.videoWidth, vh = video.videoHeight;
  const box = detection.detection.box || detection.alignedRect?.box;
  let fx = box.x, fy = box.y, fw = box.width, fh = box.height;

  // توسعة بسيطة + تحويل لمربع
  const expand = 1.2;
  const cxF = fx + fw/2, cyF = fy + fh/2;
  const sizeF = Math.max(fw, fh) * expand;
  const sxF = Math.round(cxF - sizeF/2);
  const syF = Math.round(cyF - sizeF/2);
  const faceCrop = cropFromVideo(video, sxF, syF, sizeF, sizeF);
  const facePHashHex = phashHexFromCanvas(faceCrop);
  const facePHashChunks = chunkHex(facePHashHex, 4);
  document.getElementById('face_phash_chunks').value = JSON.stringify(facePHashChunks);

  // --- بصمة العين (عين واحدة + chunks هندسية) ---
  const eyeFeature = await getOneEyeLandmarksFeature(video);
  if (!eyeFeature) {
    alert('تعذر استخراج معالم العين. قرّب الوجه قليلًا ووجّه النظر للكاميرا.');
    return;
  }

  document.getElementById('eye_feature_chunks').value = JSON.stringify(eyeFeature.chunks);
  document.getElementById('eye_side').value = eyeFeature.eye_side;
  document.getElementById('eye_indices').value = JSON.stringify(eyeFeature.indices);
  document.getElementById('eye_center').value = JSON.stringify(eyeFeature.center);
  document.getElementById('eye_width').value = String(eyeFeature.eye_width);

  // --- قصّ صورة العين لحساب pHash ---
  const cxN = eyeFeature.center[0], cyN = eyeFeature.center[1]; // normalized [0..1]
  const eyeWpx = eyeFeature.eye_width * vw; // عرض العين بالبكسل تقريبي
  const sizeE = Math.max(24, eyeWpx * 2.6); // تغطية الجفن والقزحية
  const cxPx = cxN * vw, cyPx = cyN * vh;
  const sxE = Math.round(cxPx - sizeE/2);
  const syE = Math.round(cyPx - sizeE/2);
  const eyeCrop = cropFromVideo(video, sxE, syE, sizeE, sizeE);
  const eyePHashHex = phashHexFromCanvas(eyeCrop);
  const eyePHashChunks = chunkHex(eyePHashHex, 4);
  document.getElementById('eye_phash_chunks').value = JSON.stringify(eyePHashChunks);

  // معاينة
  snapshotPreview();

  alert('تم التقاط بصمة الوجه وبصمة العين + pHash بنجاح. يمكنك الآن إنشاء الحساب.');
}

// =========================
// إرسال النموذج كـ JSON إلى upload.php
// =========================
async function submitForm(e) {
  e.preventDefault();

  const user_id   = document.getElementById('user_id').value.trim();
  const user_name = document.getElementById('user_name').value.trim();

  const face_descriptor     = document.getElementById('face_descriptor').value;
  const eye_feature_chunks  = document.getElementById('eye_feature_chunks').value;
  const eye_side            = document.getElementById('eye_side').value;

  // (اختياري) مراجع:
  const eye_indices = document.getElementById('eye_indices').value || null;
  const eye_center  = document.getElementById('eye_center').value  || null;
  const eye_width   = document.getElementById('eye_width').value   || null;

  // الجديد: pHash chunks
  const face_phash_chunks = document.getElementById('face_phash_chunks').value || '';
  const eye_phash_chunks  = document.getElementById('eye_phash_chunks').value  || '';

  if (!user_id || !user_name) {
    alert('أدخل ID والاسم.');
    return;
  }
  if (!face_descriptor || !eye_feature_chunks || !eye_side) {
    alert('الرجاء الضغط على "التقط البصمات" أولاً.');
    return;
  }
  if (!face_phash_chunks || !eye_phash_chunks) {
    alert('حدثت مشكلة في توليد pHash. أعد المحاولة بالضغط على "التقط البصمات".');
    return;
  }

  try {
    const res = await fetch('upload.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id,
        user_name,
        face_descriptor,
        eye_side,
        eye_landmarks_chunks: eye_feature_chunks,
        // اختياري:
        eye_indices,
        eye_center,
        eye_width: eye_width ? parseFloat(eye_width) : null,
        // الجديد:
        face_phash_chunks,
        eye_phash_chunks
      })
    });
    const msg = await res.text();
    alert(msg);
  } catch (err) {
    alert('خطأ في الاتصال: ' + err);
  }
}

// =========================
// ربط الأزرار
// =========================
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn_open').addEventListener('click', startCamera);
  document.getElementById('btn_stop').addEventListener('click', stopCamera);
  document.getElementById('capture').addEventListener('click', captureAndRegister);
});
