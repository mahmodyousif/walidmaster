// =========================
// الكاميرا + face-api (الوجه كما هو)
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
  } catch (e) {
    alert('تعذر تشغيل الكاميرا أو تحميل النماذج: ' + e);
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

function snapshotPreview() {
  const video = document.getElementById('video');
  if (!video.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, c.width, c.height);
  document.getElementById('preview').src = c.toDataURL('image/png');
}

// =========================
// MediaPipe FaceMesh (العين)
// =========================
const RIGHT_EYE_INDICES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173];
const RIGHT_IRIS_INDICES = [474, 475, 476, 477];
const LEFT_EYE_INDICES  = [263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398];
const LEFT_IRIS_INDICES = [469, 470, 471, 472];

let _faceMeshInstance = null;
async function getFaceMeshInstance() {
  if (_faceMeshInstance) return _faceMeshInstance;
  const fm = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
  });
  fm.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
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
        resolve(results.multiFaceLandmarks[0]);
      } else {
        resolve(null);
      }
    });
    fm.send({ image: videoEl });
  });
}

// =========================
// أدوات العين: بناء الميزة (landmarks chunks)
// =========================
function flatten(arrOfArr){ const o=[]; for(const a of arrOfArr) for(const v of a) o.push(v); return o; }
function rechunk(flat, chunkCount=4){
  const chunks=[], chunkSize=Math.ceil(flat.length/chunkCount);
  for(let i=0;i<chunkCount;i++){ const s=i*chunkSize,e=Math.min(flat.length,s+chunkSize); chunks.push(flat.slice(s,e)); }
  return chunks;
}

function buildEyeFeatureWithMeta(landmarks, isRight=true){
  const eyeIdx  = isRight? RIGHT_EYE_INDICES: LEFT_EYE_INDICES;
  const irisIdx = isRight? RIGHT_IRIS_INDICES: LEFT_IRIS_INDICES;
  const usedIdx = eyeIdx.concat(irisIdx);

  const pts = usedIdx.map(i=>({x:landmarks[i].x, y:landmarks[i].y}));

  const cornerA = isRight ? landmarks[33]  : landmarks[362];
  const cornerB = isRight ? landmarks[133] : landmarks[263];
  const eyeWidth = Math.hypot(cornerA.x - cornerB.x, cornerA.y - cornerB.y) || 1e-6;

  const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length;
  const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length;

  const normalized = pts.flatMap(p=>[(p.x-cx)/eyeWidth, (p.y-cy)/eyeWidth]);
  const chunks = rechunk(normalized, 4);

  // مركز القزحية لقصّ الصورة لاحقًا
  const irisPoints = irisIdx.map(i=>landmarks[i]);
  const irisCx = irisPoints.reduce((s,p)=>s+p.x,0)/irisPoints.length;
  const irisCy = irisPoints.reduce((s,p)=>s+p.y,0)/irisPoints.length;

  return {
    eye_side: isRight? 'right':'left',
    chunks,
    center: [cx, cy],       // مركز العين (مجموعة النقاط)
    irisCenter: [irisCx, irisCy],
    eye_width: eyeWidth
  };
}

async function sampleEyeFeature(videoEl){
  const lm = await getFaceMeshLandmarksOnce(videoEl);
  if(!lm) return null;
  let f = buildEyeFeatureWithMeta(lm, true);
  if(!f || !isFinite(f.eye_width) || f.eye_width < 1e-5) f = buildEyeFeatureWithMeta(lm, false);
  return f;
}

// =========================
// pHash (DCT) + أدوات قصّ
// =========================
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function cropFromVideo(video, sx, sy, sw, sh){
  const vw=video.videoWidth, vh=video.videoHeight;
  sx=Math.floor(clamp(sx,0,vw-1)); sy=Math.floor(clamp(sy,0,vh-1));
  sw=Math.floor(clamp(sw,1,vw-sx)); sh=Math.floor(clamp(sh,1,vh-sy));
  const c=document.createElement('canvas'); c.width=sw; c.height=sh;
  c.getContext('2d').drawImage(video,sx,sy,sw,sh,0,0,sw,sh);
  return c;
}

