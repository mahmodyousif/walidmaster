<?php
class Encryptor {
    private $method = 'aes-256-cbc';
    private $key;
    private $iv;

    public function __construct($secret_key) {
        $this->key = hash('sha256', $secret_key);
        $this->iv = substr(hash('sha256', 'biometric_iv'), 0, 16);
    }

    public function encrypt($data) {
        return base64_encode(openssl_encrypt($data, $this->method, $this->key, 0, $this->iv));
    }

    public function decrypt($data) {
        return openssl_decrypt(base64_decode($data), $this->method, $this->key, 0, $this->iv);
    }
}
?>