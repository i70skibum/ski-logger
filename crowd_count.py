"""Count people in a webcam frame with YOLOv8n (ONNX). Returns boxes for people above a confidence floor."""
import numpy as np, onnxruntime as ort
from PIL import Image
_SESS = {}
def count_people(img, model_path, conf=0.35, iou=0.45, tile=True):
    if model_path not in _SESS:
        _SESS[model_path] = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    s = _SESS[model_path]
    W, H = img.size
    # Wide webcam frames make skiers tiny, so look at the frame in overlapping 640-px tiles as well as whole.
    crops = [(0, 0, W, H)]
    if tile and max(W, H) > 900:
        step = 480
        for y0 in range(0, max(1, H - 160), step):
            for x0 in range(0, max(1, W - 160), step):
                crops.append((x0, y0, min(W, x0 + 640), min(H, y0 + 640)))
    boxes = []
    for (x0, y0, x1, y1) in crops:
        c = img.crop((x0, y0, x1, y1)).convert("RGB")
        cw, ch = c.size; r = 640 / max(cw, ch)
        nw, nh = max(1, int(cw * r)), max(1, int(ch * r))
        canvas = Image.new("RGB", (640, 640), (114, 114, 114)); canvas.paste(c.resize((nw, nh)), (0, 0))
        x = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
        out = s.run(None, {s.get_inputs()[0].name: x})[0][0]          # (84, 8400): cx, cy, w, h, 80 class scores
        sc = out[4]                                                     # class 0 = person
        keep = sc >= conf
        for cx, cy, w, h, p in zip(out[0][keep], out[1][keep], out[2][keep], out[3][keep], sc[keep]):
            bx0, by0 = (cx - w / 2) / r + x0, (cy - h / 2) / r + y0
            boxes.append([bx0, by0, bx0 + w / r, by0 + h / r, float(p)])
    # Non-max suppression across the whole frame.
    boxes.sort(key=lambda b: -b[4]); kept = []
    for b in boxes:
        ok = True
        for k in kept:
            ix = max(0, min(b[2], k[2]) - max(b[0], k[0])); iy = max(0, min(b[3], k[3]) - max(b[1], k[1]))
            inter = ix * iy; u = (b[2] - b[0]) * (b[3] - b[1]) + (k[2] - k[0]) * (k[3] - k[1]) - inter
            small = min((b[2] - b[0]) * (b[3] - b[1]), (k[2] - k[0]) * (k[3] - k[1]))
            if (u > 0 and inter / u > iou) or (small > 0 and inter / small > 0.6): ok = False; break
        if ok: kept.append(b)
    return kept
if __name__ == "__main__":
    import sys
    im = Image.open(sys.argv[1]); b = count_people(im, "models/yolov8n.onnx")
    print(im.size, len(b), [round(x[4], 2) for x in b])
