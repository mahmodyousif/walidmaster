<?php
if (!isset($_GET['user_id'])) {
    http_response_code(400);
    die("Missing user_id");
}

$user_id = $_GET['user_id'];

$conn = new mysqli("localhost", "root", "", "biometric_db");
if ($conn->connect_error) {
    die("DB Error");
}

$stmt = $conn->prepare("SELECT encrypted_image FROM users WHERE user_id = ?");
$stmt->bind_param("s", $user_id);
$stmt->execute();
$stmt->store_result();

if ($stmt->num_rows === 0) {
    http_response_code(404);
    die("User not found");
}

$stmt->bind_result($encrypted_data);
$stmt->fetch();

$temp_input = 'fetched.enc';
$temp_output = 'decrypted.png';
file_put_contents($temp_input, $encrypted_data);

// فك التشفير باستخدام Python
$command = escapeshellcmd("python decrypt_image.py $temp_input $temp_output");
exec($command, $output, $return_var);

if ($return_var !== 0 || !file_exists($temp_output)) {
    unlink($temp_input);
    die("Decrypt error");
}

// إرجاع الصورة
header("Content-Type: image/png");
readfile($temp_output);

// تنظيف الملفات
unlink($temp_input);
unlink($temp_output);
?>
