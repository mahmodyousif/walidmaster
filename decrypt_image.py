import sys
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

key = b'Sixteen byte key'  # نفس المفتاح المستخدم للتشفير

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, 'rb') as f:
    encrypted = f.read()

iv = encrypted[:16]
ciphertext = encrypted[16:]

cipher = AES.new(key, AES.MODE_CBC, iv)
decrypted = unpad(cipher.decrypt(ciphertext), AES.block_size)

with open(output_path, 'wb') as f:
    f.write(decrypted)
