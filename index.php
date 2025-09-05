<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>تسجيل الدخول</title>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="https://unpkg.com/boxicons@latest/css/boxicons.min.css">
  <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.0/css/all.min.css"
        integrity="sha512-DxV+EoADOkOygM4IR9yXP8Sb2qwgidEmeqAEmDKIOfPRQZOWbXCzLC6vjbZyy0vPisbH2SyW27+ddLVCN+OMzQ=="
        crossorigin="anonymous" referrerpolicy="no-referrer" />
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- face-api.js للوجه -->
  <script defer src="face-api.min.js"></script>

  <!-- MediaPipe FaceMesh للعين (إصدارات مثبتة) -->
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675465747/camera_utils.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675465747/drawing_utils.js"></script>

  <!-- تطبيق الدخول -->
  <script defer src="app_login.js"></script>
</head>
<body class="flex items-center justify-center min-h-screen text-white bg-white">

  <form class="max-w-md w-full p-8 space-y-5 shadow-lg bg-opacity-30 bg-white rounded-2xl" onsubmit="return false;">
    <h2 class="text-2xl font-bold text-gary-600 text-center">Secure Biometric Login System</h2>

    <div>

    <div class="btns flex justify-center gap-2 align-center">
      <button type="button" id="btn_start" class="btn bg-blue-500 px-3 py-1 rounded">
       Open Camera<i class="bx bx-camera"></i>
      </button>
      <button type="button" id="btn_stop" class="btn bg-gray-600 px-3 py-1 rounded ml-2">
        Pause <i class="bx bx-pause"></i>
      </button>
      </div>

      <video id="video" width="100%" height="240" autoplay muted playsinline
             class="rounded-md border border-2 border-gray-400 mt-2"></video>

      <div class="btns flex justify-center mt-4 gap-2">
        <button type="button" id="face_login" class="btn px-4 py-2 rounded font-bold">
          <i class="fa-regular fa-face-smile"></i> Face Recognition
        </button>
        <button type="button" id="eye_login" class="btn px-4 py-2 rounded font-bold">
          <i class="fa fa-eye"></i> Iris Scan
        </button>
      </div>
    </div>

    <div>
      <label class="block mb-1 text-sm font-semibold">preview:</label>
      <img id="preview" width="100%" height="240" alt="preview" class="rounded-md border border-white" />
    </div>
   
    <div class="flex items-center justify-center">
  <a href="signup.php" 
     class="text-blue-600 text-sm font-semibold no-underline transition">
    انشاء حساب 
  </a>
</div>
  </form>
</body>
</html>
