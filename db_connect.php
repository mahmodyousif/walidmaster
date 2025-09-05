<?php
// بيانات الاتصال بقاعدة البيانات
$servername = "localhost";
$username = "root";       // اسم المستخدم الافتراضي في XAMPP
$password = "";           // عادةً يكون فارغ في XAMPP
$dbname = "biometric_db";

// إنشاء الاتصال
$conn = new mysqli($servername, $username, $password, $dbname);

// التحقق من الاتصال
if ($conn->connect_error) {
    die("فشل الاتصال بقاعدة البيانات: " . $conn->connect_error);
}
?>
