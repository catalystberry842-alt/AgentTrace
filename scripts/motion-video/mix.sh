set -e
FC="[0]volume=6dB,highpass=f=80,acompressor=threshold=-24dB:ratio=2.5:attack=5:release=150,asplit[vo][sc];[2]volume=4.5dB[mu];[mu][sc]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=600:makeup=1[mud];[1]volume=2.5dB[fx];[vo][mud][fx]amix=inputs=3:normalize=0"
ffmpeg -y -v error -i audio/vo.wav -i audio/sfx.wav -i audio/music.wav -filter_complex "$FC[a]" -map "[a]" audio/pre.wav
J=$(ffmpeg -i audio/pre.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
g(){ echo "$J" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
ffmpeg -y -v error -i audio/pre.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,alimiter=limit=0.84:level=false" -ar 48000 audio/mix.wav
ffmpeg -i audio/mix.wav -af ebur128=peak=true -f null - 2>&1 | grep -A15 Summary | grep -E "I:|LRA:|Peak:"
