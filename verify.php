<?php
// verify.php
// التحقق بالوجه أو العين حسب mode = 'face' | 'eye'.
// يقارن pHash مع القيم "المشفّرة المخزّنة" بعد فكّها على السيرفر فقط (لا عرض).

/* ===== DB ===== */
$servername = "localhost";
$username   = "root";
$password   = "";
$dbname     = "biometric_db";

header('Content-Type: text/plain; charset=utf-8');

$conn = new mysqli($servername, $username, $password, $dbname);
if ($conn->connect_error) { die("فشل الاتصال: " . $conn->connect_error); }

/* ===== قراءة الطلب ===== */
$payload = file_get_contents("php://input");
$data = json_decode($payload, true);
if (!is_array($data)) { die("❌ الطلب يجب أن يكون JSON."); }
$mode = $data['mode'] ?? '';

/* ===== فك تشفير AES-256-GCM (لنستخدم الأعمدة المشفّرة فقط) ===== */
function get_enc_key(): string {
  $b64 = getenv('ENC_KEY_BASE64');
  if ($b64) {
    $raw = base64_decode($b64, true);
    if ($raw !== false && strlen($raw) === 32) return $raw;
  }
  // مهم: بدّل هذا الـ fallback في بيئتك (مجرّد مثال)
  $fallback = base64_decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', true);
  if ($fallback === false || strlen($fallback) !== 32) throw new RuntimeException('Invalid ENC key');
  return $fallback;
}
function aes_gcm_decrypt_str(string $b64, string $aad=''): string {
  $raw = base64_decode($b64, true);
  if ($raw === false || strlen($raw) < 12+16+1) throw new RuntimeException('Invalid blob');
  $iv  = substr($raw, 0, 12);
  $tag = substr($raw, 12, 16);
  $ct  = substr($raw, 28);
  $pt = openssl_decrypt($ct, 'aes-256-gcm', get_enc_key(), OPENSSL_RAW_DATA, $iv, $tag, $aad);
  if ($pt === false) throw new RuntimeException('Decrypt failed');
  return $pt; // نص JSON للـ chunks
}

/* ===== Helpers ===== */
function euclideanDistance($a, $b) {
  if (!is_array($a) || !is_array($b)) return INF;
  $n = min(count($a), count($b));
  if ($n === 0) return INF;
  $sum = 0.0;
  for ($i=0; $i<$n; $i++) {
    $av = isset($a[$i]) ? (float)$a[$i] : 0.0;
    $bv = isset($b[$i]) ? (float)$b[$i] : 0.0;
    $d  = $av - $bv; $sum += $d*$d;
  }
  return sqrt($sum / $n);
}
function flattenChunks($chunks) {
  $flat = [];
  if (!is_array($chunks)) return $flat;
  foreach ($chunks as $ch) if (is_array($ch)) foreach ($ch as $v) $flat[] = (float)$v;
  return $flat;
}
function count_bits($byte) {
  $byte = $byte - (($byte >> 1) & 0x55);
  $byte = ($byte & 0x33) + (($byte >> 2) & 0x33);
  return (($byte + ($byte >> 4)) & 0x0F);
}
function hamming_hex64($h1, $h2) {
  if (strlen($h1) !== 16 || strlen($h2) !== 16) return 64;
  $b1 = hex2bin($h1); $b2 = hex2bin($h2);
  if ($b1 === false || $b2 === false) return 64;
  $x = $b1 ^ $b2; $dist = 0;
  for ($i=0; $i<strlen($x); $i++) $dist += count_bits(ord($x[$i]));
  return $dist;
}
function chunks_to_hex16($chunks_arr) {
  if (!is_array($chunks_arr)) return null;
  $hex = implode('', $chunks_arr);
  if (strlen($hex) < 16) $hex = str_pad($hex, 16, '0');
  return strtoupper(substr($hex, 0, 16));
}

/* ===== إعداد عتبات ===== */
$FACE_L2_OK     = 0.60;  // وجه: قبول مباشر
$FACE_L2_SOFT   = 0.75;  // وجه: قبول مشروط مع pHash قوي
$PHASH_FACE_OK  = 12;    // pHash وجه: 12/64
$EYE_L2_OK      = 0.22;  // عين: قبول مباشر
$EYE_L2_SOFT    = 0.28;  // عين: قبول مشروط مع pHash قوي
$PHASH_EYE_OK   = 14;    // pHash عين: 14/64

