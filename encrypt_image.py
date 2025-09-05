import sys
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

input_path = sys.argv[1]
output_path = sys.argv[2]

key = b'Sixteen byte key'  # مفتاح 16 بايت ثابت

with open(input_path, 'rb') as f:
    data = f.read()

cipher = AES.new(key, AES.MODE_CBC)
ct_bytes = cipher.encrypt(pad(data, AES.block_size))
iv = cipher.iv
encrypted = iv + ct_bytes

with open(output_path, 'wb') as f:
    f.write(encrypted)
