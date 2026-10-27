import argparse
import json
import os
import sys

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


def load_runtime(model_root):
    tokenizer = Tokenizer.from_file(os.path.join(model_root, "tokenizer.json"))
    model_path = os.path.join(model_root, "onnx", "model_int8.onnx")
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2) // 2))
    session_options.inter_op_num_threads = 1
    session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(model_path, sess_options=session_options, providers=["CPUExecutionProvider"])
    return tokenizer, session


def embed(tokenizer, session, texts, prefix):
    if not isinstance(texts, list) or not texts or len(texts) > 128:
        raise ValueError("texts must contain 1-128 strings")
    if prefix not in ("query: ", "passage: "):
        raise ValueError("unsupported E5 prefix")
    encoded = tokenizer.encode_batch([prefix + str(text) for text in texts])
    sequence_length = min(512, max(len(item.ids) for item in encoded))
    pad_id = tokenizer.token_to_id("<pad>")
    pad_id = 1 if pad_id is None else pad_id
    input_ids, attention_masks = [], []
    for item in encoded:
        ids = item.ids[:sequence_length]
        mask = item.attention_mask[:sequence_length]
        padding = sequence_length - len(ids)
        input_ids.append(ids + [pad_id] * padding)
        attention_masks.append(mask + [0] * padding)
    input_ids = np.asarray(input_ids, dtype=np.int64)
    attention_mask = np.asarray(attention_masks, dtype=np.int64)
    hidden = session.run(None, {
        "input_ids": input_ids,
        "attention_mask": attention_mask,
        "token_type_ids": np.zeros_like(input_ids),
    })[0]
    expanded_mask = attention_mask[..., None]
    pooled = (hidden * expanded_mask).sum(axis=1) / np.clip(expanded_mask.sum(axis=1), 1, None)
    normalized = pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)
    return normalized.astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    tokenizer, session = load_runtime(args.model)
    for line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("id", ""))
            vectors = embed(tokenizer, session, request.get("texts"), request.get("prefix"))
            reply = {"id": request_id, "vectors": vectors.tolist(), "dimensions": int(vectors.shape[1])}
        except Exception as error:
            reply = {"id": request_id, "error": f"{type(error).__name__}: {error}"}
        print(json.dumps(reply, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