/* ===== منطق التحقق ===== */
if ($mode === 'face') {
  // نحتاج: descriptor جديد + pHash جديد (من الكلاينت)
  $input_face_json = $data['face_descriptor'] ?? null;
  $input_phash_json = $data['face_phash_chunks'] ?? null;
  if (!$input_face_json || !$input_phash_json) {
    die("❌ البيانات ناقصة (face_descriptor + face_phash_chunks).");
  }
  $input_face = json_decode($input_face_json, true);
  $in_fph_chunks = json_decode($input_phash_json, true);
  if (!is_array($input_face) || !is_array($in_fph_chunks)) {
    die("❌ JSON غير صالح.");
  }
  $in_hex16 = chunks_to_hex16($in_fph_chunks);

  // نبحث في المستخدمين ونفك تشفير pHash المشفّر لكل سجل للمقارنة
  $sql = "SELECT user_id, name, face_descriptor, face_phash_chunks_enc FROM users WHERE face_descriptor IS NOT NULL";
  $res = $conn->query($sql);

  $best = null; $bestL2 = 999.0; $bestHam = 64;

  if ($res && $res->num_rows > 0) {
    while ($row = $res->fetch_assoc()) {
      $db_face = json_decode($row['face_descriptor'], true);
      if (!is_array($db_face)) continue;
      $l2 = euclideanDistance($input_face, $db_face);

      $ham = 64;
      if (!empty($row['face_phash_chunks_enc'])) {
        try {
          // نفك التشفير باستخدام AAD=user_id
          $dec = aes_gcm_decrypt_str($row['face_phash_chunks_enc'], $row['user_id']);
          $stored_chunks = json_decode($dec, true);
          if (is_array($stored_chunks)) {
            $db_hex16 = chunks_to_hex16($stored_chunks);
            if ($db_hex16 && $in_hex16) $ham = hamming_hex64($in_hex16, $db_hex16);
          }
        } catch (Throwable $e) {
          // تجاهل هذا السجل لو فشل فك التشفير
          continue;
        }
      } else {
        // إذا لا يوجد عمود مشفّر، نتجاهله حسب طلبك (التحقق يجب أن يعتمد على المفكوك من المشفّر فقط)
        continue;
      }

      // اختر الأفضل
      $better = false;
      if ($l2 < $bestL2) $better = true;
      elseif ($l2 == $bestL2 && $ham < $bestHam) $better = true;
      if ($better) { $best = $row; $bestL2 = $l2; $bestHam = $ham; }
    }
  }

  if ($best) {
    $ok = ($bestL2 <= $FACE_L2_OK) || ($bestL2 <= $FACE_L2_SOFT && $bestHam <= $PHASH_FACE_OK);
    if ($ok) {
        echo "✅ تحقق ناجح (وجه)\nالاسم: {$best['name']}\nالمعرف: {$best['user_id']}";
    } else {
        echo "❌ فشل التحقق (وجه).";
    }
} else {
    echo "❌ لا يوجد سجلات مطابقة (أو فشل فك التشفير للسجلات).";
}


} elseif ($mode === 'eye') {
  // نحتاج: landmarks chunks (من الكلاينت) + pHash عين (من الكلاينت) + eye_side
  $input_chunks_json = $data['eye_landmarks_chunks'] ?? null;
  $input_eye_side    = $data['eye_side'] ?? null;
  $input_phash_json  = $data['eye_phash_chunks'] ?? null;

  if (!$input_chunks_json || !$input_eye_side || !$input_phash_json) {
    die("❌ البيانات ناقصة (eye_landmarks_chunks + eye_side + eye_phash_chunks).");
  }
  $input_chunks = json_decode($input_chunks_json, true);
  $in_eph_chunks = json_decode($input_phash_json, true);
  if (!is_array($input_chunks) || !is_array($in_eph_chunks)) {
    die("❌ JSON غير صالح.");
  }
  $input_flat = flattenChunks($input_chunks);
  $in_hex16 = chunks_to_hex16($in_eph_chunks);

  $sql = "SELECT user_id, name, eye_side, eye_landmarks_chunks, eye_phash_chunks_enc
          FROM users WHERE eye_landmarks_chunks IS NOT NULL";
  $res = $conn->query($sql);

  $best = null; $bestDist = 999.0; $bestHam = 64;

  if ($res && $res->num_rows > 0) {
    while ($row = $res->fetch_assoc()) {
      if ($row['eye_side'] && $input_eye_side && $row['eye_side'] !== $input_eye_side) continue;

      // مقارنة هندسية مع النسخة الـ plain المخزَّنة (ليست ضمن طلبك تشفيرها الآن)
      $db_chunks = json_decode($row['eye_landmarks_chunks'], true);
      if (!is_array($db_chunks)) continue;
      $db_flat = flattenChunks($db_chunks);
      $dist = euclideanDistance($input_flat, $db_flat);

      // pHash: نفك التشفير ونقارن
      if (empty($row['eye_phash_chunks_enc'])) continue; // نلزم بالمشفّر فقط حسب تعليماتك
      $ham = 64;
      try {
        $dec = aes_gcm_decrypt_str($row['eye_phash_chunks_enc'], $row['user_id']);
        $stored_chunks = json_decode($dec, true);
        if (is_array($stored_chunks)) {
          $db_hex16 = chunks_to_hex16($stored_chunks);
          if ($db_hex16 && $in_hex16) $ham = hamming_hex64($in_hex16, $db_hex16);
        } else {
          continue;
        }
      } catch (Throwable $e) { continue; }

      $better = false;
      if ($dist < $bestDist) $better = true;
      elseif ($dist == $bestDist && $ham < $bestHam) $better = true;
      if ($better) { $best = $row; $bestDist = $dist; $bestHam = $ham; }
    }
  }

  if ($best) {
    $ok = ($bestDist <= $EYE_L2_OK) || ($bestDist <= $EYE_L2_SOFT && $bestHam <= $PHASH_EYE_OK);
    if ($ok) {
        echo "✅ تحقق ناجح (عين)\nالاسم: {$best['name']}\nالمعرف: {$best['user_id']}";
    } else {
        echo "❌ فشل التحقق (عين).";
    }
} else {
    echo "❌ لا يوجد سجلات مطابقة (أو فشل فك التشفير للسجلات).";
}


} else {
  echo "❌ يجب تحديد mode = 'face' أو 'eye'.";
}

$conn->close();
