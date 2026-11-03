# Human voice sources

All files are actual human speech. No TTS or joined utterances.

**FLEURS** — Google, FLoRes/Google FLEURS contributors; CC BY 4.0.
https://huggingface.co/datasets/google/fleurs
Dataset revision 70bb2e84b976b7e960aa89f1c648e09c59f894dd.
Each clip is copied unchanged from the Spanish (es_419) or English (en_us)
test archive. References come from that revision's test.tsv. Original files
are 16kHz human read speech. These are preservation controls, not spontaneous
dictation or user recordings.

**AMI Meeting Corpus** — AMI/AMIDA consortium and participating institutions;
CC BY 4.0. https://groups.inf.ed.ac.uk/ami/corpus/
The accompanying AMI-LICENCE.txt was extracted from the official annotations
archive, SHA-256 recorded in manifest.json. The archive filename says 1.6.2;
its internal README identifies release 1.7 (16 June 2014).
Meeting/channel mappings were read from corpusResources/meetings.xml.
Two continuous time crops of actual headset audio were taken using HTTP byte
ranges, with PCM samples unchanged and only WAV headers rewritten. Start/end
samples, source URLs, annotation filenames, references and hashes are in
manifest.json. Time crops are the only modifications. The early development
crop ending 791.80s was trimmed to 791.77s to avoid a partially cut next word.
The included final crop and its reference both end before that next word.

License: https://creativecommons.org/licenses/by/4.0/
References are external annotations, not asserted to be independently verified
by listening during this task. ASR errors and correction errors are reported
separately. Do not infer permission for other recordings from these licenses.