function toGray32x32(canvas){
  const s=32, out=new Float64Array(s*s), c=document.createElement('canvas');
  c.width=s; c.height=s; const ctx=c.getContext('2d'); ctx.drawImage(canvas,0,0,s,s);
  const img=ctx.getImageData(0,0,s,s).data;
  for(let i=0,j=0;i<img.length;i+=4,j++){ const r=img[i],g=img[i+1],b=img[i+2]; out[j]=0.299*r+0.587*g+0.114*b; }
  return out;
}
function dct1D(vec,N,cosTable,alpha){ const out=new Float64Array(N); for(let u=0;u<N;u++){ let s=0; for(let x=0;x<N;x++) s+=vec[x]*cosTable[u*N+x]; out[u]=alpha[u]*s; } return out; }
function dct2D_32x32(gray){
  const N=32, cosTable=new Float64Array(N*N), alpha=new Float64Array(N);
  for(let u=0;u<N;u++){ for(let x=0;x<N;x++) cosTable[u*N+x]=Math.cos(Math.PI*(2*x+1)*u/(2*N)); alpha[u]=(u===0)?Math.sqrt(1/N):Math.sqrt(2/N); }
  const rows=new Array(N);
  for(let y=0;y<N;y++){ const row=new Float64Array(N); for(let x=0;x<N;x++) row[x]=gray[y*N+x]; rows[y]=dct1D(row,N,cosTable,alpha); }
  const out=new Float64Array(N*N);
  for(let x=0;x<N;x++){ const col=new Float64Array(N); for(let y=0;y<N;y++) col[y]=rows[y][x]; const d=dct1D(col,N,cosTable,alpha); for(let y=0;y<N;y++) out[y*N+x]=d[y]; }
  return out;
}
function phashHexFromCanvas(canvas){
  const g=toGray32x32(canvas), d=dct2D_32x32(g), N=32,K=8, block=new Float64Array(K*K);
  for(let v=0;v<K;v++) for(let u=0;u<K;u++) block[v*K+u]=d[v*N+u];
  const sorted=Array.from(block).sort((a,b)=>a-b), median=(sorted[31]+sorted[32])/2;
  let bits=''; for(let i=0;i<block.length;i++) bits += (block[i]>median)?'1':'0';
  let hex=''; for(let i=0;i<64;i+=4){ const nibble=parseInt(bits.slice(i,i+4),2); hex+=nibble.toString(16); }
  return hex.toUpperCase(); // 16 hex
}
function chunkHex(hex, parts=4){
  const len=hex.length, chunkLen=Math.ceil(len/parts), chunks=[];
  for(let i=0;i<parts;i++){ const s=i*chunkLen, e=Math.min(s+chunkLen,len); if(s<len) chunks.push(hex.slice(s,e)); }
  while(chunks.length<parts) chunks.push('');
  return chunks;
}

// =========================
// التحقق بالوجه (descriptor + pHash)
// =========================
async function captureFaceLogin() {
  const video = document.getElementById('video');
  if (!videoStream || !video.videoWidth) { alert('شغّل الكاميرا أولاً.'); return; }

  const det = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!det) { alert('لم يتم اكتشاف الوجه.'); return; }

  snapshotPreview();

  const descriptor = Array.from(det.descriptor);

  // قصّ الوجه لـ pHash (نفس منطق التسجيل)
  const vw=video.videoWidth, vh=video.videoHeight;
  const box = det.detection.box || det.alignedRect?.box;
  const fx=box.x, fy=box.y, fw=box.width, fh=box.height;
  const expand=1.2, cxF=fx+fw/2, cyF=fy+fh/2, sizeF=Math.max(fw,fh)*expand;
  const sxF=Math.round(cxF-sizeF/2), syF=Math.round(cyF-sizeF/2);
  const faceCrop = cropFromVideo(video, sxF, syF, sizeF, sizeF);
  const facePHashHex = phashHexFromCanvas(faceCrop);
  const facePHashChunks = chunkHex(facePHashHex, 4);

  try {
    const res = await fetch('verify.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        mode: 'face',
        face_descriptor: JSON.stringify(descriptor),
        face_phash_chunks: JSON.stringify(facePHashChunks)
      })
    });
    const msg = await res.text();
    alert(msg);
  } catch (e) {
    alert('خطأ أثناء التحقق (Face): ' + e);
  }
}

// =========================
// التحقق بالعين (landmarks + pHash)
// =========================
async function captureEyeLogin() {
  const video = document.getElementById('video');
  if (!videoStream || !video.videoWidth) { alert('شغّل الكاميرا أولاً.'); return; }

  const eyeF = await sampleEyeFeature(video);
  if (!eyeF) { alert('تعذر استخراج معالم العين.'); return; }

  snapshotPreview();

  // قصّ صورة العين لـ pHash (نفس التسجيل)
  const vw=video.videoWidth, vh=video.videoHeight;
  const cx = eyeF.center[0]*vw, cy = eyeF.center[1]*vh;
  const sizeE = Math.max(24, eyeF.eye_width * vw * 2.6);
  const sxE = Math.round(cx - sizeE/2), syE=Math.round(cy - sizeE/2);
  const eyeCrop = cropFromVideo(video, sxE, syE, sizeE, sizeE);
  const eyePHashHex = phashHexFromCanvas(eyeCrop);
  const eyePHashChunks = chunkHex(eyePHashHex, 4);

  try {
    const res = await fetch('verify.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        mode: 'eye',
        eye_landmarks_chunks: JSON.stringify(eyeF.chunks),
        eye_side: eyeF.eye_side,
        eye_phash_chunks: JSON.stringify(eyePHashChunks)
      })
    });
    const msg = await res.text();
    alert(msg);
  } catch (e) {
    alert('خطأ أثناء التحقق (Eye): ' + e);
  }
}

// =========================
// ربط الأزرار
// =========================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn_start')?.addEventListener('click', startCamera);
  document.getElementById('btn_stop')?.addEventListener('click', stopCamera);
  document.getElementById('face_login')?.addEventListener('click', captureFaceLogin);
  document.getElementById('eye_login')?.addEventListener('click', captureEyeLogin);
});
