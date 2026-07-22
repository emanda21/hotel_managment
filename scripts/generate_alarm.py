"""
Run this once from the project root to generate public/alarm.mp3

    cd "c:\\Users\\owner\\Downloads\\Telegram Desktop\\hotel-menu\\hotel-menu"
    python scripts/generate_alarm.py
"""
import struct, math, os

SAMPLE_RATE  = 44_100
DURATION_SEC = 1.2
FREQ_HZ      = 880
AMPLITUDE    = 28_000

num_samples = int(SAMPLE_RATE * DURATION_SEC)
samples: list[int] = []

for i in range(num_samples):
    t = i / SAMPLE_RATE
    attack_end    = 0.020
    decay_end     = 0.120
    release_start = DURATION_SEC - 0.200

    if t < attack_end:
        env = t / attack_end
    elif t < decay_end:
        env = 1.0 - 0.25 * (t - attack_end) / (decay_end - attack_end)
    elif t < release_start:
        env = 0.75
    else:
        env = 0.75 * (1.0 - (t - release_start) / 0.200)

    value = env * AMPLITUDE * (
        0.8 * math.sin(2 * math.pi * FREQ_HZ * t) +
        0.2 * math.sin(2 * math.pi * FREQ_HZ * 2 * t)
    )
    samples.append(max(-32768, min(32767, int(value))))

pcm_data = struct.pack(f'<{num_samples}h', *samples)

bits    = 16
block   = bits // 8
brate   = SAMPLE_RATE * block
data_sz = len(pcm_data)

header = struct.pack(
    '<4sI4s4sIHHIIHH4sI',
    b'RIFF', 36 + data_sz, b'WAVE',
    b'fmt ', 16, 1, 1, SAMPLE_RATE, brate, block, bits,
    b'data', data_sz,
)
wav_bytes = header + pcm_data

out_path = os.path.join('public', 'alarm.mp3')
os.makedirs('public', exist_ok=True)

with open(out_path, 'wb') as f:
    f.write(wav_bytes)

print(f'✅  alarm.mp3  →  {os.path.abspath(out_path)}')
print(f'    {DURATION_SEC}s · {FREQ_HZ} Hz · {len(wav_bytes):,} bytes')
