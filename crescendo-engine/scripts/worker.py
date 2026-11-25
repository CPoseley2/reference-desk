"""Validate resource limits before decoding; use the original Crescendo analysis."""
import sys
import soundfile as sf
from analyze import build

source, output, title, fps, offset = sys.argv[1:]
info = sf.info(source)
if not 0 < info.frames / info.samplerate <= 1800 or info.channels > 8 or info.frames * info.channels > 100_000_000:
    raise ValueError('Recording must be nonempty, at most 30 minutes, 8 channels, and 100 million channel samples.')
build(source, output, title, float(fps), float(offset))
