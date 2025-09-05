<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>إنشاء حساب جديد</title>

  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.boxicons.com/fonts/basic/boxicons.min.css" rel="stylesheet">

  <!-- face-api.js (للوجه فقط — لا تعديل على المسار الوظيفي) -->
  <script defer src="face-api.min.js"></script>

  <!-- MediaPipe FaceMesh (لمعالم العين الدقيقة + القزحية) -->
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js"></script>

  <!-- تطبيقنا -->
  <script defer src="app.js"></script>

  <style>
    body {
      background: url("images/59533.jpg");
      background-size: cover;
      direction: ltr;
    }
    .glass {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
  </style>
</head>
<body class="flex items-center justify-center min-h-screen text-white">
  <form method="post" action="upload.php" onsubmit="submitForm(event)"
        class="glass max-w-md w-full p-8 space-y-5 shadow-lg">
    <h2 class="text-2xl font-bold text-center">إنشاء حساب جديد</h2>

    <div>
      <label for="user_id" class="block mb-1 text-sm font-semibold">ID:</label>
      <input type="text" id="user_id" name="user_id" required
             class="w-full px-3 py-2 text-gray-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>

    <div>
      <label for="user_name" class="block mb-1 text-sm font-semibold">Full Name:</label>
      <input type="text" id="user_name" name="user_name" required
             class="w-full px-3 py-2 text-gray-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>

    <!-- مخفي: الوجه كما هو (descriptor)، والعين (landmarks chunks) -->
    <input type="hidden" id="face_descriptor" name="face_descriptor">
    <input type="hidden" id="eye_feature_chunks" name="eye_feature_chunks">
    <input type="hidden" id="eye_side" name="eye_side">
    <!-- (اختياري) مراجع للتطبيع عند التحقق: -->
    <input type="hidden" id="eye_indices" name="eye_indices">
    <input type="hidden" id="eye_center" name="eye_center">
    <input type="hidden" id="eye_width" name="eye_width">

    <!-- معاينة صورة فقط (اختياري) -->
    <input type="hidden" id="face_image" name="face_image">

    <!-- الجديد: pHash مجزّأ للوجه والعين -->
    <input type="hidden" id="face_phash_chunks" name="face_phash_chunks">
    <input type="hidden" id="eye_phash_chunks" name="eye_phash_chunks">

    <div>
      <label class="block mb-1 text-sm font-semibold">Camera:</label>
      <button type="button" id="btn_open" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded">
        Open Camera <i class="bx bx-camera"></i>
      </button>
      <button type="button" id="btn_stop" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded ml-2">
        Stop
      </button>

      <video id="video" width="100%" height="240" autoplay muted playsinline
             class="rounded-md border border-white mt-2"></video>

      <div class="flex justify-center mt-2 gap-2" id="btn-div">
        <button type="button" id="capture"
                class="w-1/3 bg-green-600 hover:bg-green-700 text-white py-2 rounded-md">
          <i class="bx bx-capture"></i> التقط البصمات
        </button>
      </div>
    </div>

    <div>
      <label class="block mb-1 text-sm font-semibold">Image preview:</label>
      <img id="preview" width="100%" height="240" alt="preview"
           class="rounded-md border border-white" />
    </div>

    <button type="submit"
            class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded-md font-bold text-white">
      إنشاء الحساب
    </button>

    <div class="flex items-center justify-center">
  <a href="index.php" 
     class="text-white text-sm font-semibold no-underline hover:text-gray-300 transition">
    تسجيل الدخول
  </a>
</div>

  </form>
</body>
</html>
