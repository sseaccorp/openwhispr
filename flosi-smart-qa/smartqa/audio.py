"""Real local ASR. References are scoring data and never enter this stage."""
import hashlib
import json
import time
from pathlib import Path
from .engine import correct, word_sequence

def word_error_rate(reference, hypothesis):
    a, b = word_sequence(reference), word_sequence(hypothesis)
    row = list(range(len(b)+1))
    for i, wa in enumerate(a, 1):
        new = [i]
        for j, wb in enumerate(b, 1):
            new.append(min(new[-1]+1, row[j]+1, row[j-1]+(wa != wb)))
        row = new
    return {'wordEdits': row[-1], 'referenceWords': len(a), 'wer': row[-1]/len(a) if a else None}

class AudioPipeline:
    def __init__(self, model_path, provider, threads=3):
        from faster_whisper import WhisperModel
        started = time.perf_counter()
        self.asr = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=threads, num_workers=1,
                                local_files_only=True)
        self.load_ms = round((time.perf_counter()-started)*1000, 3)
        source_file = Path(model_path)/'source.json'
        self.model_source = json.loads(source_file.read_text(encoding='utf-8')) if source_file.exists() else {'repository': 'local/'+Path(model_path).name, 'revision': None}
        self.provider = provider

    def process(self, audio_path, language=None, reference=None):
        path = Path(audio_path)
        started = time.perf_counter()
        segments, info = self.asr.transcribe(str(path), language=language, beam_size=5, condition_on_previous_text=False,
                                              vad_filter=False, word_timestamps=True, temperature=0)
        segments = list(segments)  # ASR work happens while consuming this iterator.
        raw = ''.join(s.text for s in segments).strip()
        asr_ms = (time.perf_counter()-started)*1000
        if not raw:
            result = {'original': '', 'text': '', 'status': 'asr_empty', 'reason': 'no_speech_detected', 'edits': []}
        elif len(raw) > 24000:
            result = {'original': raw, 'text': raw, 'status': 'input_limit', 'reason': 'correction_input_over_24000_characters', 'edits': []}
        else:
            result = correct(raw, self.provider)
        record = {'schemaVersion': 1, 'mode': 'real_audio', 'audioSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                  'audioDurationSeconds': info.duration, 'reference': reference, 'asrText': raw,
                  'asrModel': self.model_source['repository'], 'asrRevision': self.model_source.get('revision'),
                  'asrComputeType': 'int8', 'asrLanguage': info.language,
                  'asrLanguageProbability': info.language_probability, 'asrMs': round(asr_ms, 3),
                  'asrRealTimeFactor': asr_ms/1000/info.duration if info.duration else None,
                  'correction': result, 'totalMs': round((time.perf_counter()-started)*1000, 3),
                  'segments': [{'start': s.start, 'end': s.end, 'text': s.text, 'avgLogProbability': s.avg_logprob,
                                'noSpeechProbability': s.no_speech_prob, 'temperature': s.temperature} for s in segments],
                  'asrReferenceComparison': word_error_rate(reference, raw) if reference else None,
                  'finalReferenceComparison': word_error_rate(reference, result['text']) if reference else None,
                  'referenceComparisonMeaning': 'WER against what was spoken; intentional repairs require a separate corrected reference',
                  'qualityReview': 'pending'}
        return record
