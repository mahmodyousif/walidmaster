<?php
// upload.php

// إعداد الاتصال بقاعدة البيانات
$servername = "localhost";
$username   = "root";
$password   = "";
$dbname     = "biometric_db";

header('Content-Type: text/plain; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

/** =========================
 * تشفير متماثل AES-256-GCM
 * نخزن Base64(iv|tag|ciphertext)
 * ========================= */
function get_enc_key(): string {
    // 1) جرّب من متغير بيئة
    $b64 = getenv('ENC_KEY_BASE64');
    if ($b64) {
        $raw = base64_decode($b64, true);
        if ($raw !== false && strlen($raw) === 32) {
            return $raw;
        }
    }
    // 2) آخر حل: مفتاح ثابت (بدّلـه فورًا! ولا ترفعه للمستودع)
    $fallback = base64_decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', true); // 32 بايت صفرية (مثال)
    if ($fallback === false || strlen($fallback) !== 32) {
        throw new RuntimeException('Invalid encryption key.');
    }
    return $fallback;
}

function aes_gcm_encrypt(string $plaintext, string $aad = ''): string {
    $key = get_enc_key();
    $iv  = random_bytes(12); // 96-bit IV موصى به لـ GCM
    $tag = '';
    $cipher = openssl_encrypt(
        $plaintext,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag,
        $aad,
        16 // طول tag
    );
    if ($cipher === false) {
        throw new RuntimeException('Encrypt failed.');
    }
    // نخزن iv|tag|cipher كنص base64 واحد
    return base64_encode($iv . $tag . $cipher);
}

// (اختياري) لفحص لاحقًا
function aes_gcm_decrypt(string $b64, string $aad = ''): string {
    $raw = base64_decode($b64, true);
    if ($raw === false || strlen($raw) < 12 + 16 + 1) {
        throw new RuntimeException('Encoded blob is invalid.');
    }
    $iv   = substr($raw, 0, 12);
    $tag  = substr($raw, 12, 16);
    $ct   = substr($raw, 28);
    $key  = get_enc_key();
    $pt = openssl_decrypt(
        $ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $aad
    );
    if ($pt === false) {
        throw new RuntimeException('Decrypt failed.');
    }
    return $pt;
}

try {
    $conn = new mysqli($servername, $username, $password, $dbname);
    $conn->set_charset('utf8mb4');

    // قراءة JSON الداخل
    $raw  = file_get_contents("php://input");
    $data = json_decode($raw, true);

    if (!is_array($data)) {
        http_response_code(400);
        exit("البيانات غير صالحة (يجب إرسال JSON).");
    }

    // الحقول المطلوبة
    $user_id         = $data['user_id']              ?? '';
    $user_name       = $data['user_name']            ?? '';
    $face_descriptor = $data['face_descriptor']      ?? ''; // JSON
    $eye_side        = $data['eye_side']             ?? ''; // 'right' | 'left'
    $eye_chunks      = $data['eye_landmarks_chunks'] ?? ''; // JSON

    // (اختياري) مراجع التطبيع
    $eye_indices_json = $data['eye_indices'] ?? null; // JSON أو null
    $eye_center_json  = $data['eye_center']  ?? null; // JSON أو null
    $eye_width        = isset($data['eye_width']) ? (string)$data['eye_width'] : null;

    // pHash chunks كنص JSON (مطلوبة)
    $face_phash_chunks = $data['face_phash_chunks'] ?? '';
    $eye_phash_chunks  = $data['eye_phash_chunks']  ?? '';

    // تحقق من المطلوب
    if ($user_id === '' || $user_name === '' || $face_descriptor === '' || $eye_side === '' || $eye_chunks === '') {
        http_response_code(400);
        exit("الحقول المطلوبة: user_id, user_name, face_descriptor, eye_side, eye_landmarks_chunks.");
    }
    if (!in_array($eye_side, ['right','left'], true)) {
        http_response_code(400);
        exit("قيمة eye_side يجب أن تكون 'right' أو 'left'.");
    }
    if ($face_phash_chunks === '' || $eye_phash_chunks === '') {
        http_response_code(400);
        exit("الحقول المطلوبة: face_phash_chunks, eye_phash_chunks.");
    }

    // تحقق JSON أساسي
    json_decode($face_descriptor);
    if (json_last_error() !== JSON_ERROR_NONE) { http_response_code(400); exit("face_descriptor ليس JSON صالحًا."); }
    json_decode($eye_chunks);
    if (json_last_error() !== JSON_ERROR_NONE) { http_response_code(400); exit("eye_landmarks_chunks ليس JSON صالحًا."); }
    if ($eye_indices_json !== null) { json_decode($eye_indices_json); }
    if ($eye_center_json  !== null) { json_decode($eye_center_json);  }

    $fph = json_decode($face_phash_chunks, true);
    $eph = json_decode($eye_phash_chunks, true);
    if (!is_array($fph) || !is_array($eph) || count($fph) < 1 || count($eph) < 1) {
        http_response_code(400);
        exit("face_phash_chunks أو eye_phash_chunks غير صالحين (يجب أن يكونا مصفوفتين JSON).");
    }

    // تشفير (AAD اختياري: نربطه بالـ user_id لتقوية سلامة السياق)
    $aad = $user_id;
    $face_phash_chunks_enc = aes_gcm_encrypt($face_phash_chunks, $aad);
    $eye_phash_chunks_enc  = aes_gcm_encrypt($eye_phash_chunks,  $aad);

    // إدراج في قاعدة البيانات (نحفظ الخام + المشفّر)
    $sql = "INSERT INTO users (
                user_id, name, face_descriptor,
                eye_side, eye_landmarks_chunks,
                eye_indices, eye_center, eye_width,
                face_phash_chunks, eye_phash_chunks,
                face_phash_chunks_enc, eye_phash_chunks_enc,
                created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param(
        "ssssssssssss",
        $user_id,
        $user_name,
        $face_descriptor,
        $eye_side,
        $eye_chunks,
        $eye_indices_json,
        $eye_center_json,
        $eye_width,
        $face_phash_chunks,
        $eye_phash_chunks,
        $face_phash_chunks_enc,
        $eye_phash_chunks_enc
    );
    $stmt->execute();

    echo "✅ تم حفظ البيانات + تشفير pHash chunks (AES-256-GCM) بنجاح.";

    $stmt->close();
    $conn->close();
} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    echo "❌ خطأ في قاعدة البيانات: " . $e->getMessage();
} catch (Throwable $t) {
    http_response_code(500);
    echo "❌ خطأ غير متوقع: " . $t->getMessage();
}
